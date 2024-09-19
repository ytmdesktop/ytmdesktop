import { app, Menu, session, shell } from "electron";
import { AppView } from "./windowmanager/appview";
import { YTMViewStatus } from "~shared/types";
import EventEmitter from "node:events";
import playerStateStore from "./player-state-store";
import configStore from "./config-store";
import log from "electron-log";
import Manager from "./manager";
import statemanager from "./statemanager";
import memoryStore from "./memory-store";

declare const YTM_VIEW_PRELOAD_WEBPACK_ENTRY: string;

export type YTMViewManagerEventMap = {
  "status-changed": [];
  "view-recreated": [];
  "unresponsive": [];
  "responsive": [];
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
  if (domain === "google.com" || domain === "youtube.com") {
    shell.openExternal(urlString);
  }
}

class YTMViewManager extends EventEmitter<YTMViewManagerEventMap> implements Manager {
  private ytmView: AppView;
  private hooksReady = false;
  private hookError: Error | null = null;

  private _lateInitialized = false;
  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  private _status = YTMViewStatus.Loading;
  public get status() {
    return this._status;
  }

  public initialize() {
    if (this._initialized) throw new Error("YTMViewManager is already initialized!");
    this._initialized = true;

    configStore.onDidChange("appearance", newState => {
      if (this.ytmView) {
        this.ytmView.webContents.setZoomFactor(newState.zoom / 100);
      }
    });

    log.info("YTMViewManager initialized");
  }

  public lateInitialize() {
    if (!this._initialized) throw new Error("YTMViewManager is not initialized and cannot call lateInitialize");
    if (this._lateInitialized) throw new Error("YTMViewManager is already late initialized!");
    this._lateInitialized = true;

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

  public isInitialized() {
    return this.initialized;
  }

  public createView() {
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
          preload: YTM_VIEW_PRELOAD_WEBPACK_ENTRY,
          devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools"),
          autoplayPolicy: configStore.get("playback.continueWhereYouLeftOffPaused") ? "document-user-activation-required" : "no-user-gesture-required"
        }
      }
    });

    this.ytmView.on("ready", () => {
      this.ytmView.webContents.setZoomFactor(configStore.get("appearance.zoom") / 100);
      this.setStatus(YTMViewStatus.Hooking);
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
      statemanager.updateState({
        lastUrl: url
      });
      this.sendNavigationHistory();
    });
    this.ytmView.on("webcontents-did-navigate-in-page", () => {
      const url = this.ytmView.webContents.getURL();
      statemanager.updateState({
        lastUrl: url
      });
      this.sendNavigationHistory();
    });
    this.ytmView.on("webcontents-context-menu", (_event, params) => {
      if (configStore.get("developer.enableDevTools")) {
        Menu.buildFromTemplate([
          {
            label: "YouTube Music Desktop App",
            type: "normal",
            enabled: false
          },
          {
            type: "separator"
          },
          {
            label: "Open Developer Tools",
            type: "normal",
            click: () => {
              this.ytmView.webContents.openDevTools({
                mode: "detach"
              });
            }
          }
        ]).popup({
          x: params.x,
          y: params.y,
          sourceType: params.menuSourceType
        });
      }
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
    this.setWindowOpenHandler();

    // YTM View IPC
    this.ytmView.ipcOn("ytmView:ready", () => {
      this.hooksReady = true;
      this.setStatus(YTMViewStatus.Ready);
    });
    this.ytmView.ipcOn("ytmView:errored", (_event, error) => {
      this.hookError = error;
    });

    // YTM API IPC
    this.ytmView.ipcOn("ytmApi:videoProgressChanged", (_event, progress) => {
      playerStateStore.updateVideoProgress(progress);
    });
    this.ytmView.ipcOn("ytmApi:videoStateChanged", (_event, state) => {
      playerStateStore.updateVideoState(state);
    });
    this.ytmView.ipcOn("ytmApi:videoDataChanged", (_event, videoDetails, playlistId, album, likeStatus, hasFullMetadata) => {
      statemanager.updateState({
        lastVideoId: videoDetails.videoId,
        lastPlaylistId: playlistId
      });
      playerStateStore.updateVideoDetails(videoDetails, playlistId, album, likeStatus, hasFullMetadata);
    });
    this.ytmView.ipcOn("ytmApi:storeStateChanged", (_event, queue, likeStatus, volume, muted, adPlaying) => {
      playerStateStore.updateFromStore(queue, likeStatus, volume, muted, adPlaying);
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

export default new YTMViewManager();
