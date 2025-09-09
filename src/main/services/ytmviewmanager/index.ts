import { app, Menu, session, shell } from "electron";
import { DependencyConstructor, YTMViewSetupCompletionFlags, YTMViewStatus } from "~shared/types";
import playerStateStore from "../../player-state-store";
import log from "electron-log";
import path from "node:path";
import Service, { EventEmitterService } from "../service";
import ConfigStore from "../configstore";
import { AppView } from "../windowmanager/appview";
import StateManager from "../statemanager";
import MemoryStore from "../memorystore";
import { MemoryStoreSchema } from "~shared/store/schema";
import AppWindowManager from "../windowmanager";

export type YTMViewManagerEventMap = {
  "status-changed": [];
  "view-recreated": [];
  "unresponsive": [];
  "responsive": [];
  "title-updated": [string];
};

function urlIsGoogleAccountsDomain(url: URL): boolean {
  // https://www.google.com/supported_domains
  // prettier-ignore
  const supportedDomains = [".google.com",".google.ad",".google.ae",".google.com.af",".google.com.ag",".google.al",".google.am",".google.co.ao",".google.com.ar",".google.as",".google.at",".google.com.au",".google.az",".google.ba",".google.com.bd",".google.be",".google.bf",".google.bg",".google.com.bh",".google.bi",".google.bj",".google.com.bn",".google.com.bo",".google.com.br",".google.bs",".google.bt",".google.co.bw",".google.by",".google.com.bz",".google.ca",".google.cd",".google.cf",".google.cg",".google.ch",".google.ci",".google.co.ck",".google.cl",".google.cm",".google.cn",".google.com.co",".google.co.cr",".google.com.cu",".google.cv",".google.com.cy",".google.cz",".google.de",".google.dj",".google.dk",".google.dm",".google.com.do",".google.dz",".google.com.ec",".google.ee",".google.com.eg",".google.es",".google.com.et",".google.fi",".google.com.fj",".google.fm",".google.fr",".google.ga",".google.ge",".google.gg",".google.com.gh",".google.com.gi",".google.gl",".google.gm",".google.gr",".google.com.gt",".google.gy",".google.com.hk",".google.hn",".google.hr",".google.ht",".google.hu",".google.co.id",".google.ie",".google.co.il",".google.im",".google.co.in",".google.iq",".google.is",".google.it",".google.je",".google.com.jm",".google.jo",".google.co.jp",".google.co.ke",".google.com.kh",".google.ki",".google.kg",".google.co.kr",".google.com.kw",".google.kz",".google.la",".google.com.lb",".google.li",".google.lk",".google.co.ls",".google.lt",".google.lu",".google.lv",".google.com.ly",".google.co.ma",".google.md",".google.me",".google.mg",".google.mk",".google.ml",".google.com.mm",".google.mn",".google.com.mt",".google.mu",".google.mv",".google.mw",".google.com.mx",".google.com.my",".google.co.mz",".google.com.na",".google.com.ng",".google.com.ni",".google.ne",".google.nl",".google.no",".google.com.np",".google.nr",".google.nu",".google.co.nz",".google.com.om",".google.com.pa",".google.com.pe",".google.com.pg",".google.com.ph",".google.com.pk",".google.pl",".google.pn",".google.com.pr",".google.ps",".google.pt",".google.com.py",".google.com.qa",".google.ro",".google.ru",".google.rw",".google.com.sa",".google.com.sb",".google.sc",".google.se",".google.com.sg",".google.sh",".google.si",".google.sk",".google.com.sl",".google.sn",".google.so",".google.sm",".google.sr",".google.st",".google.com.sv",".google.td",".google.tg",".google.co.th",".google.com.tj",".google.tl",".google.tm",".google.tn",".google.to",".google.com.tr",".google.tt",".google.com.tw",".google.co.tz",".google.com.ua",".google.co.ug",".google.co.uk",".google.com.uy",".google.co.uz",".google.com.vc",".google.co.ve",".google.co.vi",".google.com.vn",".google.vu",".google.ws",".google.rs",".google.co.za",".google.co.zm",".google.co.zw",".google.cat"];
  const domain = url.hostname.split("accounts")[1];
  if (supportedDomains.includes(domain)) return true;
  return false;
}
function isPreventedNavOrRedirect(url: URL): boolean {
  return (
    url.hostname !== "consent.youtube.com" &&
    url.hostname !== "accounts.youtube.com" &&
    url.hostname !== "music.youtube.com" &&
    !(
      (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
      (url.pathname === "/signin" || url.pathname === "/premium" || url.pathname === "/musicpremium" || url.pathname === "/signin_prompt")
    ) &&
    !urlIsGoogleAccountsDomain(url)
  );
}
function openExternalFromYtmView(urlString: string) {
  const url = new URL(urlString);
  const domainSplit = url.hostname.split(".");
  domainSplit.reverse();
  const domain = `${domainSplit[1]}.${domainSplit[0]}`;
  if (domain === "google.com" || domain === "youtube.com" || domain === "googleusercontent.com" || domain === "ggpht.com") {
    shell.openExternal(urlString);
  } else {
    log.warn(`Attempted to open ${urlString} from YTMView but was denied`);
  }
}

export default class YTMViewManager extends EventEmitterService<YTMViewManagerEventMap> {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [
    ConfigStore,
    StateManager,
    MemoryStore<MemoryStoreSchema>,
    AppWindowManager
  ];

  private ytmView: AppView;
  private hooksReady = false;
  private hookError: Error | null = null;
  private setupCompletionFlags = 0;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  private _status = YTMViewStatus.Loading;
  public get status() {
    return this._status;
  }

  public override onPreInitialized() {}

  public onInitialized() {
    if (this._initialized) throw new Error("YTMViewManager is already initialized!");
    this._initialized = true;

    log.info("YTMViewManager initialized");
  }

  public override onPostInitialized() {
    const configStore = this.getDependency(ConfigStore);
    configStore.onDidChange("appearance", newState => {
      if (this.ytmView) {
        this.ytmView.webContents.setZoomFactor(newState.zoom / 100);
      }
    });

    //#region Permission handlers
    session.fromPartition("persist:ytmview").setPermissionCheckHandler((webContents, permission) => {
      if (webContents == this.ytmView.webContents) {
        if (permission === "fullscreen") {
          return true;
        }
      }

      return false;
    });
    session.fromPartition("persist:ytmview").setPermissionRequestHandler((webContents, permission, callback) => {
      if (webContents == this.ytmView.webContents) {
        if (permission === "fullscreen") {
          return callback(true);
        }
      }

      return callback(false);
    });
    //#endregion
  }

  public override onTerminated() {}

  public isInitialized() {
    return this.initialized;
  }

  public createView() {
    const configStore = this.getDependency(ConfigStore);
    const stateManager = this.getDependency(StateManager);
    const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);
    const windowManager = this.getDependency(AppWindowManager);

    this.setStatus(YTMViewStatus.Loading);

    let url = "https://music.youtube.com/";
    const continueWhereYouLeftOff: boolean = configStore.get("playback.continueWhereYouLeftOff");
    if (continueWhereYouLeftOff) {
      const lastUrl: string = configStore.get("state.lastUrl");
      if (lastUrl) {
        if (lastUrl.startsWith("https://music.youtube.com/")) {
          url = lastUrl;
        }
      }
    }

    this.ytmView = new AppView({
      name: "YTM",
      url,
      autoRecreate: true,
      autoCreate: true,
      viewState: {
        autoResize: {
          width: true,
          height: true,
          offsetHeight: {
            anchor: "Bottom",
            pixels: 36
          }
        }
      },
      electronOptions: {
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          partition: app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev",
          preload: path.join(import.meta.dirname, `../renderer/windows/ytmview/preload.js`),
          devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools"),
          autoplayPolicy: configStore.get("playback.continueWhereYouLeftOffPaused") ? "document-user-activation-required" : "no-user-gesture-required"
        }
      }
    });

    this.ytmView.on("ready", () => {
      this.ytmView.webContents.setZoomFactor(configStore.get("appearance.zoom") / 100);
      const url = new URL(this.ytmView.webContents.getURL());
      if (url.hostname === "music.youtube.com") {
        this.setStatus(YTMViewStatus.Hooking);
      } else {
        this.hooksReady = true;
        this.setupCompletionFlags = YTMViewSetupCompletionFlags.LocationNotApplicable;
        this.setStatus(YTMViewStatus.Ready);
      }
    });
    this.ytmView.on("recreated", () => {
      this.hooksReady = false;
      this.hookError = null;
      this.setStatus(YTMViewStatus.Loading);
      this.setWindowOpenHandler();

      this.emit("view-recreated");
    });

    this.ytmView.on("webcontents-enter-html-full-screen", () => {
      this.ytmView.setAutoResize({
        offsetHeight: {
          anchor: "Top",
          pixels: 0
        }
      });
    });
    this.ytmView.on("webcontents-leave-html-full-screen", () => {
      this.ytmView.setAutoResize({
        offsetHeight: {
          anchor: "Bottom",
          pixels: 36
        }
      });
    });
    this.ytmView.on("webcontents-did-navigate", () => {
      const url = this.ytmView.webContents.getURL();
      stateManager.updateState({
        lastUrl: url
      });
      this.sendNavigationHistory();
    });
    this.ytmView.on("webcontents-did-navigate-in-page", () => {
      const url = this.ytmView.webContents.getURL();
      stateManager.updateState({
        lastUrl: url
      });
      this.sendNavigationHistory();
    });
    this.ytmView.on("webcontents-context-menu", (_event, params) => {
      const menu: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [];

      if (params.spellcheckEnabled) {
        for (const suggestion of params.dictionarySuggestions) {
          menu.push({
            label: suggestion,
            click: () => this.ytmView.webContents.replaceMisspelling(suggestion)
          });
        }
      }

      if (params.linkURL) {
        if (menu.length > 0) {
          menu.push({
            type: "separator"
          });
        }

        menu.push({
          label: "Open Link in Browser",
          type: "normal",
          click: () => openExternalFromYtmView(params.linkURL)
        });
      }

      if (params.hasImageContents) {
        if (menu.length > 0) {
          menu.push({
            type: "separator"
          });
        }

        menu.push({
          label: "Open Image in Browser",
          type: "normal",
          click: () => openExternalFromYtmView(params.srcURL)
        });
      }

      if (params.isEditable) {
        if (menu.length > 0) {
          menu.push({
            type: "separator"
          });
        }

        menu.push({
          role: "undo",
          enabled: params.editFlags.canUndo,
          accelerator: "CommandOrControl+Z"
        });
        menu.push({
          role: "redo",
          enabled: params.editFlags.canRedo,
          accelerator: "CommandOrControl+Shift+Z"
        });
        menu.push({
          type: "separator"
        });
        menu.push({
          role: "cut",
          enabled: params.editFlags.canCut,
          accelerator: "CommandOrControl+X"
        });
        menu.push({
          role: "copy",
          enabled: params.editFlags.canCopy,
          accelerator: "CommandOrControl+C"
        });
        menu.push({
          role: "paste",
          enabled: params.editFlags.canPaste,
          accelerator: "CommandOrControl+V"
        });
        menu.push({
          role: "selectAll",
          enabled: params.editFlags.canSelectAll,
          accelerator: "CommandOrControl+A"
        });
      } else {
        if (params.selectionText) {
          menu.push({
            role: "copy",
            enabled: params.editFlags.canCopy,
            accelerator: "CommandOrControl+C"
          });
        }
        menu.push({
          role: "selectAll",
          enabled: params.editFlags.canSelectAll,
          accelerator: "CommandOrControl+A"
        });
      }

      if (configStore.get("developer.enableDevTools")) {
        if (menu.length > 0) {
          menu.push({
            type: "separator"
          });
        }
        menu.push({
          label: "Inspect",
          type: "normal",
          click: () => {
            this.ytmView.webContents.inspectElement(params.x, params.y);
          }
        });
      }

      Menu.buildFromTemplate(menu).popup({
        x: params.x,
        y: params.y,
        sourceType: params.menuSourceType
      });
    });
    this.ytmView.on("webcontents-will-navigate", event => {
      const url = new URL(event.url);
      if (isPreventedNavOrRedirect(url)) {
        event.preventDefault();
        log.info(`Blocking YTM View navigation to ${event.url}`);

        openExternalFromYtmView(event.url);
      }
    });
    this.ytmView.on("webcontents-will-redirect", event => {
      const url = new URL(event.url);
      if (isPreventedNavOrRedirect(url)) {
        event.preventDefault();
        log.info(`Blocking YTM View redirect to ${event.url}`);
      }

      if (
        (url.hostname === "www.youtube.com" && url.pathname === "/premium") ||
        (url.hostname === "youtube.com" && url.pathname === "/premium") ||
        (url.hostname === "www.youtube.com" && url.pathname === "/musicpremium") ||
        (url.hostname === "youtube.com" && url.pathname === "/musicpremium")
      ) {
        // This users region requires a premium subscription to use YTM
        this.ytmView.webContents.loadURL(
          "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"
        );
      }
    });
    this.ytmView.on("webcontents-unresponsive", () => {
      memoryStore.set("ytmViewUnresponsive", true);
      this.emit("unresponsive");
    });
    this.ytmView.on("webcontents-responsive", () => {
      memoryStore.set("ytmViewUnresponsive", false);
      this.emit("responsive");
    });
    this.ytmView.on("webcontents-page-title-updated", (event, title) => {
      this.emit("title-updated", title);
    });
    this.setWindowOpenHandler();

    // YTM View IPC
    this.ytmView.ipcOn("ytmView:ready", async (event, setupCompletionFlags) => {
      this.hooksReady = true;
      this.setupCompletionFlags = setupCompletionFlags;
      this.setStatus(YTMViewStatus.Ready);
    });
    this.ytmView.ipcOn("ytmView:errored", (_event, error) => {
      this.hookError = error;
    });

    // YTM API IPC
    this.ytmView.ipcOn("ytmApi:videoProgressChanged", (_event, progress) => {
      playerStateStore.updateVideoProgress(progress);

      if (windowManager.hasWindow("Miniplayer")) {
        windowManager.getWindow("Miniplayer").ipcBroadcast("playerStateStore:stateChanged", playerStateStore.getState());
      }
    });
    this.ytmView.ipcOn("ytmApi:videoStateChanged", (_event, state) => {
      playerStateStore.updateVideoState(state);

      if (windowManager.hasWindow("Miniplayer")) {
        windowManager.getWindow("Miniplayer").ipcBroadcast("playerStateStore:stateChanged", playerStateStore.getState());
      }
    });
    this.ytmView.ipcOn("ytmApi:videoDataChanged", (_event, videoDetails, playlistId, album, likeStatus, hasFullMetadata) => {
      stateManager.updateState({
        lastVideoId: videoDetails.videoId,
        lastPlaylistId: playlistId
      });
      playerStateStore.updateVideoDetails(videoDetails, playlistId, album, likeStatus, hasFullMetadata);

      if (windowManager.hasWindow("Miniplayer")) {
        const miniplayerWindow = windowManager.getWindow("Miniplayer");
        miniplayerWindow.ipcBroadcast("playerStateStore:stateChanged", playerStateStore.getState());

        if (hasFullMetadata) {
          miniplayerWindow.setTitle(`${videoDetails.title} - ${videoDetails.author} | YouTube Music Desktop App - Miniplayer`);
        } else {
          miniplayerWindow.setTitle("YouTube Music Desktop App - Miniplayer");
        }
      }

      const mainWindow = windowManager.getWindow("Main");
      if (mainWindow && hasFullMetadata) {
        mainWindow.setTitle(`${videoDetails.title} - ${videoDetails.author} | YouTube Music Desktop App`);
      } else {
        mainWindow.setTitle("YouTube Music Desktop App");
      }
    });
    this.ytmView.ipcOn("ytmApi:storeStateChanged", (_event, queue, likeStatus, volume, muted, adPlaying) => {
      playerStateStore.updateFromStore(queue, likeStatus, volume, muted, adPlaying);

      if (windowManager.hasWindow("Miniplayer")) {
        windowManager.getWindow("Miniplayer").ipcBroadcast("playerStateStore:stateChanged", playerStateStore.getState());
      }
    });
  }

  public getView() {
    return this.ytmView;
  }

  public async ready(): Promise<void> {
    await this.ytmView.ready();
    if (!this.hooksReady)
      await new Promise<void>(resolve => {
        const interval = setInterval(async () => {
          if (this.hooksReady) {
            clearInterval(interval);
            resolve();
          }
        }, 250);
      });
  }

  public hasError() {
    return this.hookError !== null;
  }

  public getError() {
    return this.hookError;
  }

  public getSetupFlags() {
    return this.setupCompletionFlags;
  }

  private setStatus(status: YTMViewStatus) {
    this._status = status;
    this.emit("status-changed");
  }

  private sendNavigationHistory() {
    this.ytmView.webContents.send("ytmView:navigationStateChanged", {
      canGoBack: this.ytmView.webContents.navigationHistory.canGoBack(),
      canGoForward: this.ytmView.webContents.navigationHistory.canGoForward()
    });
  }

  private setWindowOpenHandler() {
    this.ytmView.webContents.setWindowOpenHandler(details => {
      openExternalFromYtmView(details.url);

      return {
        action: "deny"
      };
    });
  }
}
