import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoState } from "~shared/playerstatestore/types";

const { mockSafeStorage, mockIpcOn, mockShell, discordInstances } = vi.hoisted(
  () => ({
    mockSafeStorage: {
      encryptStringAsync: vi.fn(async (s: string) => Buffer.from(s, "utf8")),
      decryptStringAsync: vi.fn(async (b: Buffer) => ({
        result: b.toString("utf8"),
      })),
    },
    mockIpcOn: new Map<string, (...args: any[]) => any>(),
    mockShell: { openExternal: vi.fn() },
    discordInstances: [] as any[],
  }),
);

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "2.1.0") },
  safeStorage: mockSafeStorage,
  ipcMain: {
    on: vi.fn((ch: string, cb: (...args: any[]) => any) => {
      mockIpcOn.set(ch, cb);
    }),
  },
  shell: mockShell,
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../discord-presence/minimal-discord-client", () => {
  const { EventEmitter: EE } = require("node:events");
  return {
    default: class MockDiscordClient extends EE {
      public connect = vi.fn(async () => {});
      public setActivity = vi.fn();
      public clearActivity = vi.fn();
      public destroy = vi.fn();
      constructor(public clientId: string) {
        super();
        discordInstances.push(this);
      }
    },
  };
});

// Provide globals expected by LastFM integration
(globalThis as any).LASTFM_API_KEY = "test-api-key";
(globalThis as any).LASTFM_API_SECRET = "test-api-secret";

import {
  createAuthTokenAsync,
  getIsTemporaryAuthCodeValidAndRemove,
  getTemporaryAuthCode,
  isAuthValidAsync,
  isAuthValidMiddlewareAsync,
} from "../companion-server/api-shared/auth";
import {
  AuthorizationDeniedError,
  InvalidPositionError,
  InvalidVolumeError,
  isDefinedAPIError,
  YouTubeMusicUnavailableError,
} from "../companion-server/api-shared/errors";
import DiscordPresence from "../discord-presence";
import LastFM from "../last-fm";
import ConfigStore from "../../services/configstore";
import MemoryStore from "../../services/memorystore";
import PlayerStateStore from "../../services/playerstatestore";
import IntegrationManager from "../../services/integrationmanager";
import { ServiceHost } from "../../services/servicehost";

describe("companion auth & errors, DiscordPresence, and LastFM", () => {
  beforeEach(() => {
    discordInstances.length = 0;
    mockIpcOn.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("companion-server auth issues temp codes, creates/validates tokens, and enforces middleware", async () => {
    vi.useFakeTimers();
    const codePromise = getTemporaryAuthCode("app-1", "1.0.0", "Remote");
    await vi.advanceTimersByTimeAsync(250);
    const code = await codePromise;
    expect(code).toMatch(/^\d{4}$/);

    // Wrong appId fails, right appId succeeds once then removes
    expect(getIsTemporaryAuthCodeValidAndRemove("wrong", code!)).toBe(false);
    expect(getIsTemporaryAuthCodeValidAndRemove("app-1", code!)).toEqual({
      appId: "app-1",
      appVersion: "1.0.0",
      appName: "Remote",
    });
    expect(getIsTemporaryAuthCodeValidAndRemove("app-1", code!)).toBe(false);

    let storedHex = "";
    const configStore = {
      get: vi.fn(() => storedHex),
      set: vi.fn((_k: string, val: string) => {
        storedHex = val;
      }),
    } as unknown as ConfigStore;

    const token = await createAuthTokenAsync(
      configStore,
      "app-1",
      "1.0.0",
      "Remote",
    );
    expect(token.length).toBeGreaterThan(100);

    // Replacing existing appId token keeps single entry
    const token2 = await createAuthTokenAsync(
      configStore,
      "app-1",
      "1.0.1",
      "Remote",
    );
    expect(await isAuthValidAsync(configStore, token)).toEqual([false, null]);
    const [valid, tokenId] = await isAuthValidAsync(configStore, token2);
    expect(valid).toBe(true);
    expect(typeof tokenId).toBe("string");
    expect(await isAuthValidAsync(configStore, "")).toEqual([false, null]);

    // Middleware tests
    const reply = { code: vi.fn(), send: vi.fn() } as any;
    await isAuthValidMiddlewareAsync(
      configStore,
      { headers: {} } as any,
      reply,
    );
    expect(reply.code).toHaveBeenCalledWith(401);

    const reqOk = { headers: { authorization: token2 } } as any;
    await isAuthValidMiddlewareAsync(configStore, reqOk, reply);
    expect(reqOk.authId).toBe(tokenId);

    await expect(
      isAuthValidMiddlewareAsync(
        configStore,
        { headers: { authorization: "bad-token" } } as any,
        reply,
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("isDefinedAPIError distinguishes defined API errors from generic errors", () => {
    expect(isDefinedAPIError(new InvalidVolumeError(200))).toBe(true);
    expect(isDefinedAPIError(new InvalidPositionError(-1))).toBe(true);
    expect(isDefinedAPIError(new AuthorizationDeniedError())).toBe(true);
    expect(isDefinedAPIError(new YouTubeMusicUnavailableError())).toBe(true);
    expect(isDefinedAPIError({ code: "OTHER" } as any)).toBe(false);
  });

  it("DiscordPresence updates activity, clears on pause timeout, and retries on close", async () => {
    vi.useFakeTimers();
    const playerEmitter = new EventEmitter();
    const memoryStore = { set: vi.fn(), get: vi.fn() };
    const dp = new DiscordPresence();
    dp[ServiceHost.INJECT]({
      getService: (svc: any) =>
        svc === PlayerStateStore ? playerEmitter : memoryStore,
    } as unknown as ServiceHost);

    dp[IntegrationManager.SETUP]();
    await dp[IntegrationManager.ENABLE]();
    const client = discordInstances[0];
    expect(client).toBeDefined();

    client.emit("connect");
    expect(memoryStore.set).toHaveBeenCalledWith(
      "discordPresenceConnectionFailed",
      false,
    );

    // Emit playing track -> debounced 1s setActivity
    playerEmitter.emit("state-changed", {
      trackState: VideoState.Playing,
      videoProgress: 10,
      hasFullMetadata: true,
      videoDetails: {
        id: "vid1",
        title: "A",
        author: "B",
        album: "Al",
        durationSeconds: 180,
        channelId: "ch1",
        albumId: "alb1",
        thumbnails: [{ url: "https://i.ytimg.com/1.jpg", width: 200, height: 200 }],
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.setActivity).toHaveBeenCalledTimes(1);

    // Paused -> clears activity after 30s
    playerEmitter.emit("state-changed", {
      trackState: VideoState.Paused,
      videoProgress: 12,
      hasFullMetadata: true,
      videoDetails: {
        id: "vid1",
        title: "A",
        author: "B",
        durationSeconds: 180,
        channelId: "ch1",
        thumbnails: [{ url: "https://i.ytimg.com/1.jpg", width: 200, height: 200 }],
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.clearActivity).toHaveBeenCalled();

    // Close triggers retry after 5s
    client.emit("close");
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.connect).toHaveBeenCalledTimes(2);

    await dp[IntegrationManager.DISABLE]();
    expect(client.destroy).toHaveBeenCalled();
  });

  it("LastFM authenticates, updates now playing, and scrobbles after threshold", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? "");
      if (bodyStr.includes("auth.getToken")) {
        return { json: async () => ({ token: "tok-1" }) };
      }
      if (bodyStr.includes("auth.getSession")) {
        return { json: async () => ({ session: { key: "sess-key-1" } }) };
      }
      return { json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchSpy);

    const playerEmitter = new EventEmitter();
    const mem = new Map<string, any>([["safeStorageAvailable", true]]);
    const memoryStore = {
      get: vi.fn((k: string) => mem.get(k)),
      set: vi.fn((k: string, v: any) => mem.set(k, v)),
    };
    const configStore = {
      get: vi.fn((k: string) =>
        k === "lastfm"
          ? { sessionKey: null, token: null, scrobblePercent: 50 }
          : 50,
      ),
      set: vi.fn(),
    };

    const lfm = new LastFM();
    lfm[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === MemoryStore) return memoryStore;
        if (svc === ConfigStore) return configStore;
        if (svc === PlayerStateStore) return playerEmitter;
        return null;
      },
    } as unknown as ServiceHost);

    lfm[IntegrationManager.SETUP]();
    await lfm[IntegrationManager.ENABLE]();
    expect(mem.get("lastFMAuthenticationStep")).toBe(0);

    // First authenticate call -> getToken & openExternal
    await mockIpcOn.get("lastfm:authenticate")?.();
    expect(mem.get("lastFMAuthenticationStep")).toBe(1);
    expect(mockShell.openExternal).toHaveBeenCalled();

    // Second authenticate call -> getSession & save
    await mockIpcOn.get("lastfm:authenticate")?.();
    expect(mem.get("lastFMAuthenticationStep")).toBe(2);
    expect(configStore.set).toHaveBeenCalled();

    // Now playing + scrobble accumulation
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const trackState = {
      trackState: VideoState.Playing,
      hasFullMetadata: true,
      videoDetails: {
        id: "track-1",
        title: "Track One",
        author: "Artist One",
        album: "Album",
        durationSeconds: 40, // 50% = 20s
      },
    };
    playerEmitter.emit("state-changed", trackState);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      fetchSpy.mock.calls.some((c) =>
        String(c[1]?.body ?? "").includes("track.updateNowPlaying"),
      ),
    ).toBe(true);

    for (let s = 1; s <= 21; s++) {
      vi.setSystemTime(10_000 + s * 1000);
      playerEmitter.emit("state-changed", trackState);
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(
      fetchSpy.mock.calls.some((c) =>
        String(c[1]?.body ?? "").includes("track.scrobble"),
      ),
    ).toBe(true);

    await lfm[IntegrationManager.DISABLE]();
    vi.unstubAllGlobals();
  });
});
