import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependencyConstructor } from "~shared/types";

const {
  ipcHandlers,
  ipcListeners,
  logHooks,
  getErrorHandlerConfig,
  setErrorHandlerConfig,
  mockUserDataDir,
  mockApp,
  mockDialog,
  mockClipboard,
  mockCrashReporter,
  mockLog,
} = vi.hoisted(() => {
  const osMod = require("node:os");
  const pathMod = require("node:path");
  const handlers = new Map<string, (...args: any[]) => any>();
  const listeners = new Map<string, (...args: any[]) => any>();
  const hooks: Array<(msg: any, transport: any) => any> = [];
  let errCfg: any = null;
  const userDir = pathMod.join(osMod.tmpdir(), `ytmd-test-${process.pid}`);
  return {
    ipcHandlers: handlers,
    ipcListeners: listeners,
    logHooks: hooks,
    getErrorHandlerConfig: () => errCfg,
    setErrorHandlerConfig: (cfg: any) => {
      errCfg = cfg;
    },
    mockUserDataDir: userDir,
    mockApp: {
      isPackaged: false,
      getAppPath: vi.fn(() => "/app"),
      getPath: vi.fn(() => userDir),
      isReady: vi.fn(() => true),
      exit: vi.fn(),
    },
    mockDialog: {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showMessageBoxSync: vi.fn(() => 1),
      showErrorBox: vi.fn(),
    },
    mockClipboard: {
      writeText: vi.fn(),
    },
    mockCrashReporter: {
      start: vi.fn(),
    },
    mockLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      hooks,
      transports: {
        console: { format: "" },
        file: { format: "" },
      },
      eventLogger: { format: "" },
      errorHandler: {
        startCatching: vi.fn((cfg: any) => {
          errCfg = cfg;
        }),
      },
    },
  };
});

vi.mock("electron", () => ({
  app: mockApp,
  ipcMain: {
    handle: vi.fn((ch: string, fn: (...args: any[]) => any) => {
      ipcHandlers.set(ch, fn);
    }),
    on: vi.fn((ch: string, fn: (...args: any[]) => any) => {
      ipcListeners.set(ch, fn);
    }),
  },
  dialog: mockDialog,
  clipboard: mockClipboard,
  crashReporter: mockCrashReporter,
}));

vi.mock("electron-log", () => ({
  default: mockLog,
}));

import Service, { EventEmitterService } from "../service";
import { ServiceCollection } from "../servicecollection";
import { ServiceHost } from "../servicehost";
import MemoryStore from "../memorystore";
import StateManager from "../statemanager";
import WatchDog, { WatchDogApplicationState } from "../watchdog";
import ConfigStore from "../configstore";
import AppWindowManager from "../windowmanager";
import { getControlsIconPath, getIconPath, v1ConfigMigration } from "../../util";

class DepA extends Service {
  public calls: string[] = [];
  public onPreInitialized() {
    this.calls.push("pre");
  }
  public onInitialized() {
    this.calls.push("init");
  }
  public onPostInitialized() {
    this.calls.push("post");
  }
  public onTerminated() {
    this.calls.push("term");
  }
}

class DepB extends EventEmitterService<{ ping: [number] }> {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [
    DepA,
  ];
  public onPreInitialized() {}
  public onInitialized() {}
  public onPostInitialized() {}
  public onTerminated() {}
  public fire(n: number) {
    return this.emit("ping", n);
  }
}

describe("core services & utils", () => {
  beforeEach(async () => {
    ipcHandlers.clear();
    ipcListeners.clear();
    logHooks.length = 0;
    setErrorHandlerConfig(null);
    vi.clearAllMocks();
    await fs.rm(mockUserDataDir, { recursive: true, force: true });
    await fs.mkdir(mockUserDataDir, { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(mockUserDataDir, { recursive: true, force: true });
  });

  it("ServiceCollection orders dependencies and detects duplicates, missing deps, and cycles", () => {
    const col = new ServiceCollection();
    col.addServices([DepB, DepA]);
    const ordered = col.getDependencyOrderedServices();
    expect(ordered).toEqual([DepA, DepB]);

    expect(() => col.addServices([DepA])).toThrow(/already exists/i);

    const missing = new ServiceCollection();
    missing.addServices([DepB]);
    expect(() => missing.getDependencyOrderedServices()).toThrow(
      /not in the service collection/i,
    );

    class Cycle1 extends Service {
      public static override dependencies: DependencyConstructor<Service>[] = [];
      public onPreInitialized() {}
      public onInitialized() {}
      public onPostInitialized() {}
      public onTerminated() {}
    }
    class Cycle2 extends Service {
      public static override dependencies: DependencyConstructor<Service>[] = [
        Cycle1,
      ];
      public onPreInitialized() {}
      public onInitialized() {}
      public onPostInitialized() {}
      public onTerminated() {}
    }
    Cycle1.dependencies = [Cycle2];
    const cyc = new ServiceCollection();
    cyc.addServices([Cycle1, Cycle2]);
    expect(() => cyc.getDependencyOrderedServices()).toThrow(/circular/i);
  });

  it("ServiceHost runs all lifecycles and resolves/validates getDependency & EventEmitterService", () => {
    const col = new ServiceCollection();
    col.addServices([DepB, DepA]);
    const host = new ServiceHost(col);

    expect(host.initialized).toBe(false);
    const a = host.getService(DepA);
    const b = host.getService(DepB);

    expect(b.getDependency(DepA)).toBe(a);
    expect(() => a.getDependency(DepB)).toThrow(/does not depend on it/i);

    const received: number[] = [];
    const listener = (n: number) => received.push(n);
    b.on("ping", listener);
    b.once("ping", (n) => received.push(n * 10));
    b.fire(2);
    b.off("ping", listener);
    b.fire(3);
    expect(received).toEqual([2, 20]);

    host.runNextLifecycle(); // PreInitialized
    expect(host.initialized).toBe(false);
    host.runNextLifecycle(); // Initialized
    expect(host.initialized).toBe(true);
    host.runNextLifecycle(); // PostInitialized
    expect(host.initialized).toBe(true);
    host.runNextLifecycle(); // Terminated
    expect(a.calls).toEqual(["pre", "init", "post", "term"]);
  });

  it("MemoryStore handles get/set, IPC handlers, listeners, and window broadcasts", () => {
    const broadcast = vi.fn();
    class FakeWindowManager extends Service {
      public getWindows() {
        return [{ ipcBroadcast: broadcast }];
      }
      public onPreInitialized() {}
      public onInitialized() {}
      public onPostInitialized() {}
      public onTerminated() {}
    }

    const store = new MemoryStore<{
      listenTogetherPendingColdStart: boolean;
    }>();
    const fakeHost = {
      getService: vi.fn((svc: any) =>
        svc === AppWindowManager ? new FakeWindowManager() : store,
      ),
    } as unknown as ServiceHost;
    // Inject fake host & test dependency lookup
    store[ServiceHost.INJECT](fakeHost);
    (MemoryStore as any).dependencies = [AppWindowManager];

    store.onPreInitialized();
    store.onInitialized();
    store.onPostInitialized();
    store.onTerminated();

    expect(store.get("listenTogetherPendingColdStart")).toBe(false);
    const seen: boolean[] = [];
    const cb = (next: any) => seen.push(next.listenTogetherPendingColdStart);
    store.onStateChanged(cb);

    store.set("listenTogetherPendingColdStart", true);
    expect(seen).toEqual([true]);
    expect(broadcast).toHaveBeenCalledWith(
      "memoryStore:stateChanged",
      expect.objectContaining({ listenTogetherPendingColdStart: true }),
      expect.objectContaining({ listenTogetherPendingColdStart: false }),
    );

    expect(
      ipcHandlers.get("memoryStore:get")?.(null, "listenTogetherPendingColdStart"),
    ).toBe(true);

    store.removeOnStateChanged(cb);
    ipcListeners.get("memoryStore:set")?.(
      null,
      "listenTogetherPendingColdStart",
      false,
    );
    expect(store.get("listenTogetherPendingColdStart")).toBe(false);
    expect(seen).toEqual([true]);
  });

  it("WatchDog initializes once, sanitizes logs, and executes crash callbacks", async () => {
    const wd = new WatchDog();
    expect(wd.initialized).toBe(false);
    expect(wd.applicationState).toBe(WatchDogApplicationState.Normal);

    wd.onPreInitialized();
    wd.onInitialized();
    wd.onPostInitialized();
    wd.onTerminated();
    expect(wd.initialized).toBe(true);
    expect(() => wd.onInitialized()).toThrow(/already initialized/i);

    // Log sanitization hook
    const hook = logHooks[0];
    expect(hook({ data: ["ok"] }, mockLog.transports.console)).toEqual({
      data: ["ok"],
    });
    expect(
      hook(
        { data: [new String("Third-party cookie will be blocked.")] },
        mockLog.transports.file,
      ),
    ).toBe(false);
    const redactedMsg = hook(
      { data: [new String("https://example.com/secret/token")] },
      mockLog.transports.file,
    );
    expect(String(redactedMsg.data[0])).toContain("[REDACTED]");

    const cbOk = vi.fn();
    const cbFail = vi.fn(() => {
      throw new Error("cb boom");
    });
    const cbRemoved = vi.fn();
    wd.on("crash", cbOk);
    wd.on("crash", cbFail);
    wd.on("crash", cbRemoved);
    wd.off("crash", cbRemoved);

    // Renderer crash ignored
    await getErrorHandlerConfig().onError({
      error: new Error("r"),
      processType: "renderer",
      versions: { app: "2.1", electron: "45", os: "linux" },
    });
    expect(cbOk).not.toHaveBeenCalled();

    // Main crash when app ready -> Copy & Exit (button 0)
    mockDialog.showMessageBoxSync.mockReturnValueOnce(0);
    await getErrorHandlerConfig().onError({
      error: new Error("boom"),
      processType: "main",
      versions: { app: "2.1", electron: "45", os: "linux" },
    });
    expect(wd.applicationState).toBe(WatchDogApplicationState.Crashed);
    expect(cbOk).toHaveBeenCalledTimes(1);
    expect(cbRemoved).not.toHaveBeenCalled();
    expect(mockClipboard.writeText).toHaveBeenCalled();
    expect(mockApp.exit).toHaveBeenCalledWith(1);

    // App not ready -> showErrorBox
    mockApp.isReady.mockReturnValueOnce(false);
    await getErrorHandlerConfig().onError({
      error: new Error("early"),
      processType: "main",
      versions: { app: "2.1", electron: "45", os: "linux" },
    });
    expect(mockDialog.showErrorBox).toHaveBeenCalled();
  });

  it("StateManager debounces updates, flushes at 512 updates, forceWrites, and stops on panic", () => {
    vi.useFakeTimers();
    const fakeStore = {
      get: vi.fn(() => ({ lastUrl: "https://music.youtube.com" })),
      set: vi.fn(),
    };
    const wd = new WatchDog();
    const sm = new StateManager();
    const fakeHost = {
      getService: vi.fn((svc: any) =>
        svc === ConfigStore ? fakeStore : svc === WatchDog ? wd : sm,
      ),
    } as unknown as ServiceHost;
    sm[ServiceHost.INJECT](fakeHost);

    // Before init, updateState/forceWrite are no-ops
    sm.updateState({ lastUrl: "ignored" });
    sm.forceWrite();
    expect(fakeStore.set).not.toHaveBeenCalled();

    sm.onPreInitialized();
    sm.onInitialized();
    expect(() => sm.onInitialized()).toThrow(/already initialized/i);
    sm.onPostInitialized();

    // Identical state is skipped
    sm.updateState({ lastUrl: "https://music.youtube.com" });
    vi.advanceTimersByTime(31_000);
    expect(fakeStore.set).not.toHaveBeenCalled();

    // Changed state writes after 30s debounce
    sm.updateState({ lastUrl: "https://music.youtube.com/explore" });
    expect(fakeStore.set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(fakeStore.set).toHaveBeenCalledWith("state", {
      lastUrl: "https://music.youtube.com/explore",
    });

    // 512 updates triggers immediate write
    fakeStore.set.mockClear();
    for (let i = 0; i < 512; i++) {
      sm.updateState({ lastUrl: `https://music.youtube.com/u/${i}` });
    }
    expect(fakeStore.set).toHaveBeenCalledTimes(1);

    // onTerminated forceWrites
    sm.updateState({ lastUrl: "https://music.youtube.com/final" });
    sm.onTerminated();
    expect(fakeStore.set).toHaveBeenCalledWith("state", {
      lastUrl: "https://music.youtube.com/final",
    });
  });

  it("util paths and v1ConfigMigration handle migration and errors", async () => {
    expect(getIconPath("app.png")).toBe("/app/src/assets/icons/app.png");
    expect(getControlsIconPath("play.png")).toBe(
      "/app/src/assets/icons/controls/play.png",
    );

    const v1Dir = path.join(mockUserDataDir, "..", "youtube-music-desktop-app");
    const v1CustomCssDir = path.join(v1Dir, "custom", "css");
    await fs.mkdir(v1CustomCssDir, { recursive: true });
    await fs.writeFile(path.join(v1CustomCssDir, "page.css"), "body{}");
    await fs.writeFile(
      path.join(v1Dir, "config.json"),
      JSON.stringify({
        "settings-companion-server": true,
        "settings-continue-where-left-of": true,
        "settings-custom-css-page": true,
        "settings-decibel-volume": true,
        "settings-discord-rich-presence": true,
        "settings-page-zoom": 125,
        "settings-keep-background": true,
        "settings-show-notifications": true,
        "settings-start-minimized": true,
        "settings-start-on-boot": true,
        "settings-surround-sound": true,
        "settings-accelerators": {
          "media-play-pause": "MediaPlayPause",
          "media-track-next": "MediaNextTrack",
          "media-track-previous": "MediaPreviousTrack",
          "media-track-like": "Ctrl+L",
          "media-track-dislike": "Ctrl+D",
          "media-volume-up": "Ctrl+Up",
          "media-volume-down": "Ctrl+Down",
        },
        "last-fm-login": { username: "alice", password: "secret" },
      }),
    );

    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });
    const fakeConfigStore = { set: vi.fn() } as unknown as ConfigStore;

    await v1ConfigMigration(fakeConfigStore);
    expect(fakeConfigStore.set).toHaveBeenCalledWith(
      "integrations.companionServerEnabled",
      true,
    );
    expect(fakeConfigStore.set).toHaveBeenCalledWith(
      "integrations.lastFMEnabled",
      true,
    );
    expect(fakeConfigStore.set).toHaveBeenCalledWith(
      "shortcuts.playPause",
      "MediaPlayPause",
    );

    // Second run sees .first-run and skips
    (fakeConfigStore.set as any).mockClear();
    await v1ConfigMigration(fakeConfigStore);
    expect(fakeConfigStore.set).not.toHaveBeenCalled();

    // Cleanup v1Dir
    await fs.rm(v1Dir, { recursive: true, force: true });
  });
});
