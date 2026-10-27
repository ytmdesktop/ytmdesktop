import { app, BrowserView, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Conf from "conf";
import IIntegration from "../integration";
import { StoreSchema } from "~shared/store/schema";
import { normalizeState, Selection, ThemeResult, ThemeSnapshot, ThemeState, validateSelection } from "../../../shared/themes/model";
import { generateCSS, MAX_CSS_BYTES, validateCSS } from "../../../shared/themes/css";
import { CSSLayers } from "./layers";

export default class CustomCSS implements IIntegration {
  private ytmView: BrowserView | null = null;
  private store: Conf<StoreSchema>;
  private layers = new CSSLayers();
  private preview: Selection | null = null;
  private error: string | null = null;
  private watched: string | null = null;
  private readRevision = 0;
  private registered = false;
  private actions = Promise.resolve();
  private onLoad = () => {
    this.updateCSS();
  };

  public provide(store: Conf<StoreSchema>, view: BrowserView): void {
    this.store = store;
    if (view === this.ytmView) return;
    if (this.ytmView && !this.ytmView.webContents.isDestroyed()) this.ytmView.webContents.removeListener("did-finish-load", this.onLoad);
    this.ytmView = view;
    if (view) view.webContents.on("did-finish-load", this.onLoad);
    this.updateCSS();
  }
  public enable(): void {
    this.updateCSS();
  }
  public disable(): void {
    this.updateCSS();
  }
  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
  public cancelPreview(): void {
    this.preview = null;
    this.updateCSS();
  }
  public updateCSS(): void {
    void this.render();
  }
  private state(): ThemeState {
    return normalizeState(this.store.get("appearance.theme"));
  }
  private snapshot(): ThemeSnapshot {
    return { ...this.state(), error: this.error, legacyEnabled: this.store.get("appearance.customCSSEnabled"), previewing: !!this.preview };
  }
  private directory(): string {
    return path.join(app.getPath("userData"), "themes");
  }
  private managedPath(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid theme ID");
    return path.join(this.directory(), `${id}.css`);
  }
  private async readCSS(file: string): Promise<string> {
    if (path.extname(file).toLowerCase() !== ".css") throw new Error("Choose a .css file");
    const handle = await fs.promises.open(file, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_CSS_BYTES) throw new Error("CSS must be a regular file of at most 1 MiB");
      const buffer = Buffer.alloc(MAX_CSS_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_CSS_BYTES) throw new Error("CSS exceeds 1 MiB");
      const css = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
      validateCSS(css);
      return css;
    } finally {
      await handle.close();
    }
  }
  private watch(file: string | null): void {
    if (file === this.watched) return;
    if (this.watched) fs.unwatchFile(this.watched, this.onLoad);
    this.watched = file;
    // Stat polling survives atomic editor saves, deletion and recreation.
    if (file) fs.watchFile(file, { persistent: false, interval: 1000 }, this.onLoad);
  }
  private async render(): Promise<void> {
    if (!this.store) return;
    const revision = ++this.readRevision;
    const view = this.ytmView;
    const state = this.state();
    const selection = this.preview ?? state.selection;
    const legacy = selection.overrides && this.store.get("appearance").customCSSEnabled ? this.store.get("appearance").customCSSPath : null;
    this.watch(legacy);
    const css: string[] = [];
    let error: string | null = null;
    try {
      if (selection.mode === "imported") {
        if (!state.imports.some(x => x.id === selection.importId)) throw new Error("Imported theme is unavailable");
        css.push(await this.readCSS(this.managedPath(selection.importId)));
      } else css.push(generateCSS(selection));
    } catch (e) {
      error = this.message(e);
    }
    if (legacy) {
      try {
        css.push(await this.readCSS(legacy));
      } catch (e) {
        error = `Linked CSS: ${this.message(e)}`;
      }
    }
    if (revision !== this.readRevision) return;
    this.error = error;
    try {
      // Electron defers insertCSS until navigation completes. An empty initial
      // view must not hold the settings action queue while the network loads.
      const contents = view?.webContents;
      await this.layers.set(contents && !contents.isDestroyed() && contents.getURL() ? contents : null, css);
    } catch (e) {
      if (revision === this.readRevision) this.error = this.message(e);
    }
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : "Theme operation failed";
  }
  private checked(value: unknown): Selection {
    const selection = validateSelection(value);
    if (selection.mode === "imported" && !this.state().imports.some(x => x.id === selection.importId)) throw new Error("Unknown imported theme");
    return selection;
  }
  private save(state: ThemeState): void {
    this.store.set("appearance.theme", normalizeState(state));
  }

  public registerIPC(getSettings: () => BrowserWindow | null, store: Conf<StoreSchema>): void {
    if (this.registered) return;
    this.registered = true;
    this.store = store;
    this.save(this.state());
    ipcMain.handle("themes:action", async (event, action: string, value?: unknown, extra?: unknown): Promise<ThemeResult> => {
      const window = getSettings();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        return { ok: false, error: "Settings window required" };
      let result: ThemeResult;
      const task = this.actions.then(async () => {
        if (window.isDestroyed() || window !== getSettings()) {
          result = { ok: false, error: "Settings closed" };
          return;
        }
        try {
          const state = this.state();
          if (action === "preview") this.preview = this.checked(value);
          else if (action === "apply") {
            state.selection = this.checked(value);
            if (state.selection.mode === "custom") state.custom = state.selection;
            this.preview = null;
            this.save(state);
          } else if (action === "cancel") this.preview = null;
          else if (action === "import") {
            const chosen = await dialog.showOpenDialog(window, {
              title: "Import CSS theme",
              filters: [{ name: "CSS", extensions: ["css"] }],
              properties: ["openFile"]
            });
            if (chosen.canceled) {
              result = { ok: true, cancelled: true, state: this.snapshot() };
              return;
            }
            const css = await this.readCSS(chosen.filePaths[0]);
            const id = createHash("sha256").update(css).digest("hex");
            await fs.promises.mkdir(this.directory(), { recursive: true });
            try {
              await fs.promises.writeFile(this.managedPath(id), css, { encoding: "utf8", flag: "wx" });
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            }
            if (!state.imports.some(x => x.id === id))
              state.imports.push({ id, name: path.basename(chosen.filePaths[0], path.extname(chosen.filePaths[0])).slice(0, 80) || "Imported CSS" });
            this.save(state);
          } else if (action === "rename" || action === "remove") {
            const entry = state.imports.find(x => x.id === value);
            if (!entry) throw new Error("Unknown imported theme");
            if (action === "rename") {
              if (typeof extra !== "string" || !extra.trim() || extra.trim().length > 80) throw new Error("Name must contain 1–80 characters");
              entry.name = extra.trim();
            } else {
              state.imports = state.imports.filter(x => x.id !== value);
              if (state.selection.importId === value) {
                state.selection.mode = "original";
                state.selection.importId = null;
              }
              this.preview = null;
              // Removing an entry keeps its managed copy recoverable and never deletes the source.
            }
            this.save(state);
          } else if (action === "export") {
            const selection = this.checked(value);
            if (!["custom", "preset"].includes(selection.mode)) throw new Error("Select a preset or custom theme to export");
            const chosen = await dialog.showSaveDialog(window, {
              title: "Export theme CSS",
              defaultPath: "YTMD-theme.css",
              filters: [{ name: "CSS", extensions: ["css"] }]
            });
            if (chosen.canceled || !chosen.filePath) {
              result = { ok: true, cancelled: true, state: this.snapshot() };
              return;
            }
            if (path.extname(chosen.filePath).toLowerCase() !== ".css") throw new Error("Export filename must end in .css");
            await fs.promises.writeFile(chosen.filePath, generateCSS(selection), "utf8");
          } else if (action !== "get") throw new Error("Unknown theme action");
          if (action !== "get" && action !== "export") await this.render();
          result = { ok: true, state: this.snapshot() };
        } catch (e) {
          result = { ok: false, error: this.message(e), state: this.snapshot() };
        }
      });
      this.actions = task.catch(() => {});
      await task;
      return result;
    });
  }
}
