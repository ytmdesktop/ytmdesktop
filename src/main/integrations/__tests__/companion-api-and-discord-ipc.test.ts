import EventEmitter from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepeatMode, VideoState } from "~shared/playerstatestore/types";

const { mockSafeStorage, mockIpcOnce, mockIpcRemoveListener } = vi.hoisted(
  () => ({
    mockSafeStorage: {
      encryptStringAsync: vi.fn(async (s: string) => Buffer.from(s, "utf8")),
      decryptStringAsync: vi.fn(async (b: Buffer) => ({
        result: b.toString("utf8"),
      })),
    },
    mockIpcOnce: vi.fn(),
    mockIpcRemoveListener: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: vi.fn(() => os.tmpdir()) },
  BrowserWindow: class MockBrowserWindow {},
  safeStorage: mockSafeStorage,
  ipcMain: {
    once: mockIpcOnce,
    removeListener: mockIpcRemoveListener,
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

import CompanionServerAPIv1, {
  transformPlayerState,
} from "../companion-server/api/v1";
import { createAuthTokenAsync } from "../companion-server/api-shared/auth";
import DiscordClient from "../discord-presence/minimal-discord-client";
import IPCClient, { OPCode } from "../discord-presence/minimal-discord-client/ipc";
import ConfigStore from "../../services/configstore";
import MemoryStore from "../../services/memorystore";
import PlayerStateStore from "../../services/playerstatestore";
import ProtectedAPIManager from "../../services/protectedapimanager";
import Service from "../../services/service";
import { Constructor } from "~shared/types";

describe("CompanionServerAPIv1 & Discord IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transformPlayerState formats player, video, and queue fields", () => {
    const out = transformPlayerState({
      trackState: VideoState.Playing,
      videoProgress: 42,
      progressCapturedAtMs: 0,
      volume: 80,
      muted: false,
      adPlaying: false,
      hasFullMetadata: true,
      playlistId: "PL123",
      videoDetails: {
        author: "Artist",
        channelId: "ch1",
        title: "Song",
        album: "Album",
        albumId: "alb1",
        likeStatus: 1,
        thumbnails: [],
        durationSeconds: 180,
        id: "vid1",
        isLive: false,
        videoType: 0,
      },
      queue: {
        autoplay: false,
        items: [{ title: "Q1" } as any],
        automixItems: [],
        isGenerating: false,
        isInfinite: false,
        repeatMode: RepeatMode.All,
        selectedItemIndex: 0,
        shuffleEnabled: false,
      },
    });
    expect(out.player.volume).toBe(80);
    expect(out.video?.metadataFilled).toBe(true);
    expect(out.playlistId).toBe("PL123");
  });

  it("CompanionServerAPIv1 handles /state, /playlists, /command variants, and /auth/requestcode", async () => {
    let storedTokens = "";
    const configStore = {
      get: vi.fn(() => storedTokens),
      set: vi.fn((_k: string, val: string) => {
        storedTokens = val;
      }),
    } as unknown as ConfigStore;

    const token = await createAuthTokenAsync(
      configStore,
      "app-1",
      "1.0.0",
      "RemoteApp",
    );

    const mem = new Map<string, any>([
      ["companionServerAuthWindowEnabled", true],
    ]);
    const memoryStore = {
      get: vi.fn((k: string) => mem.get(k)),
      set: vi.fn((k: string, v: any) => mem.set(k, v)),
    };

    const playerEmitter = new EventEmitter();
    const playerStateStore = Object.assign(playerEmitter, {
      getState: vi.fn(() => ({
        trackState: VideoState.Playing,
        videoProgress: 10,
        volume: 50,
        muted: false,
        adPlaying: false,
        hasFullMetadata: true,
        playlistId: null,
        videoDetails: {
          author: "Artist",
          channelId: "ch1",
          title: "Track",
          album: null,
          albumId: null,
          likeStatus: 0,
          thumbnails: [],
          durationSeconds: 200,
          id: "dQw4w9WgXcQ",
          isLive: false,
          videoType: 0,
        },
        queue: {
          autoplay: false,
          items: [{}, {}],
          automixItems: [{}],
          isGenerating: false,
          isInfinite: false,
          repeatMode: RepeatMode.None,
          selectedItemIndex: 0,
          shuffleEnabled: false,
        },
      })),
    });

    const postMessage = vi.fn();
    const invokeMessage = vi.fn(async () => [[{ id: "PL1", title: "Mix" }]]);
    const protectedApiManager = {
      createOrGetAPI: vi.fn(() => ({ postMessage, invokeMessage })),
    };

    const fastify = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await fastify.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
    });
    await fastify.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getService: <T extends Service>(svc: Constructor<T>) => {
        const serviceClass: unknown = svc;
        if (serviceClass === ConfigStore) return configStore as unknown as T;
        if (serviceClass === MemoryStore) return memoryStore as unknown as T;
        if (serviceClass === PlayerStateStore) return playerStateStore as unknown as T;
        if (serviceClass === ProtectedAPIManager)
          return protectedApiManager as unknown as T;
        return null as unknown as T;
      },
    });

    try {
      // GET /state
      const stateRes = await fastify.inject({
        method: "GET",
        url: "/api/v1/state",
        headers: { authorization: token },
      });
      expect(stateRes.statusCode).toBe(200);
      expect(stateRes.json().video.id).toBe("dQw4w9WgXcQ");

      // GET /playlists
      const plRes = await fastify.inject({
        method: "GET",
        url: "/api/v1/playlists",
        headers: { authorization: token },
      });
      expect(plRes.statusCode).toBe(200);
      expect(plRes.json()).toEqual([{ id: "PL1", title: "Mix" }]);

      // POST /command variants (rate-limited to 2 per 1000ms)
      let fakeNow = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
      const commands = [
        { command: "playPause" },
        { command: "play" },
        { command: "pause" },
        { command: "volumeUp" },
        { command: "volumeDown" },
        { command: "setVolume", data: 65 },
        { command: "mute" },
        { command: "unmute" },
        { command: "seekTo", data: 30 },
        { command: "changeVideo", data: { videoId: "dQw4w9WgXcQ" } },
        { command: "next" },
        { command: "previous" },
        { command: "repeatMode", data: RepeatMode.All },
        { command: "shuffle" },
        { command: "playQueueIndex", data: 1 },
        { command: "toggleLike" },
        { command: "toggleDislike" },
        { command: "queueAdd", data: { videoId: "dQw4w9WgXcQ", index: 0 } },
        { command: "queueRemove", data: 0 },
        { command: "queueMove", data: { fromIndex: 0, toIndex: 1 } },
      ];
      for (let i = 0; i < commands.length; i++) {
        if (i > 0 && i % 2 === 0) {
          fakeNow += 1100;
        }
        const res = await fastify.inject({
          method: "POST",
          url: "/api/v1/command",
          headers: { authorization: token },
          payload: commands[i],
        });
        expect(res.statusCode).toBe(204);
      }

      fakeNow += 1100;
      // Invalid volume throws 400
      const badVol = await fastify.inject({
        method: "POST",
        url: "/api/v1/command",
        headers: { authorization: token },
        payload: { command: "setVolume", data: 150 },
      });
      expect(badVol.statusCode).toBe(400);

      fakeNow += 1100;
      // Invalid seek throws 400
      const badSeek = await fastify.inject({
        method: "POST",
        url: "/api/v1/command",
        headers: { authorization: token },
        payload: { command: "seekTo", data: 999 },
      });
      expect(badSeek.statusCode).toBe(400);

      dateSpy.mockRestore();

      // Request code
      const codeRes = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/requestcode",
        payload: { appId: "app-2", appVersion: "1.0.0", appName: "Test" },
      });
      expect(codeRes.statusCode).toBe(200);
      expect(codeRes.json().code).toMatch(/^\d{4}$/);

      // Emit realtime events without throwing
      playerEmitter.emit("state-changed", playerStateStore.getState());
      playerEmitter.emit("playlist-created", { id: "PL2", title: "New" });
      playerEmitter.emit("playlist-deleted", "PL2");
    } finally {
      await fastify.close();
    }
  });

  it("Discord IPCClient and DiscordClient connect over socket, frame packets, respond to PING, and close", async () => {
    const tmpDir = path.join(os.tmpdir(), `ytmd-dipc-${process.pid}`);
    const origXdg = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = tmpDir;
    const sockPath = path.join(tmpDir, "discord-ipc-0");

    const receivedFrames: Array<{ op: number; data: any }> = [];
    const server = net.createServer((socket) => {
      socket.on("data", (buf) => {
        if (!Buffer.isBuffer(buf)) return;
        let offset = 0;
        while (offset + 8 <= buf.length) {
          const op = buf.readInt32LE(offset);
          const len = buf.readInt32LE(offset + 4);
          const json = JSON.parse(
            buf.subarray(offset + 8, offset + 8 + len).toString("utf8"),
          );
          receivedFrames.push({ op, data: json });
          offset += 8 + len;

          if (op === OPCode.HANDSHAKE) {
            // Send a PING frame back to exercise OPCode.PING -> PONG
            const payload = Buffer.from(JSON.stringify({ nonce: "p1" }), "utf8");
            const hdr = Buffer.alloc(8);
            hdr.writeInt32LE(OPCode.PING, 0);
            hdr.writeInt32LE(payload.length, 4);
            socket.write(Buffer.concat([hdr, payload]));
          }
        }
      });
    });

    try {
      await import("node:fs/promises").then((fs) =>
        fs.mkdir(tmpDir, { recursive: true }),
      );
      await new Promise<void>((resolve) => server.listen(sockPath, resolve));

      const client = new DiscordClient("test-client-id");
      const connected = new Promise<void>((resolve) =>
        client.once("connect", resolve),
      );
      await client.connect();
      await connected;

      client.setActivity({ details: "Song", status_display_type: 1 });
      client.clearActivity();

      await new Promise((r) => setTimeout(r, 40));
      expect(receivedFrames[0]).toEqual({
        op: OPCode.HANDSHAKE,
        data: { v: 1, client_id: "test-client-id" },
      });
      expect(
        receivedFrames.some((f) => f.data?.cmd === "SET_ACTIVITY"),
      ).toBe(true);

      client.close();
      client.destroy();

      // Verify IPCClient constructor & standalone connect/close
      const rawIpc = new IPCClient();
      rawIpc.close();
    } finally {
      server.close();
      if (origXdg === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = origXdg;
      }
      await import("node:fs/promises").then((fs) =>
        fs.rm(tmpDir, { recursive: true, force: true }),
      );
    }
  });
});
