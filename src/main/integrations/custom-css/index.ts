import fs from "fs";
import { BrowserWindow, WebContents } from "electron";
import log from "electron-log";

import Integration from "../integration";
import YTMViewManager from "../../services/ytmviewmanager";
import ConfigStore from "../../services/configstore";
import AppWindowManager from "../../services/windowmanager";
import { AppView } from "../../services/windowmanager/appview";
import { mainWindowTitleBarOverlay } from "../../util";

// Reads the window controls colors set by the custom CSS through CSS variables, returning colors as rgb() or null when not set or invalid.
// The native window controls don't support transparency so any alpha is dropped.
const readWindowControlsColorsScript = `(() => {
  const style = getComputedStyle(document.querySelector(".titlebar") ?? document.documentElement);
  const probe = document.createElement("div");
  probe.style.display = "none";
  document.documentElement.appendChild(probe);
  const read = name => {
    const value = style.getPropertyValue(name).trim();
    if (!value || !CSS.supports("color", value)) return null;
    probe.style.color = value;
    const channels = getComputedStyle(probe).color.match(/^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    return channels ? "rgb(" + channels.slice(1, 4).map(channel => Math.round(Number(channel))).join(", ") + ")" : null;
  };
  const colors = {
    background: read("--ytmd-titlebar-controls-background"),
    symbol: read("--ytmd-titlebar-controls-color")
  };
  probe.remove();
  return colors;
})()`;

/**
 * Keeps one piece of CSS inserted into a WebContents.
 *
 * Changes are applied one at a time so overlapping updates (such as the file watcher firing twice for one save) can't leave stale CSS behind.
 */
class CSSInjectionTarget {
  private insertedKey: string | null = null;
  private insertedInto: WebContents | null = null;
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly name: string,
    private readonly getWebContents: () => Promise<WebContents | null | undefined>,
    private readonly onApplied?: (webContents: WebContents) => Promise<void>
  ) {}

  /**
   * Replaces any CSS previously inserted by this target with the given CSS, or removes it when null
   */
  public apply(css: string | null) {
    this.queue = this.queue
      .then(async () => {
        const webContents = await this.getWebContents();

        if (this.insertedKey !== null && this.insertedInto === webContents && webContents && !webContents.isDestroyed()) {
          try {
            await webContents.removeInsertedCSS(this.insertedKey);
          } catch (error) {
            // The document the CSS was inserted into may no longer exist which is fine
            log.debug(`CustomCSS: Could not remove previous CSS from ${this.name}`, error);
          }
        }
        this.insertedKey = null;
        this.insertedInto = null;

        if (!webContents || webContents.isDestroyed()) return;

        if (css !== null) {
          this.insertedKey = await webContents.insertCSS(css, { cssOrigin: "user" });
          this.insertedInto = webContents;
        }

        try {
          await this.onApplied?.(webContents);
        } catch (error) {
          log.warn(`CustomCSS: Failed to run post apply step for ${this.name}`, error);
        }
      })
      .catch(error => {
        log.error(`CustomCSS: Failed to apply CSS to ${this.name}`, error);
      });

    return this.queue;
  }
}

export default class CustomCSS extends Integration {
  public override name = "CustomCSS";
  public override storeEnableProperty: Integration["storeEnableProperty"] = "appearance.customCSSEnabled";
  public override disableFlags = ["disable_custom_css"];

  // The CSS that should currently be applied, null when no custom CSS should be applied
  private cssContent: string | null = null;

  private ytmView: AppView | null = null;
  private ytmTarget = new CSSInjectionTarget("YTM view", async () => {
    const ytmViewManager = this.getService(YTMViewManager);

    await ytmViewManager.ready();
    return ytmViewManager.getView()?.webContents;
  });
  private titlebarWebContents: WebContents | null = null;
  // The titlebar has its own target so it never has to wait for the YTM view to be ready
  private titlebarTarget = new CSSInjectionTarget(
    "titlebar",
    async () => this.titlebarWebContents,
    webContents => this.updateWindowControls(webContents)
  );

  private storeListener: ReturnType<ConfigStore["onDidChange"]> | null = null;

  private currentWatcher: fs.FSWatcher | null = null;

  // Inserted CSS does not survive a reload/navigation so it needs to be inserted again.
  // The YTM view emits ready on every dom-ready, including after it was recreated.
  private ytmViewReadyListener = () => {
    this.ytmTarget.apply(this.cssContent);
  };

  private titlebarDomReadyListener = () => {
    this.titlebarTarget.apply(this.cssContent);
  };

  public onSetup() {}

  public onEnabled(): void {
    const ytmViewManager = this.getService(YTMViewManager);
    const configStore = this.getService(ConfigStore);

    this.ytmView = ytmViewManager.getView() ?? null;
    this.ytmView?.on("ready", this.ytmViewReadyListener);

    this.titlebarWebContents = this.getService(AppWindowManager).getWindow("Main")?.webContents ?? null;
    this.titlebarWebContents?.on("dom-ready", this.titlebarDomReadyListener);

    this.storeListener = configStore.onDidChange("appearance", (newState, oldState) => {
      if (newState === undefined || oldState === undefined) {
        this.updateCSS();
      } else {
        if (newState && (newState.customCSSEnabled && newState.customCSSPath !== oldState.customCSSPath)) {
          this.updateCSS();
        }
      }
    });

    this.updateCSS();
  }

  public onDisabled(): void {
    this.ytmView?.off("ready", this.ytmViewReadyListener);
    this.titlebarWebContents?.off("dom-ready", this.titlebarDomReadyListener);
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }
    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }

    this.removeCSS();
  }

  public updateCSS() {
    const configStore = this.getService(ConfigStore);

    const cssPath = configStore.get("appearance.customCSSPath");
    if (!cssPath || !fs.existsSync(cssPath)) {
      this.watchCSSFile();
      this.removeCSS();
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(cssPath, "utf8");
    } catch (error) {
      // The file can be briefly locked while an editor is saving it, keep the current CSS until the next change
      log.warn("CustomCSS: Failed to read custom CSS file", error);
      return;
    }

    this.applyCSS(content);
    this.watchCSSFile(cssPath);
  }

  private applyCSS(content: string | null) {
    this.cssContent = content;
    this.titlebarTarget.apply(content);
    this.ytmTarget.apply(content);
  }

  private removeCSS() {
    this.applyCSS(null);
  }

  /**
   * The minimize/maximize/close buttons are drawn natively on Windows and Linux so CSS can't style them,
   * instead their colors can be set with the --ytmd-titlebar-controls-background and --ytmd-titlebar-controls-color CSS variables
   */
  private async updateWindowControls(webContents: WebContents) {
    // macOS uses the native traffic lights which can't be recolored
    if (process.platform === "darwin") return;

    const window = BrowserWindow.fromWebContents(webContents);
    if (!window || window.isDestroyed()) return;

    const colors: { background: string | null; symbol: string | null } = await webContents.executeJavaScript(readWindowControlsColorsScript);
    window.setTitleBarOverlay({
      color: colors.background ?? mainWindowTitleBarOverlay.color,
      symbolColor: colors.symbol ?? mainWindowTitleBarOverlay.symbolColor
    });
  }

  private watchCSSFile(newFile?: string) {
    // Reset the file listener if it exists
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }

    if (!newFile) return;

    // Watch for changes to the custom CSS file
    // and update the CSS when it changes
    this.currentWatcher = fs.watch(newFile, {}, type => {
      if (type === "change") {
        this.updateCSS();
      } else if (type === "rename") {
        // Some editors save by replacing the file which is reported as a rename, so only forget the file if it's actually gone
        if (fs.existsSync(newFile)) {
          this.updateCSS();
        } else {
          const configStore = this.getService(ConfigStore);

          this.watchCSSFile();
          configStore.set("appearance.customCSSPath", null);
          this.removeCSS();
        }
      }
    });
  }
}
