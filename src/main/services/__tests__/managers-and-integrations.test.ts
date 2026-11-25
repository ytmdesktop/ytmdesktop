import EventEmitter from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoState } from "~shared/playerstatestore/types";

const {
  mockRegisteredShortcuts,
  mockGlobalShortcut,
  mockNotifications,
  MockNotification,
  mockNativeImage,
  mockHttpsGet,
} = vi.hoisted(() => {
  const shortcuts = new Map<string, () => void>();
  const notifs: Array<{ opts: any; show: any; close: any }> = [];
  class Notif {
    public show = vi.fn();
    public close = vi.fn();
    constructor(public opts: any) {
      notifs.push({ opts, show: this.show, close: this.close });
    }
  }
  return {
    mockRegisteredShortcuts: shortcuts,
    mockGlobalShortcut: {
      unregisterAll: vi.fn(() => {
        shortcuts.clear();
      }),
      register: vi.fn((acc: string, cb: () => void) => {
        if (acc === "BAD+KEY") return false;
        if (acc === "THROW+KEY") throw new Error("boom");
        shortcuts.set(acc, cb);
        return true;
      }),
    },
    mockNotifications: notifs,
    MockNotification: Notif,
    mockNativeImage: {
      createFromPath: vi.fn((p: string) => ({ path: p })),
      createFromDataURL: vi.fn((url: string) => ({ url })),
    },
    mockHttpsGet: vi.fn(),
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => "/app"),
    getPath: vi.fn(() => require("node:os").tmpdir()),
  },
  globalShortcut: mockGlobalShortcut,
  nativeImage: mockNativeImage,
  Notification: MockNotification,
}));

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("https", () => ({
  default: {
    get: (...args: any[]) => mockHttpsGet(...args),
  },
}));

vi.mock("../../integrations/volume-ratio/script/enable.script?raw", () => ({
  default: "enable();",
}));
vi.mock("../../integrations/volume-ratio/script/disable.script?raw", () => ({
  default: "disable();",
}));
vi.mock(
  "../../integrations/volume-ratio/script/forceupdatevolume.script?raw",
  () => ({
    default: "forceUpdate();",
  }),
);

import Integration from "../../integrations/integration";
import IntegrationManager, {
  IntegrationManagerHook,
} from "../integrationmanager";
import ShortcutManager from "../shortcutmanager";
import TaskbarManager from "../taskbarmanager";
import VolumeRatio from "../../integrations/volume-ratio";
import CustomCSS from "../../integrations/custom-css";
import NowPlayingNotifications from "../../integrations/notifications";
import ConfigStore from "../configstore";
import MemoryStore from "../memorystore";
import ProtectedAPIManager from "../protectedapimanager";
import AppWindowManager from "../windowmanager";
import PlayerStateStore from "../playerstatestore";
import YTMViewManager from "../ytmviewmanager";
import { ServiceHost } from "../servicehost";

class DummyIntegration extends Integration {
  public name = "Dummy";
  public storeEnableProperty: Integration["storeEnableProperty"] =
    "playback.ratioVolume";
  public override dependentStoreProperties: Integration["dependentStoreProperties"] =
    ["appearance.zoom"];
  public calls: string[] = [];
  protected onSetup() {
    this.calls.push("setup");
  }
  protected onEnabled() {
    this.calls.push("enabled");
  }
  protected onDisabled() {
    this.calls.push("disabled");
  }
}

describe("managers & integrations", () => {
  beforeEach(() => {
    mockRegisteredShortcuts.clear();
    mockNotifications.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("IntegrationManager sets up, enables, disables, and restarts on dependent property changes", async () => {
    let anyChangeCb: ((n: any, o: any) => void) | null = null;
    const configStore = {
      get: vi.fn((k: string) => k === "playback.ratioVolume"),
      onDidAnyChange: vi.fn((cb: any) => {
        anyChangeCb = cb;
      }),
    };
    const fakeHost = {
      getService: vi.fn((svc: any) =>
        svc === ConfigStore ? configStore : null,
      ),
    } as unknown as ServiceHost;

    const mgr = new IntegrationManager();
    mgr[ServiceHost.INJECT](fakeHost);
    mgr.onPreInitialized();
    mgr.onInitialized();
    mgr.onPostInitialized();
    mgr.onTerminated();

    mgr.createIntegrations([DummyIntegration]);
    mgr.runHook(IntegrationManagerHook.AppBeforeReady);
    mgr.runHook(IntegrationManagerHook.AppReady);
    await new Promise((r) => setTimeout(r, 10));

    // Dependent property changed -> restarts
    await anyChangeCb!(
      { playback: { ratioVolume: true }, appearance: { zoom: 110 } },
      { playback: { ratioVolume: true }, appearance: { zoom: 100 } },
    );
    // Disabled
    await anyChangeCb!(
      { playback: { ratioVolume: false }, appearance: { zoom: 110 } },
      { playback: { ratioVolume: true }, appearance: { zoom: 110 } },
    );
    expect(configStore.onDidAnyChange).toHaveBeenCalledTimes(1);
  });

  it("ShortcutManager registers, executes, and flags failing shortcuts", async () => {
    let shortcutChangeCb: ((s: any) => void) | null = null;
    const postMessage = vi.fn();
    const configStore = {
      get: vi.fn(() => ({
        playPause: "Ctrl+P",
        next: "BAD+KEY",
        previous: "THROW+KEY",
        thumbsUp: "Ctrl+1",
        thumbsDown: "Ctrl+2",
        volumeUp: "Ctrl+Up",
        volumeDown: "Ctrl+Down",
        volumeMute: "Ctrl+M",
        toggleShuffle: "Ctrl+S",
        toggleRepeat: "Ctrl+R",
      })),
      onDidChange: vi.fn((_k: string, cb: any) => {
        shortcutChangeCb = cb;
      }),
    };
    const memoryStore = { set: vi.fn() };
    const protectedApi = {
      createOrGetAPI: vi.fn(() => ({ postMessage })),
    };

    const sm = new ShortcutManager();
    sm[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === ConfigStore) return configStore;
        if (svc === MemoryStore) return memoryStore;
        if (svc === ProtectedAPIManager) return protectedApi;
        return null;
      },
    } as unknown as ServiceHost);

    sm.onPreInitialized();
    sm.onInitialized();
    expect(sm.initialized).toBe(true);
    expect(() => sm.onInitialized()).toThrow(/already initialized/i);
    sm.onPostInitialized();
    sm.onTerminated();

    expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalledTimes(1);
    expect(memoryStore.set).toHaveBeenCalledWith(
      "shortcutsPlayPauseRegisterFailed",
      false,
    );
    expect(memoryStore.set).toHaveBeenCalledWith(
      "shortcutsNextRegisterFailed",
      true,
    );
    expect(memoryStore.set).toHaveBeenCalledWith(
      "shortcutsPreviousRegisterFailed",
      true,
    );

    await mockRegisteredShortcuts.get("Ctrl+P")?.();
    expect(postMessage).toHaveBeenCalledWith("execute", "playPause");

    // Empty shortcuts clears all failure flags
    shortcutChangeCb!({});
    expect(memoryStore.set).toHaveBeenCalledWith(
      "shortcutsPlayPauseRegisterFailed",
      false,
    );
  });

  it("TaskbarManager updates thumbar buttons and progress bar on state/config changes", async () => {
    const setThumbarButtons = vi.fn();
    const setProgressBar = vi.fn();
    const postMessage = vi.fn();
    const playerEmitter = new EventEmitter();
    let playbackCb: ((s: any) => void) | null = null;
    let currentPlayerState: any = {
      trackState: VideoState.Playing,
      videoProgress: 30,
      videoDetails: { durationSeconds: 120 },
    };

    const configStore = {
      get: vi.fn(() => true),
      onDidChange: vi.fn((_k: string, cb: any) => {
        playbackCb = cb;
      }),
    };
    const windowManager = {
      hasWindow: vi.fn(() => true),
      getWindow: vi.fn(() => ({ setThumbarButtons, setProgressBar })),
    };
    const playerStateStore = Object.assign(playerEmitter, {
      getState: () => currentPlayerState,
    });
    const protectedApi = {
      createOrGetAPI: vi.fn(() => ({ postMessage })),
    };

    const tm = new TaskbarManager();
    tm[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === ConfigStore) return configStore;
        if (svc === AppWindowManager) return windowManager;
        if (svc === PlayerStateStore) return playerStateStore;
        if (svc === ProtectedAPIManager) return protectedApi;
        return null;
      },
    } as unknown as ServiceHost);

    tm.onPreInitialized();
    tm.onInitialized();
    expect(tm.initialized).toBe(true);
    expect(() => tm.onInitialized()).toThrow(/already initialized/i);
    tm.onPostInitialized();
    tm.onTerminated();

    expect(setThumbarButtons).toHaveBeenCalledTimes(1);
    expect(setProgressBar).toHaveBeenCalledWith(0.25, { mode: "normal" });

    const buttons = setThumbarButtons.mock.calls[0][0];
    await buttons[0].click();
    await buttons[1].click();
    await buttons[2].click();
    expect(postMessage).toHaveBeenCalledWith("execute", "previous");
    expect(postMessage).toHaveBeenCalledWith("execute", "playPause");
    expect(postMessage).toHaveBeenCalledWith("execute", "next");

    // Disable progressInTaskbar & clear videoDetails
    currentPlayerState = {
      trackState: VideoState.Paused,
      videoProgress: 0,
      videoDetails: null,
    };
    playbackCb!({ progressInTaskbar: false });
    expect(setProgressBar).toHaveBeenLastCalledWith(-1);
  });

  it("VolumeRatio injects enable/disable scripts and handles view-recreated", async () => {
    const send = vi.fn();
    const ytmEmitter = new EventEmitter();
    const ytmViewManager = Object.assign(ytmEmitter, {
      ready: vi.fn(async () => {}),
      getView: () => ({ webContents: { send } }),
    });

    const vr = new VolumeRatio();
    vr[ServiceHost.INJECT]({
      getService: (svc: any) =>
        svc === YTMViewManager ? ytmViewManager : null,
    } as unknown as ServiceHost);

    vr[IntegrationManager.SETUP]();
    await vr[IntegrationManager.ENABLE]();
    expect(send).toHaveBeenCalledWith("ytmView:executeScript", "enable();");
    expect(send).toHaveBeenCalledWith(
      "ytmView:executeScript",
      "forceUpdate();",
    );

    ytmEmitter.emit("view-recreated");
    await new Promise((r) => setTimeout(r, 10));
    expect(send).toHaveBeenCalledTimes(4);

    await vr[IntegrationManager.DISABLE]();
    expect(send).toHaveBeenCalledWith("ytmView:executeScript", "disable();");
  });

  it("CustomCSS injects, watches, updates, and removes CSS", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytmd-css-"));
    const cssPath = path.join(tmpDir, "custom.css");
    fs.writeFileSync(cssPath, "body { color: red; }");

    const insertCSS = vi.fn(async () => "css-key-1");
    const removeInsertedCSS = vi.fn(async () => {});
    const ytmEmitter = new EventEmitter();
    const ytmViewManager = Object.assign(ytmEmitter, {
      ready: vi.fn(async () => {}),
      getView: () => ({ webContents: { insertCSS, removeInsertedCSS } }),
    });

    const storeUnsub = vi.fn();
    let appearanceCb: ((n: any, o: any) => void) | null = null;
    const configStore = {
      get: vi.fn(() => cssPath),
      set: vi.fn(),
      onDidChange: vi.fn((_k: string, cb: any) => {
        appearanceCb = cb;
        return storeUnsub;
      }),
    };

    const customCss = new CustomCSS();
    customCss[ServiceHost.INJECT]({
      getService: (svc: any) =>
        svc === YTMViewManager ? ytmViewManager : configStore,
    } as unknown as ServiceHost);

    customCss[IntegrationManager.SETUP]();
    await customCss[IntegrationManager.ENABLE]();
    await new Promise((r) => setTimeout(r, 20));
    expect(insertCSS).toHaveBeenCalledWith("body { color: red; }", {
      cssOrigin: "user",
    });

    appearanceCb!(
      { customCSSEnabled: true, customCSSPath: cssPath },
      { customCSSEnabled: true, customCSSPath: "old.css" },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(removeInsertedCSS).toHaveBeenCalledWith("css-key-1");

    await customCss[IntegrationManager.DISABLE]();
    expect(storeUnsub).toHaveBeenCalled();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("NowPlayingNotifications displays notifications with and without thumbnails", async () => {
    vi.useFakeTimers();
    const playerEmitter = new EventEmitter();
    const np = new NowPlayingNotifications();
    np[ServiceHost.INJECT]({
      getService: (svc: any) =>
        svc === PlayerStateStore ? playerEmitter : null,
    } as unknown as ServiceHost);

    np[IntegrationManager.SETUP]();
    await np[IntegrationManager.ENABLE]();

    // Without thumbnails
    playerEmitter.emit("state-changed", {
      trackState: VideoState.Playing,
      videoDetails: { id: "v1", title: "Song 1", author: "Artist 1", thumbnails: [] },
    });
    expect(mockNotifications).toHaveLength(1);
    expect(mockNotifications[0].opts.title).toBe("Song 1");
    vi.advanceTimersByTime(5000);
    expect(mockNotifications[0].close).toHaveBeenCalled();

    // Same videoId deduplicated
    playerEmitter.emit("state-changed", {
      trackState: VideoState.Playing,
      videoDetails: { id: "v1", title: "Song 1", author: "Artist 1", thumbnails: [] },
    });
    expect(mockNotifications).toHaveLength(1);

    // With thumbnail > 100x100
    mockHttpsGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      const res = new EventEmitter();
      const req = new EventEmitter();
      queueMicrotask(() => {
        cb(res);
        res.emit("data", Buffer.from("imgbytes"));
        res.emit("end");
      });
      return req;
    });

    playerEmitter.emit("state-changed", {
      trackState: VideoState.Playing,
      videoDetails: {
        id: "v2",
        title: "Song 2",
        author: "Artist 2",
        thumbnails: [{ url: "https://i.ytimg.com/vi/v2/hq.jpg", width: 320, height: 180 }],
      },
    });
    await vi.runAllTimersAsync();
    expect(mockNotifications).toHaveLength(2);
    expect(mockNotifications[1].opts.icon).toEqual({
      url: "data:image/jpeg;base64,aW1nYnl0ZXM=",
    });

    await np[IntegrationManager.DISABLE]();
  });
});
