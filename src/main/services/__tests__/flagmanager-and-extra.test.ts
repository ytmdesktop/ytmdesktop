import EventEmitter from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ipcHandlers,
  mockUnleashInstance,
  mockApp,
  mockSafeStorage,
} = vi.hoisted(() => {
  const { EventEmitter: EE } = require("node:events");
  const handlers = new Map<string, (...args: any[]) => any>();
  const unleash = Object.assign(new EE(), {
    isSynchronized: vi.fn(() => true),
    getFeatureToggleDefinition: vi.fn((name: string) => ({
      name,
      enabled: name === "feature_a",
    })),
    getFeatureToggleDefinitions: vi.fn(() => [
      { name: "feature_a", enabled: true },
      { name: "feature_b", enabled: false },
    ]),
  });
  return {
    ipcHandlers: handlers,
    mockUnleashInstance: unleash,
    mockApp: {
      isPackaged: false,
      getVersion: vi.fn(() => "2.1.0"),
      getPath: vi.fn(() => require("node:os").tmpdir()),
    },
    mockSafeStorage: {
      encryptStringAsync: vi.fn(async (s: string) => Buffer.from(s, "utf8")),
      decryptStringAsync: vi.fn(async (b: Buffer) => ({
        result: b.toString("utf8"),
      })),
    },
  };
});

vi.mock("electron", () => ({
  app: mockApp,
  ipcMain: {
    handle: vi.fn((ch: string, cb: (...args: any[]) => any) => {
      ipcHandlers.set(ch, cb);
    }),
  },
  safeStorage: mockSafeStorage,
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("unleash-client", () => ({
  Unleash: class MockUnleash {
    constructor() {
      return mockUnleashInstance;
    }
  },
}));

(globalThis as any).YTMD_UNLEASH_SERVER = "https://flags.example.com/api";
(globalThis as any).YTMD_UNLEASH_INSTANCE_ID = "inst-1";

import FlagManager from "../flagmanager";
import LastFMClient, {
  LastFMErrorCode,
} from "../../integrations/last-fm/last-fm-client";
import AppWindowManager from "../windowmanager";
import { ServiceHost } from "../servicehost";

describe("FlagManager & LastFMClient edge cases", () => {
  const sidPath = path.join(os.tmpdir(), ".unleash-sid");

  beforeEach(async () => {
    ipcHandlers.clear();
    mockUnleashInstance.removeAllListeners();
    vi.clearAllMocks();
    await fs.rm(sidPath, { force: true });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(sidPath, { force: true });
  });

  it("FlagManager initializes unleash, broadcasts changes, and serves IPC queries", async () => {
    const ipcBroadcast = vi.fn();
    const wm = { getWindows: () => [{ ipcBroadcast }] };
    const fm = new FlagManager();
    fm[ServiceHost.INJECT]({
      getService: (svc: any) => (svc === AppWindowManager ? wm : null),
    } as unknown as ServiceHost);

    fm.onPreInitialized();
    await fm.onInitialized();
    fm.onPostInitialized();
    fm.onTerminated();

    expect(fm.isSynchronized).toBe(true);
    expect(fm.getFlag("feature_a")).toBe(true);
    expect(fm.getFlag("feature_b")).toBe(false);
    expect(fm.getFlags()).toEqual([
      { name: "feature_a", enabled: true },
      { name: "feature_b", enabled: false },
    ]);

    expect(await ipcHandlers.get("flags:getFlag")?.(null, "feature_a")).toBe(
      true,
    );
    expect(await ipcHandlers.get("flags:getFlags")?.()).toHaveLength(2);

    const onReady = vi.fn();
    const onSync = vi.fn();
    const onChanged = vi.fn();
    fm.on("ready", onReady);
    fm.on("synchronized", onSync);
    fm.on("changed", onChanged);

    mockUnleashInstance.emit("ready");
    mockUnleashInstance.emit("synchronized");
    mockUnleashInstance.emit("changed");

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(ipcBroadcast).toHaveBeenCalledWith("flags:changed", fm.getFlags());

    // Re-running onInitialized reads existing .unleash-sid file
    await fm.onInitialized();
  });

  it("LastFMClient handles transient retries with Retry-After, InvalidSessionKey, and APIKeySuspended", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return {
          status: 429,
          headers: new Headers({ "Retry-After": "0" }),
          json: async () => ({
            error: LastFMErrorCode.RateLimitExceeded,
            message: "rate limited",
          }),
        };
      }
      return {
        status: 200,
        headers: new Headers(),
        json: async () => ({ ok: true }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LastFMClient("k", "s", "sess-1");
    await client.updateNowPlaying({ artist: "A", track: "T" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // InvalidSessionKey throws and clears sessionKey
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      json: async () => ({
        error: LastFMErrorCode.InvalidSessionKey,
        message: "bad session",
      }),
    });
    await expect(
      client.scrobble({ artist: "A", track: "T", timestamp: 100 }),
    ).rejects.toThrow("bad session");

    // APIKeySuspended forbids subsequent calls immediately
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      json: async () => ({
        error: LastFMErrorCode.APIKeySuspended,
        message: "suspended",
      }),
    });
    await expect(client.getToken()).rejects.toThrow("suspended");
    await expect(client.getToken()).rejects.toThrow("LastFM API key suspended");
  });
});
