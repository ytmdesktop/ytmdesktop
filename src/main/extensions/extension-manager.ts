import { app, dialog, shell, BrowserWindow } from "electron";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import Conf from "conf";
import log from "electron-log";
import AdmZip from "adm-zip";
import { InstalledExtension, StoreSchema } from "~shared/store/schema";

export default class ExtensionManager {
  private store: Conf<StoreSchema>;
  private getSession: () => Electron.Session;
  private extensionsDir: string;

  constructor(store: Conf<StoreSchema>, getSession: () => Electron.Session) {
    this.store = store;
    this.getSession = getSession;
    this.extensionsDir = path.join(app.getPath("userData"), "extensions");
  }

  private async ensureExtensionsDir(): Promise<void> {
    if (!fsSync.existsSync(this.extensionsDir)) {
      await fs.mkdir(this.extensionsDir, { recursive: true });
    }
  }

  /**
   * Ensure default built-in extensions (such as Better Lyrics) are installed and enabled
   */
  public async ensureDefaultExtensions(): Promise<void> {
    await this.ensureExtensionsDir();
    const config = this.store.get("extensions") || { enabled: true, items: [] };
    const items = config.items || [];

    // Better Lyrics extension ID
    const betterLyricsId = "effdbpeggelllpfkjppbokhmmiinhlmg";
    const existing = items.find(item => item.id === betterLyricsId);

    if (!existing || !fsSync.existsSync(existing.path)) {
      log.info("[ExtensionManager] Better Lyrics not found in installed items, installing default...");

      const candidatePaths = [
        path.join(this.extensionsDir, betterLyricsId),
        path.join(app.getAppPath(), "src", "assets", "builtin-extensions", "better-lyrics"),
        path.join(process.resourcesPath, "builtin-extensions", "better-lyrics"),
        path.join(__dirname, "..", "..", "assets", "builtin-extensions", "better-lyrics")
      ];

      let foundPath: string | null = null;
      for (const p of candidatePaths) {
        if (fsSync.existsSync(path.join(p, "manifest.json"))) {
          foundPath = p;
          break;
        }
      }

      if (foundPath) {
        try {
          const destDir = path.join(this.extensionsDir, betterLyricsId);
          if (foundPath !== destDir) {
            await this.copyDirectory(foundPath, destDir);
          }
          await this.registerAndLoadExtension(destDir, betterLyricsId, "builtin");
          log.info("[ExtensionManager] Successfully auto-registered built-in Better Lyrics extension.");
        } catch (err) {
          log.error("[ExtensionManager] Failed to register bundled Better Lyrics:", err);
        }
      } else {
        // Fallback: try installing from Chrome Web Store in background
        try {
          log.info("[ExtensionManager] Downloading Better Lyrics from Chrome Web Store...");
          await this.installFromUrlOrId(betterLyricsId);
        } catch (err) {
          log.warn("[ExtensionManager] Could not auto-install Better Lyrics from webstore:", err);
        }
      }
    }
  }

  /**
   * Load all enabled extensions into the session on application startup
   */
  public async loadAll(): Promise<void> {
    await this.ensureExtensionsDir();

    try {
      await this.ensureDefaultExtensions();
    } catch (e) {
      log.warn("[ExtensionManager] ensureDefaultExtensions warning:", e);
    }

    const config = this.store.get("extensions");
    if (!config || !config.enabled) {
      log.info("[ExtensionManager] Extensions globally disabled in settings.");
      return;
    }

    const items = config.items || [];
    const ses = this.getSession();

    for (const ext of items) {
      if (!ext.enabled) continue;

      try {
        if (fsSync.existsSync(ext.path)) {
          await this.patchExtensionForElectron(ext.path);
          await ses.loadExtension(ext.path, { allowFileAccess: true });
          log.info(`[ExtensionManager] Successfully loaded extension: ${ext.name} (${ext.id})`);
        } else {
          log.warn(`[ExtensionManager] Extension path does not exist: ${ext.path}`);
        }
      } catch (error) {
        log.error(`[ExtensionManager] Failed to load extension ${ext.name} (${ext.id}):`, error);
      }
    }
  }

  /**
   * Get list of currently installed extensions
   */
  public getInstalledExtensions(): InstalledExtension[] {
    const config = this.store.get("extensions");
    return config?.items || [];
  }

  /**
   * Install extension from Chrome Web Store using URL or 32-char ID
   */
  public async installFromUrlOrId(urlOrId: string): Promise<InstalledExtension> {
    await this.ensureExtensionsDir();

    const match = urlOrId.trim().match(/([a-p]{32})/i);
    if (!match) {
      throw new Error("ID atau URL Chrome Web Store tidak valid. ID harus berupa string 32 karakter (a-p).");
    }

    const extensionId = match[1].toLowerCase();
    const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=131.0.0.0&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;

    log.info(`[ExtensionManager] Downloading extension ${extensionId} from Chrome Web Store...`);

    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Gagal mengunduh ekstensi (${response.status}: ${response.statusText})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("File ekstensi kosong atau tidak ditemukan di Chrome Web Store.");
    }

    const zipBuffer = this.extractZipFromCrxBuffer(buffer);
    const destDir = path.join(this.extensionsDir, extensionId);

    if (fsSync.existsSync(destDir)) {
      await fs.rm(destDir, { recursive: true, force: true });
    }
    await fs.mkdir(destDir, { recursive: true });

    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(destDir, true);

    const extInfo = await this.registerAndLoadExtension(destDir, extensionId, "webstore");
    return extInfo;
  }

  /**
   * Install unpacked extension from a local directory
   */
  public async installFromFolder(parentWindow?: BrowserWindow): Promise<InstalledExtension | null> {
    await this.ensureExtensionsDir();

    const result = await dialog.showOpenDialog(parentWindow || null, {
      title: "Pilih Folder Ekstensi Chrome (Unpacked)",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const sourcePath = result.filePaths[0];
    const manifestPath = path.join(sourcePath, "manifest.json");

    if (!fsSync.existsSync(manifestPath)) {
      throw new Error("Folder yang dipilih tidak memiliki file 'manifest.json'. Pastikan folder merupakan ekstensi Chrome yang valid.");
    }

    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    const rawName = manifest.name || path.basename(sourcePath);
    const slug =
      rawName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .slice(0, 24) || "ext";
    const extensionId = `${slug}_${Date.now().toString(36)}`;
    const destDir = path.join(this.extensionsDir, extensionId);

    // Copy directory recursively
    await this.copyDirectory(sourcePath, destDir);

    const extInfo = await this.registerAndLoadExtension(destDir, extensionId, "folder");
    return extInfo;
  }

  /**
   * Install extension from a local archive (.crx or .zip)
   */
  public async installFromArchive(parentWindow?: BrowserWindow): Promise<InstalledExtension | null> {
    await this.ensureExtensionsDir();

    const result = await dialog.showOpenDialog(parentWindow || null, {
      title: "Pilih File Ekstensi (.crx atau .zip)",
      properties: ["openFile"],
      filters: [{ name: "Chrome Extension Archive", extensions: ["crx", "zip"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const buffer = await fs.readFile(filePath);
    const zipBuffer = this.extractZipFromCrxBuffer(buffer);

    const extensionId = `archive_${Date.now().toString(36)}`;
    const destDir = path.join(this.extensionsDir, extensionId);

    if (fsSync.existsSync(destDir)) {
      await fs.rm(destDir, { recursive: true, force: true });
    }
    await fs.mkdir(destDir, { recursive: true });

    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(destDir, true);

    const extInfo = await this.registerAndLoadExtension(destDir, extensionId, "archive");
    return extInfo;
  }

  /**
   * Toggle extension enabled status
   */
  public async toggleExtension(id: string, enabled: boolean): Promise<void> {
    const config = this.store.get("extensions");
    const items = config?.items || [];
    const ext = items.find(item => item.id === id);

    if (!ext) {
      throw new Error(`Ekstensi dengan ID ${id} tidak ditemukan.`);
    }

    const ses = this.getSession();

    if (enabled) {
      try {
        await this.patchExtensionForElectron(ext.path);
        await ses.loadExtension(ext.path, { allowFileAccess: true });
        ext.enabled = true;
      } catch (err) {
        log.error(`[ExtensionManager] Failed to enable extension ${id}:`, err);
        throw err;
      }
    } else {
      try {
        ses.removeExtension(id);
      } catch (err) {
        log.warn(`[ExtensionManager] Error removing extension from session ${id}:`, err);
      }
      ext.enabled = false;
    }

    this.store.set("extensions.items", items);
  }

  /**
   * Remove and delete an extension
   */
  public async removeExtension(id: string): Promise<void> {
    const config = this.store.get("extensions");
    const items = config?.items || [];
    const extIndex = items.findIndex(item => item.id === id);

    if (extIndex === -1) {
      throw new Error(`Ekstensi dengan ID ${id} tidak ditemukan.`);
    }

    const ext = items[extIndex];
    const ses = this.getSession();

    try {
      ses.removeExtension(id);
    } catch (err) {
      log.warn(`[ExtensionManager] Error removing extension from session:`, err);
    }

    try {
      if (fsSync.existsSync(ext.path)) {
        await fs.rm(ext.path, { recursive: true, force: true });
      }
    } catch (err) {
      log.error(`[ExtensionManager] Error deleting extension files from disk:`, err);
    }

    items.splice(extIndex, 1);
    this.store.set("extensions.items", items);
    log.info(`[ExtensionManager] Removed extension: ${ext.name} (${id})`);
  }

  /**
   * Open the extension folder in OS file manager
   */
  public async openFolder(id: string): Promise<void> {
    const config = this.store.get("extensions");
    const items = config?.items || [];
    const ext = items.find(item => item.id === id);
    if (ext && fsSync.existsSync(ext.path)) {
      await shell.openPath(ext.path);
    } else if (fsSync.existsSync(this.extensionsDir)) {
      await shell.openPath(this.extensionsDir);
    }
  }

  // ----------------------------------------------------
  // Private helper methods
  // ----------------------------------------------------

  private extractZipFromCrxBuffer(buffer: Buffer): Buffer {
    // Check if it's already a regular ZIP archive (starts with PK)
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return buffer;
    }

    // Check CRX magic 'Cr24'
    const magic = buffer.slice(0, 4).toString("utf8");
    if (magic !== "Cr24") {
      // Fallback: search for ZIP magic PK\x03\x04
      const zipIndex = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      if (zipIndex !== -1) {
        return buffer.slice(zipIndex);
      }
      throw new Error("File bukan format .crx atau .zip yang valid.");
    }

    const version = buffer.readUInt32LE(4);
    if (version === 3) {
      const headerSize = buffer.readUInt32LE(8);
      const zipStart = 12 + headerSize;
      return buffer.slice(zipStart);
    } else if (version === 2) {
      const pubKeyLength = buffer.readUInt32LE(8);
      const sigLength = buffer.readUInt32LE(12);
      const zipStart = 16 + pubKeyLength + sigLength;
      return buffer.slice(zipStart);
    }

    // Generic fallback for CRX
    const zipIndex = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (zipIndex !== -1) {
      return buffer.slice(zipIndex);
    }

    throw new Error(`Versi format CRX tidak didukung: version ${version}`);
  }

  private async registerAndLoadExtension(dirPath: string, defaultId: string, source: "webstore" | "folder" | "archive"): Promise<InstalledExtension> {
    const manifestPath = path.join(dirPath, "manifest.json");
    if (!fsSync.existsSync(manifestPath)) {
      throw new Error("File 'manifest.json' tidak ditemukan di dalam paket ekstensi.");
    }

    const manifestRaw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw);

    const name = await this.resolveI18nString(dirPath, manifest.name || "Unnamed Extension", manifest.default_locale);
    const description = await this.resolveI18nString(dirPath, manifest.description || "No description provided.", manifest.default_locale);
    const version = manifest.version || "1.0.0";
    const icon = await this.extractExtensionIcon(dirPath, manifest);

    const ses = this.getSession();

    // Patch extension for Electron compatibility (storage.sync, etc.)
    await this.patchExtensionForElectron(dirPath);

    // Load into electron session
    let loadedExt: Electron.Extension;
    try {
      loadedExt = await ses.loadExtension(dirPath, { allowFileAccess: true });
    } catch (err) {
      log.error("[ExtensionManager] Failed to load extension into session:", err);
      throw new Error(`Gagal memuat ekstensi ke sesi Electron: ${err instanceof Error ? err.message : String(err)}`);
    }

    const finalId = loadedExt?.id || defaultId;

    const extensionItem: InstalledExtension = {
      id: finalId,
      name,
      version,
      description,
      enabled: true,
      path: dirPath,
      icon,
      source,
      isBuiltin: source === "builtin" || finalId === "effdbpeggelllpfkjppbokhmmiinhlmg"
    };

    const config = this.store.get("extensions") || { enabled: true, items: [] };
    const items = config.items || [];
    const existingIndex = items.findIndex(item => item.id === finalId);

    if (existingIndex > -1) {
      items[existingIndex] = extensionItem;
    } else {
      items.push(extensionItem);
    }

    this.store.set("extensions.items", items);
    log.info(`[ExtensionManager] Successfully installed & loaded extension: ${name} (${finalId})`);

    return extensionItem;
  }

  private async resolveI18nString(dirPath: string, str: string, defaultLocale?: string): Promise<string> {
    if (!str || !str.startsWith("__MSG_")) {
      return str;
    }

    const key = str.replace(/^__MSG_/, "").replace(/__$/, "");
    const localesToTry = [defaultLocale, "en", "en_US", "id"].filter(Boolean) as string[];

    for (const loc of localesToTry) {
      const messagesFile = path.join(dirPath, "_locales", loc, "messages.json");
      if (fsSync.existsSync(messagesFile)) {
        try {
          const raw = await fs.readFile(messagesFile, "utf8");
          const messages = JSON.parse(raw);
          if (messages[key] && messages[key].message) {
            return messages[key].message;
          }
        } catch {
          // ignore
        }
      }
    }

    return key;
  }

  private async extractExtensionIcon(dirPath: string, manifest: Record<string, unknown>): Promise<string | undefined> {
    const icons = (manifest.icons || {}) as Record<string, string>;
    const iconFileRel = icons["128"] || icons["48"] || icons["32"] || icons["16"] || Object.values(icons)[0];

    if (!iconFileRel) return undefined;

    const iconFullPath = path.join(dirPath, iconFileRel);
    if (fsSync.existsSync(iconFullPath)) {
      try {
        const iconBuf = await fs.readFile(iconFullPath);
        const ext = path.extname(iconFullPath).toLowerCase().replace(".", "");
        const mime = ext === "svg" ? "image/svg+xml" : `image/${ext || "png"}`;
        return `data:${mime};base64,${iconBuf.toString("base64")}`;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async patchExtensionForElectron(dirPath: string): Promise<void> {
    try {
      const jsFiles: string[] = [];

      const walk = async (currentDir: string) => {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".js")) {
            jsFiles.push(fullPath);
          }
        }
      };

      await walk(dirPath);

      for (const filePath of jsFiles) {
        let content = await fs.readFile(filePath, "utf8");
        let changed = false;

        // 1. Map storage.sync to storage.local for Electron compatibility
        if (content.includes("storage.sync")) {
          content = content.replace(/storage\.sync/g, "storage.local");
          changed = true;
        }

        // 2. In storage.onChanged listeners, accept both 'sync' and 'local'
        if (content.includes('"sync"===')) {
          content = content.replace(/"sync"===([a-zA-Z0-9_]+)/g, '("sync"===$1||"local"===$1)');
          changed = true;
        }
        if (content.includes("'sync'===")) {
          content = content.replace(/'sync'===([a-zA-Z0-9_]+)/g, "('sync'===$1||'local'===$1)");
          changed = true;
        }

        // 3. Fix Better Lyrics singleColumnMusicWatchNextResultsRenderer null access
        if (content.includes("r.contents.singleColumnMusicWatchNextResultsRenderer")) {
          content = content.replace(/r\.contents\.singleColumnMusicWatchNextResultsRenderer/g, "r?.contents?.singleColumnMusicWatchNextResultsRenderer");
          changed = true;
        }

        // 4. Prepend safe storage shim at top of JS files if not present
        if (!content.startsWith("/* [YTMDesktop Electron Extension Shim] */")) {
          const shim = `/* [YTMDesktop Electron Extension Shim] */
if (typeof chrome !== "undefined" && chrome?.storage) {
  try {
    if (!chrome.storage.sync) {
      chrome.storage.sync = chrome.storage.local;
    }
  } catch (e) {}
}
`;
          content = shim + content;
          changed = true;
        }

        if (changed) {
          await fs.writeFile(filePath, content, "utf8");
          log.info(`[ExtensionManager] Applied Electron compatibility patch to ${path.basename(filePath)}`);
        }
      }
    } catch (err) {
      log.warn(`[ExtensionManager] Failed to patch extension at ${dirPath}:`, err);
    }
  }
}
