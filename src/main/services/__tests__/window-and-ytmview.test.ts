import EventEmitter from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBrowserWindows,
  mockBaseWindows,
  mockApp,
  mockSession,
  mockShell,
  mockDialog,
  mockMenu,
  mockAppViews,
} = vi.hoisted(() => {
  const { EventEmitter: EE } = require("node:events");
  const browserWins: any[] = [];
  const baseWins: any[] = [];
  const views: any[] = [];

  class FakeWebContents extends EE {
    public id = 101;
    public send = vi.fn();
    public executeJavaScript = vi.fn(async () => {});
    public setZoomFactor = vi.fn();
    public getZoomFactor = vi.fn(() => 1);
    public setWindowOpenHandler = vi.fn();
    public isDestroyed = vi.fn(() => false);
    public ipc = Object.assign(new EE(), {
      handle: vi.fn(),
      removeHandler: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    });
  }

  class FakeBrowserWindow extends EE {
    public webContents = new FakeWebContents();
    public contentView = {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
      children: [] as any[],
    };
    public loadURL = vi.fn();
    public loadFile = vi.fn();
    public show = vi.fn();
    public hide = vi.fn();
    public focus = vi.fn();
    public minimize = vi.fn();
    public maximize = vi.fn();
    public unmaximize = vi.fn();
    public isMaximized = vi.fn(() => false);
    public isMinimized = vi.fn(() => false);
    public isVisible = vi.fn(() => true);
    public isDestroyed = vi.fn(() => false);
    public close = vi.fn(() => this.emit("close", { preventDefault: vi.fn() }));
    public destroy = vi.fn(() => this.emit("closed"));
    public getBounds = vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }));
    public setBounds = vi.fn();
    public getContentSize = vi.fn(() => [800, 600]);
    public setThumbarButtons = vi.fn();
    public setProgressBar = vi.fn();
    public setTitle = vi.fn();
    public setMenu = vi.fn();
    public removeMenu = vi.fn();
    constructor(public opts: any) {
      super();
      browserWins.push(this);
    }
  }

  class FakeBaseWindow extends FakeBrowserWindow {
    constructor(opts: any) {
      super(opts);
      baseWins.push(this);
    }
  }

  class FakeAppView extends EE {
    public view = {
      webContents: new FakeWebContents(),
      setBounds: vi.fn(),
    };
    public get webContents() {
      return this.view.webContents;
    }
    public isDestroyed = false;
    public ready = vi.fn(async () => {});
    public destroy = vi.fn();
    public setBounds = vi.fn();
    public getBounds = vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }));
    public ipcSend = vi.fn();
    public ipcHandle = vi.fn();
    public ipcOn = vi.fn();
    constructor(public name: string, public opts: any) {
      super();
      views.push(this);
    }
  }

  let permCheckHandler: any = null;
  let permReqHandler: any = null;
  const fakeSession = {
    fromPartition: vi.fn(() => ({
      setPermissionCheckHandler: vi.fn((fn: any) => {
        permCheckHandler = fn;
      }),
      setPermissionRequestHandler: vi.fn((fn: any) => {
        permReqHandler = fn;
      }),
      webRequest: { onBeforeSendHeaders: vi.fn() },
    })),
    getPermCheckHandler: () => permCheckHandler,
    getPermReqHandler: () => permReqHandler,
  };

  return {
    mockBrowserWindows: browserWins,
    mockBaseWindows: baseWins,
    mockAppViews: views,
    FakeAppView,
    mockApp: {
      isPackaged: false,
      getPath: vi.fn(() => "/tmp/ytmd"),
      getAppPath: vi.fn(() => "/app"),
      getVersion: vi.fn(() => "2.1.0"),
      isReady: vi.fn(() => true),
      whenReady: vi.fn(async () => {}),
    },
    mockSession: fakeSession,
    mockShell: { openExternal: vi.fn() },
    mockDialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
    mockMenu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  };
});

vi.mock("electron", () => ({
  app: mockApp,
  BaseWindow: class extends EventEmitter {
    constructor(opts: any) {
      super();
      const inst = new (require("node:events").EventEmitter)();
      Object.assign(inst, {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn(), children: [] },
        show: vi.fn(),
        hide: vi.fn(),
        focus: vi.fn(),
        minimize: vi.fn(),
        maximize: vi.fn(),
        unmaximize: vi.fn(),
        isMaximized: vi.fn(() => false),
        isMinimized: vi.fn(() => false),
        isFullScreen: vi.fn(() => false),
        isAlwaysOnTop: vi.fn(() => false),
        isVisible: vi.fn(() => true),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        destroy: vi.fn(),
        getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
        setBounds: vi.fn(),
        getSize: vi.fn(() => [800, 600]),
        getContentSize: vi.fn(() => [800, 600]),
        setThumbarButtons: vi.fn(),
        setProgressBar: vi.fn(),
        setTitle: vi.fn(),
        setMenu: vi.fn(),
        removeMenu: vi.fn(),
      });
      mockBaseWindows.push(inst);
      return inst as any;
    }
  },
  BrowserWindow: class extends EventEmitter {
    constructor(opts: any) {
      super();
      const wc = Object.assign(new EventEmitter(), {
        id: 101,
        send: vi.fn(),
        openDevTools: vi.fn(),
        executeJavaScript: vi.fn(async () => {}),
        setZoomFactor: vi.fn(),
        getZoomFactor: vi.fn(() => 1),
        setWindowOpenHandler: vi.fn(),
        isDestroyed: vi.fn(() => false),
        ipc: Object.assign(new EventEmitter(), {
          handle: vi.fn(),
          removeHandler: vi.fn(),
          on: vi.fn(),
          removeListener: vi.fn(),
        }),
      });
      const inst = Object.assign(new EventEmitter(), {
        webContents: wc,
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn(), children: [] },
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        focus: vi.fn(),
        minimize: vi.fn(),
        maximize: vi.fn(),
        unmaximize: vi.fn(),
        isMaximized: vi.fn(() => false),
        isMinimized: vi.fn(() => false),
        isFullScreen: vi.fn(() => false),
        isAlwaysOnTop: vi.fn(() => false),
        isVisible: vi.fn(() => true),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        destroy: vi.fn(),
        getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
        setBounds: vi.fn(),
        getSize: vi.fn(() => [800, 600]),
        getContentSize: vi.fn(() => [800, 600]),
        setThumbarButtons: vi.fn(),
        setProgressBar: vi.fn(),
        setTitle: vi.fn(),
        setMenu: vi.fn(),
        removeMenu: vi.fn(),
        opts,
      });
      mockBrowserWindows.push(inst);
      return inst as any;
    }
  },
  session: mockSession,
  shell: mockShell,
  dialog: mockDialog,
  Menu: mockMenu,
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AppWindow } from "../windowmanager/appwindow";
import { AppView } from "../windowmanager/appview";
import AppWindowManager from "../windowmanager";
import YTMViewManager from "../ytmviewmanager";
import ConfigStore from "../configstore";
import StateManager from "../statemanager";
import MemoryStore from "../memorystore";
import { ServiceHost } from "../servicehost";

describe("AppWindow & YTMViewManager", () => {
  beforeEach(() => {
    mockBrowserWindows.length = 0;
    mockBaseWindows.length = 0;
    mockAppViews.length = 0;
    vi.clearAllMocks();
  });

  it("AppWindow validates options, manages views, window state, IPC, and closure", () => {
    const fakeManager = {
      destroyWindow: vi.fn(),
    } as unknown as AppWindowManager;

    expect(
      () =>
        new AppWindow("Browser", fakeManager, {
          name: "bad",
          autoRecreate: false,
          electronOptions: {},
          waitForViews: false,
          url: "https://a.com",
          file: "/a.html",
        }),
    ).toThrow(/Only one of 'url' or 'file'/i);

    const win = new AppWindow("Browser", fakeManager, {
      name: "Settings",
      autoRecreate: false,
      electronOptions: {},
      waitForViews: false,
      windowState: { maximized: true },
      url: "https://settings.local",
    });

    const bw = mockBrowserWindows[0];
    expect(bw.loadURL).toHaveBeenCalledWith("https://settings.local");
    expect(win.webContents).toBe(bw.webContents);

    // Emit ready-to-show -> shows and maximizes window
    bw.emit("ready-to-show");
    expect(bw.maximize).toHaveBeenCalled();

    // Window events proxy through
    const resized = vi.fn();
    const moved = vi.fn();
    const maxed = vi.fn();
    const unmaxed = vi.fn();
    win.on("electronwindow-resize", resized);
    win.on("electronwindow-move", moved);
    win.on("electronwindow-maximize", maxed);
    win.on("electronwindow-unmaximize", unmaxed);

    bw.emit("resize");
    bw.emit("move");
    bw.emit("maximize");
    bw.emit("unmaximize");
    expect(resized).toHaveBeenCalledTimes(1);
    expect(moved).toHaveBeenCalledTimes(1);
    expect(maxed).toHaveBeenCalledTimes(1);
    expect(unmaxed).toHaveBeenCalledTimes(1);

    // State/IPC helpers
    win.ipcBroadcast("test:ev", 1, 2);
    expect(bw.webContents.send).toHaveBeenCalledWith("test:ev", 1, 2);

    win.setThumbarButtons([]);
    win.setProgressBar(0.5);
    expect(bw.setProgressBar).toHaveBeenCalledWith(0.5, undefined);

    win.destroyWindow();
    expect(bw.destroy).toHaveBeenCalled();
    expect(() => win.closeWindow()).toThrow(/destroyed/i);
  });

  it("AppWindow Base throws on webContents access and supports forceWindowClosure", () => {
    const fakeManager = {
      destroyWindow: vi.fn(),
    } as unknown as AppWindowManager;

    const baseWin = new AppWindow("Base", fakeManager, {
      name: "Main",
      autoRecreate: true,
      electronOptions: {},
      waitForViews: true,
    });
    expect(() => baseWin.webContents).toThrow(/does not contain a webContents/i);

    const bw = mockBaseWindows[0];
    baseWin.forceWindowClosure();
    const ev = { preventDefault: vi.fn() };
    bw.emit("close", ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("YTMViewManager initializes, registers permission handlers, and updates zoom", () => {
    let appearanceCb: ((n: any) => void) | null = null;
    const configStore = {
      get: vi.fn((k: string) => {
        if (k === "appearance.zoom") return 100;
        if (k === "playback.continueWhereYouLeftOff") return false;
        return null;
      }),
      onDidChange: vi.fn((_k: string, cb: any) => {
        appearanceCb = cb;
      }),
    };
    const stateManager = { updateState: vi.fn() };
    const memoryStore = { get: vi.fn(() => false), set: vi.fn() };
    const windowManager = { hasWindow: vi.fn(() => false) };

    const mgr = new YTMViewManager();
    mgr[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === ConfigStore) return configStore;
        if (svc === StateManager) return stateManager;
        if (svc === MemoryStore) return memoryStore;
        if (svc === AppWindowManager) return windowManager;
        return null;
      },
    } as unknown as ServiceHost);

    mgr.onPreInitialized();
    mgr.onInitialized();
    expect(mgr.isInitialized()).toBe(true);
    expect(() => mgr.onInitialized()).toThrow(/already initialized/i);
    mgr.onPostInitialized();
    mgr.onTerminated();

    // Verify permission handlers deny non-matching webContents and non-fullscreen
    const permCheck = mockSession.getPermCheckHandler();
    const permReq = mockSession.getPermReqHandler();
    expect(permCheck({}, "notifications")).toBe(false);
    const reqCb = vi.fn();
    permReq({}, "notifications", reqCb);
    expect(reqCb).toHaveBeenCalledWith(false);

    // Zoom callback safely handles null view
    appearanceCb!({ zoom: 120 });
    expect(mgr.getView()).toBeUndefined();
    expect(AppView).toBeDefined();
  });
});
