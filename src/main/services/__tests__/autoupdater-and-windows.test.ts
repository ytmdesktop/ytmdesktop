import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ipcHandlers,
  autoUpdaterEmitter,
  mockApp,
  mockAutoUpdater,
  mockAppWindowInstances,
} = vi.hoisted(() => {
  const { EventEmitter: EE } = require("node:events");
  const handlers = new Map<string, (...args: any[]) => any>();
  const updater = new EE();
  const winInstances: any[] = [];
  return {
    ipcHandlers: handlers,
    autoUpdaterEmitter: updater,
    mockApp: {
      isPackaged: true,
      getVersion: vi.fn(() => "2.1.0"),
    },
    mockAutoUpdater: Object.assign(updater, {
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    }),
    mockAppWindowInstances: winInstances,
  };
});

vi.mock("electron", () => ({
  app: mockApp,
  autoUpdater: mockAutoUpdater,
  ipcMain: {
    handle: vi.fn((ch: string, cb: (...args: any[]) => any) => {
      ipcHandlers.set(ch, cb);
    }),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../windowmanager/appwindow", () => ({
  AppWindow: class MockAppWindow {
    public name: string;
    public closeWindow = vi.fn();
    public destroyWindow = vi.fn();
    public forceWindowClosure = vi.fn();
    constructor(
      public windowType: any,
      public manager: any,
      public options: any,
    ) {
      this.name = options.name;
      mockAppWindowInstances.push(this);
    }
  },
}));

(globalThis as any).YTMD_DISABLE_UPDATES = false;
(globalThis as any).YTMD_UPDATE_FEED_OWNER = "ytmd";
(globalThis as any).YTMD_UPDATE_FEED_REPOSITORY = "ytmdesktop";

import AutoUpdater from "../autoupdater";
import AppWindowManager from "../windowmanager";
import MemoryStore from "../memorystore";
import { ServiceHost } from "../servicehost";

describe("AutoUpdater & AppWindowManager", () => {
  const origPlatform = process.platform;

  beforeEach(() => {
    ipcHandlers.clear();
    mockAppWindowInstances.length = 0;
    autoUpdaterEmitter.removeAllListeners();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("AutoUpdater initializes disabled on non-win32 and handles checkForUpdates", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const memoryStore = { set: vi.fn() };
    const au = new AutoUpdater();
    au[ServiceHost.INJECT]({
      getService: (svc: any) => (svc === MemoryStore ? memoryStore : null),
    } as unknown as ServiceHost);

    await expect(au.checkForUpdates(false)).rejects.toThrow(/not initialized/i);
    au.onPreInitialized();
    au.onInitialized();
    expect(au.initialized).toBe(true);
    expect(() => au.onInitialized()).toThrow(/already initialized/i);
    au.onPostInitialized();
    au.onTerminated();

    expect(au.isDisabled()).toBe(true);
    expect(memoryStore.set).toHaveBeenCalledWith("autoUpdaterDisabled", true);
    expect(await au.checkForUpdates(false)).toBe(false);
  });

  it("AutoUpdater runs full update lifecycle on win32 packaged app", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const memoryStore = { set: vi.fn() };
    const au = new AutoUpdater();
    au[ServiceHost.INJECT]({
      getService: (svc: any) => (svc === MemoryStore ? memoryStore : null),
    } as unknown as ServiceHost);

    au.onInitialized();
    expect(au.isDisabled()).toBe(false);
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      url: "https://github.com/ytmd/ytmdesktop/releases/latest/download",
    });

    autoUpdaterEmitter.emit("checking-for-update");
    autoUpdaterEmitter.emit("update-available");
    expect(await ipcHandlers.get("autoUpdater:isUpdateAvailable")?.()).toBe(true);
    expect(await ipcHandlers.get("autoUpdater:isUpdateDownloaded")?.()).toBe(false);

    const checkPromise = au.checkForUpdates(true);
    autoUpdaterEmitter.emit("update-downloaded");
    expect(await checkPromise).toBe(true);
    expect(await ipcHandlers.get("autoUpdater:isUpdateDownloaded")?.()).toBe(true);

    autoUpdaterEmitter.emit("update-not-available");
    autoUpdaterEmitter.emit("error", new Error("net"));

    au.quitAndInstall();
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("AppWindowManager creates, queries, closes, destroys, and force-closes windows", () => {
    const wm = new AppWindowManager();
    wm.onPreInitialized();
    wm.onInitialized();
    wm.onPostInitialized();
    wm.onTerminated();

    const w1 = wm.createWindow("Main" as any, { name: "Main" } as any);
    expect(() =>
      wm.createWindow("Main" as any, { name: "Main" } as any),
    ).toThrow(/already exists/i);

    expect(wm.hasWindow("Main")).toBe(true);
    expect(wm.hasWindow("Missing")).toBe(false);
    expect(wm.getWindow("Main")).toBe(w1);
    expect(wm.getWindows()).toEqual([w1]);

    wm.closeWindow(w1);
    expect((w1 as any).closeWindow).toHaveBeenCalledTimes(1);
    wm.forceWindowClosures();
    expect((w1 as any).forceWindowClosure).toHaveBeenCalledTimes(1);
    wm.destroyWindow(w1);
    expect((w1 as any).destroyWindow).toHaveBeenCalledTimes(1);
    expect(wm.hasWindow("Main")).toBe(false);

    expect(() => wm.closeWindow(w1)).toThrow(/not managed/i);
    expect(() => wm.destroyWindow(w1)).toThrow(/not managed/i);
  });
});
