import { app, autoUpdater, ipcMain } from "electron";
import log from "electron-log";
import EventEmitter from "node:events";
import Manager from "../manager";
import memoryStore from "../memory-store";

declare const YTMD_DISABLE_UPDATES: boolean;
declare const YTMD_UPDATE_FEED_OWNER: string;
declare const YTMD_UPDATE_FEED_REPOSITORY: string;

export interface AutoUpdaterEvents {
  "checking": [];
  "available": [];
  "not-available": [];
  "downloaded": [];
  "error": [];
}

export enum AutoUpdaterState {
  Checking,
  Available,
  NotAvailable,
  Downloaded,
  Error
}

class AutoUpdater extends EventEmitter<AutoUpdaterEvents> implements Manager {
  private autoUpdaterEnabled = false;
  private updateFeedUrl = `https://update.electronjs.org/${YTMD_UPDATE_FEED_OWNER}/${YTMD_UPDATE_FEED_REPOSITORY}/${process.platform}-${process.arch}/${app.getVersion()}`;
  private state = AutoUpdaterState.NotAvailable;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  private shouldDisableUpdates() {
    // macOS can't have auto updates without a code signature
    // linux is not supported on the update server https://github.com/ytmdesktop/ytmdesktop/issues/1247 (hanging issue resolved)
    if (!app.isPackaged) return true;
    if (YTMD_DISABLE_UPDATES) return true;
    if (process.platform !== "win32") return true;

    return false;
  }

  public initialize() {
    if (this._initialized) throw new Error("AutoUpdater is already initialized!");
    this._initialized = true;

    ipcMain.handle("autoUpdater:isUpdateAvailable", () => {
      return this.state == AutoUpdaterState.Available;
    });
    ipcMain.handle("autoUpdater:isUpdateDownloaded", () => {
      return this.state == AutoUpdaterState.Downloaded;
    });

    if (this.shouldDisableUpdates()) {
      memoryStore.set("autoUpdaterDisabled", true);
      return;
    }
    this.autoUpdaterEnabled = true;
    log.debug(`AutoUpdater enabled with at feed ${this.updateFeedUrl}`);

    autoUpdater.setFeedURL({
      url: this.updateFeedUrl
    });

    autoUpdater.on("checking-for-update", () => {
      log.debug("AutoUpdater checking for updates...");
      this.state = AutoUpdaterState.Checking;
      this.reconcileMemoryStoreState();
      this.emit("checking");
    });
    autoUpdater.on("update-available", () => {
      log.debug("AutoUpdater found an update, downloading...");
      this.state = AutoUpdaterState.Available;
      this.reconcileMemoryStoreState();
      this.emit("available");
    });
    autoUpdater.on("update-not-available", () => {
      log.debug("AutoUpdater did not find an update");
      this.state = AutoUpdaterState.NotAvailable;
      this.reconcileMemoryStoreState();
      this.emit("not-available");
    });
    autoUpdater.on("update-downloaded", () => {
      log.debug("AutoUpdater update downloaded");
      this.state = AutoUpdaterState.Downloaded;
      this.reconcileMemoryStoreState();
      this.emit("downloaded");
    });
    autoUpdater.on("error", error => {
      log.debug("AutoUpdater errored", error);
      this.state = AutoUpdaterState.Error;
      this.reconcileMemoryStoreState();
      this.emit("error");
    });

    log.info("AutoUpdater initialized");
  }

  /**
   *
   * @param wait Wait for update check to complete
   * @returns True if an update was downloaded or False if there isn't
   */
  public async checkForUpdates(wait: boolean): Promise<boolean> {
    if (!this.initialized) throw new Error("AutoUpdater is not initialized!");
    if (!this.autoUpdaterEnabled) return false;

    let waitPromise = null;
    if (wait) {
      waitPromise = new Promise<boolean>(resolve => {
        this.once("not-available", () => resolve(false));
        this.once("downloaded", () => resolve(true));
        this.once("error", () => resolve(false));
      });
    }

    autoUpdater.checkForUpdates();
    if (waitPromise) return await waitPromise;
    return false;
  }

  private reconcileMemoryStoreState() {
    switch (this.state) {
      case AutoUpdaterState.Checking: {
        memoryStore.set("autoUpdaterChecking", true);
        memoryStore.set("autoUpdaterNotAvailable", false);
        memoryStore.set("autoUpdaterAvailable", false);
        memoryStore.set("autoUpdaterDownloaded", false);
        memoryStore.set("autoUpdaterErrored", false);
        break;
      }
      case AutoUpdaterState.NotAvailable: {
        memoryStore.set("autoUpdaterChecking", false);
        memoryStore.set("autoUpdaterNotAvailable", true);
        memoryStore.set("autoUpdaterAvailable", false);
        memoryStore.set("autoUpdaterDownloaded", false);
        memoryStore.set("autoUpdaterErrored", false);
        break;
      }
      case AutoUpdaterState.Available: {
        memoryStore.set("autoUpdaterChecking", false);
        memoryStore.set("autoUpdaterNotAvailable", false);
        memoryStore.set("autoUpdaterAvailable", true);
        memoryStore.set("autoUpdaterDownloaded", false);
        memoryStore.set("autoUpdaterErrored", false);
        break;
      }
      case AutoUpdaterState.Downloaded: {
        memoryStore.set("autoUpdaterChecking", false);
        memoryStore.set("autoUpdaterNotAvailable", false);
        memoryStore.set("autoUpdaterAvailable", false);
        memoryStore.set("autoUpdaterDownloaded", true);
        memoryStore.set("autoUpdaterErrored", false);
        break;
      }
      case AutoUpdaterState.Error: {
        memoryStore.set("autoUpdaterChecking", false);
        memoryStore.set("autoUpdaterNotAvailable", false);
        memoryStore.set("autoUpdaterAvailable", false);
        memoryStore.set("autoUpdaterDownloaded", false);
        memoryStore.set("autoUpdaterErrored", true);
        break;
      }
    }
  }
}

export default new AutoUpdater();
