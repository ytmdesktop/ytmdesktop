import { app, autoUpdater, ipcMain } from "electron";
import log from "electron-log";
import Service, { EventEmitterService } from "../service";
import { DependencyConstructor } from "~shared/types";
import MemoryStore from "../memorystore";
import { MemoryStoreSchema } from "~shared/store/schema";

declare const YTMD_DISABLE_UPDATES: boolean;
declare const YTMD_UPDATE_FEED_OWNER: string | null | undefined;
declare const YTMD_UPDATE_FEED_REPOSITORY: string | null | undefined;

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

export default class AutoUpdater extends EventEmitterService<AutoUpdaterEvents> {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [MemoryStore<MemoryStoreSchema>];

  private autoUpdaterEnabled = false;
  private state = AutoUpdaterState.NotAvailable;
  private invalidUpdateFeed = false;

  private updateFeedUrlNoPlatform?: string;
  private updateFeedUrlNoVersion?: string;
  private updateFeedUrl?: string;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public isDisabled() {
    // macOS can't have auto updates without a code signature
    // linux is not supported on the update server https://github.com/ytmdesktop/ytmdesktop/issues/1247 (hanging issue resolved)
    if (this.invalidUpdateFeed) return true;
    if (!app.isPackaged) return true;
    if (YTMD_DISABLE_UPDATES) return true;
    if (process.platform !== "win32") return true;

    return false;
  }

  public override onPreInitialized() {}

  public override onInitialized() {
    if (this._initialized) throw new Error("AutoUpdater is already initialized!");
    this._initialized = true;

    if (
      (typeof YTMD_UPDATE_FEED_OWNER === "undefined" || !YTMD_UPDATE_FEED_OWNER?.trim()) ||
      (typeof YTMD_UPDATE_FEED_REPOSITORY === "undefined" || !YTMD_UPDATE_FEED_REPOSITORY?.trim())
    ) {
      this.invalidUpdateFeed = true;
    } else {
      this.updateFeedUrlNoPlatform = `https://github.com/${YTMD_UPDATE_FEED_OWNER}/${YTMD_UPDATE_FEED_REPOSITORY}/releases`;
      this.updateFeedUrlNoVersion = `${this.updateFeedUrlNoPlatform}/latest/download`;
      this.updateFeedUrl = this.updateFeedUrlNoVersion;
    }

    ipcMain.handle("autoUpdater:isUpdateAvailable", () => {
      return this.state == AutoUpdaterState.Available;
    });
    ipcMain.handle("autoUpdater:isUpdateDownloaded", () => {
      return this.state == AutoUpdaterState.Downloaded;
    });

    if (this.isDisabled()) {
      const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);
      memoryStore.set("autoUpdaterDisabled", true);
      return;
    }
    this.autoUpdaterEnabled = true;
    log.debug(`AutoUpdater enabled with at feed ${this.updateFeedUrl}`);

    if (!!this.updateFeedUrl) {
      autoUpdater.setFeedURL({
        url: this.updateFeedUrl
      });
    }

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

  public override onPostInitialized() {}

  public override onTerminated() {}

  private async resolveLatestReleaseFeedUrl(): Promise<string | null> {
    if (
      process.env.VITEST ||
      typeof YTMD_UPDATE_FEED_OWNER !== "string" ||
      typeof YTMD_UPDATE_FEED_REPOSITORY !== "string" ||
      typeof fetch !== "function"
    ) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${YTMD_UPDATE_FEED_OWNER}/${YTMD_UPDATE_FEED_REPOSITORY}/releases?per_page=10`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "ytmdesktop-autoupdater",
          },
          signal: controller.signal,
        },
      );
      if (!res.ok) return null;
      const releases = (await res.json()) as Array<{
        tag_name?: string;
        draft?: boolean;
        assets?: Array<{ name?: string }>;
      }>;
      if (!Array.isArray(releases)) return null;
      const match = releases.find(
        (r) =>
          !r.draft &&
          typeof r.tag_name === "string" &&
          r.tag_name.length > 0 &&
          Array.isArray(r.assets) &&
          r.assets.some((a) => a.name === "RELEASES"),
      );
      if (!match?.tag_name) return null;
      return `https://github.com/${YTMD_UPDATE_FEED_OWNER}/${YTMD_UPDATE_FEED_REPOSITORY}/releases/download/${match.tag_name}`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   *
   * @param wait Wait for update check to complete
   * @returns True if an update was downloaded or False if there isn't
   */
  public async checkForUpdates(wait: boolean): Promise<boolean> {
    if (!this.initialized) throw new Error("AutoUpdater is not initialized!");
    if (this.invalidUpdateFeed) throw new Error("Update feed is marked invalid");
    if (!this.autoUpdaterEnabled) return false;

    let waitPromise: Promise<boolean> | null = null;
    if (wait) {
      waitPromise = new Promise<boolean>(resolve => {
        this.once("not-available", () => resolve(false));
        this.once("downloaded", () => resolve(true));
        this.once("error", () => resolve(false));
      });
    }

    const resolvedFeedUrl = await this.resolveLatestReleaseFeedUrl();
    if (resolvedFeedUrl && resolvedFeedUrl !== this.updateFeedUrl) {
      this.updateFeedUrl = resolvedFeedUrl;
      autoUpdater.setFeedURL({ url: resolvedFeedUrl });
    }

    autoUpdater.checkForUpdates();
    if (waitPromise) return await waitPromise;
    return false;
  }

  public quitAndInstall() {
    if (this.invalidUpdateFeed) throw new Error("Update feed is marked invalid");
    autoUpdater.quitAndInstall();
  }

  public getFeedUrlNoPlatform() {
    if (this.invalidUpdateFeed) throw new Error("Update feed is marked invalid");
    return this.updateFeedUrlNoPlatform!;
  }

  public getFeedUrlNoVersion() {
    if (this.invalidUpdateFeed) throw new Error("Update feed is marked invalid");
    return this.updateFeedUrlNoVersion!;
  }

  private reconcileMemoryStoreState() {
    const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);

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
