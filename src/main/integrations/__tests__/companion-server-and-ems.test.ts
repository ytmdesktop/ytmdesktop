import EventEmitter from "node:events";
import net from "node:net";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepeatMode, VideoState } from "~shared/playerstatestore/types";

const {
  mockMdnsInstance,
  mockMediaPlayerInstances,
  mockSafeStorage,
  mockFetch,
} = vi.hoisted(() => {
  const { EventEmitter: EE } = require("node:events");
  const mdnsInst = Object.assign(new EE(), {
    respond: vi.fn(),
    destroy: vi.fn(),
  });
  const mpInstances: any[] = [];
  return {
    mockMdnsInstance: mdnsInst,
    mockMediaPlayerInstances: mpInstances,
    mockSafeStorage: {
      encryptStringAsync: vi.fn(async (s: string) => Buffer.from(s, "utf8")),
      decryptStringAsync: vi.fn(async (b: Buffer) => ({
        result: b.toString("utf8"),
      })),
    },
    mockFetch: vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: vi.fn(() => os.tmpdir()) },
  BrowserWindow: class MockBrowserWindow {},
  safeStorage: mockSafeStorage,
  ipcMain: {
    once: vi.fn(),
    removeListener: vi.fn(),
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

vi.mock("multicast-dns", () => ({
  default: vi.fn(() => mockMdnsInstance),
}));

vi.mock("xosms", () => ({
  MediaPlayerThumbnail: {
    create: vi.fn(async () => ({})),
  },
  MediaPlayerPlaybackStatus: {
    Playing: 3,
    Paused: 4,
    Stopped: 2,
  },
  MediaPlayer: class MockMediaPlayer {
    public nextButtonEnabled = false;
    public pauseButtonEnabled = false;
    public playButtonEnabled = false;
    public previousButtonEnabled = false;
    public seekEnabled = false;
    public title = "";
    public artist: string[] = [];
    public trackId = "";
    public playbackStatus = 0;
    public albumTitle = "";
    public shuffleEnabled = false;
    public loopStatus = "none";
    public volume = 0;
    public setThumbnail = vi.fn(async () => {});
    public setTimeline = vi.fn();
    public activate = vi.fn();
    public update = vi.fn();
    public deactivate = vi.fn();
    public onButton?: (btn: string) => void;
    public onPosChanged?: (pos: number) => void;
    public onPosSeeked?: (seek: number) => void;
    public onLoopChanged?: (loop: string) => void;
    public onShuffleChanged?: () => void;
    public onVolumeChanged?: (vol: number) => void;
    constructor(
      public id: string,
      public name: string,
    ) {
      mockMediaPlayerInstances.push(this);
    }
    public setButtonPressedCallback(cb: (btn: string) => void) {
      this.onButton = cb;
    }
    public setPositionChangedCallback(cb: (pos: number) => void) {
      this.onPosChanged = cb;
    }
    public setPositionSeekedCallback(cb: (seek: number) => void) {
      this.onPosSeeked = cb;
    }
    public setLoopChangedCallback(cb: (loop: string) => void) {
      this.onLoopChanged = cb;
    }
    public setShuffleChangedCallback(cb: () => void) {
      this.onShuffleChanged = cb;
    }
    public setVolumeChangedCallback(cb: (vol: number) => void) {
      this.onVolumeChanged = cb;
    }
  },
}));

import CompanionServer from "../companion-server";
import EnhancedMediaService from "../enhanced-media-service";
import ConfigStore from "../../services/configstore";
import MemoryStore from "../../services/memorystore";
import PlayerStateStore from "../../services/playerstatestore";
import ProtectedAPIManager from "../../services/protectedapimanager";
import IntegrationManager from "../../services/integrationmanager";
import { ServiceHost } from "../../services/servicehost";

describe("CompanionServer & EnhancedMediaService", () => {
  beforeEach(() => {
    mockMediaPlayerInstances.length = 0;
    mockMdnsInstance.removeAllListeners();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("CompanionServer starts Fastify, IPC pipe, and mDNS, responds to queries, and cleans up on disable", async () => {
    const tmpXdg = os.tmpdir();
    const origXdg = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = tmpXdg;

    const memListeners: Array<(n: any, o: any) => void> = [];
    const memoryStore = {
      get: vi.fn(() => true),
      set: vi.fn(),
      onStateChanged: vi.fn((cb: any) => memListeners.push(cb)),
      removeOnStateChanged: vi.fn(),
    };
    const configStore = {
      get: vi.fn(() => false),
      onDidChange: vi.fn(() => vi.fn()),
    };
    const playerEmitter = new EventEmitter();
    const playerStateStore = Object.assign(playerEmitter, {
      getState: vi.fn(() => ({
        trackState: VideoState.Paused,
        videoProgress: 0,
        volume: 50,
        muted: false,
        adPlaying: false,
        hasFullMetadata: false,
        playlistId: null,
        videoDetails: null,
        queue: null,
      })),
    });

    const cs = new CompanionServer();
    // Use ephemeral loopback port 0 so test never collides with port 9863
    (cs as any).listenIp = "127.0.0.1";
    (cs as any).listenPort = 0;
    cs[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === ConfigStore) return configStore;
        if (svc === MemoryStore) return memoryStore;
        if (svc === PlayerStateStore) return playerStateStore;
        return null;
      },
    } as unknown as ServiceHost);

    try {
      cs[IntegrationManager.SETUP]();
      await cs[IntegrationManager.ENABLE]();

      const port = ((cs as any).fastifyServer.server.address() as net.AddressInfo)
        .port;
      const metaRes = await (cs as any).fastifyServer.inject({
        method: "GET",
        url: "/metadata",
      });
      expect(metaRes.statusCode).toBe(200);
      expect(metaRes.json()).toEqual({ apiVersions: ["v1"] });
      expect(port).toBeGreaterThan(0);

      // Wait for IPC server to bind, then connect, select v1, send PING, receive PONG + state-update
      const pipePath = (cs as any).getIpcPath();
      await vi.waitFor(() => {
        expect((cs as any).ipcServer?.listening).toBe(true);
      });
      await new Promise<void>((resolve, reject) => {
        const client = net.connect(pipePath, () => {
          const ver = Buffer.from("v1");
          const sel = Buffer.alloc(8 + ver.length);
          sel.writeInt32LE(1, 0); // SELECT_VERSION
          sel.writeInt32LE(ver.length, 4);
          ver.copy(sel, 8);
          client.write(sel);
        });
        const pongBytes = Buffer.alloc(4);
        pongBytes.writeInt32LE(4, 0);
        let gotEvent = false;
        client.on("data", (buf) => {
          if (!Buffer.isBuffer(buf)) return;
          if (!gotEvent && buf.includes(Buffer.from("state-update"))) {
            gotEvent = true;
            const ping = Buffer.alloc(4);
            ping.writeInt32LE(3, 0); // PING
            client.write(ping);
            return;
          }
          if (gotEvent && buf.includes(pongBytes)) {
            client.destroy();
            resolve();
          }
        });
        client.on("error", reject);
      });

      // Emit mDNS queries
      mockMdnsInstance.emit("query", {
        questions: [
          { name: "_services._dns-sd._udp.local", type: "PTR" },
          { name: "_ytmdesktop._tcp.local", type: "PTR" },
          { name: `${os.hostname().split(".")[0]}.local`, type: "A" },
        ],
      });
      expect(mockMdnsInstance.respond).toHaveBeenCalled();

      // Trigger auth window timeout toggle
      memListeners[0]?.(
        { companionServerAuthWindowEnabled: true },
        { companionServerAuthWindowEnabled: false },
      );
      memListeners[0]?.(
        { companionServerAuthWindowEnabled: false },
        { companionServerAuthWindowEnabled: true },
      );

      await cs[IntegrationManager.DISABLE]();
      expect(mockMdnsInstance.destroy).toHaveBeenCalled();
    } finally {
      if (origXdg === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = origXdg;
      }
    }
  });

  it("EnhancedMediaService bridges xosms MediaPlayer callbacks and updates metadata", async () => {
    const postMessage = vi.fn();
    const playerEmitter = new EventEmitter();
    const currentState: any = {
      trackState: VideoState.Playing,
      videoProgress: 25,
      volume: 80,
      muted: false,
      adPlaying: false,
      hasFullMetadata: true,
      videoDetails: {
        id: "vid1",
        title: "Track One",
        author: "Artist One",
        album: "Album One",
        durationSeconds: 180,
        thumbnails: [{ url: "https://i.ytimg.com/1.jpg", width: 320, height: 180 }],
      },
      queue: {
        repeatMode: RepeatMode.All,
        shuffleEnabled: true,
      },
    };
    const playerStateStore = Object.assign(playerEmitter, {
      getState: () => currentState,
    });
    const configStore = { get: vi.fn(() => 0) };
    const protectedApi = { createOrGetAPI: vi.fn(() => ({ postMessage })) };

    const ems = new EnhancedMediaService();
    ems[ServiceHost.INJECT]({
      getService: (svc: any) => {
        if (svc === PlayerStateStore) return playerStateStore;
        if (svc === ConfigStore) return configStore;
        if (svc === ProtectedAPIManager) return protectedApi;
        return null;
      },
    } as unknown as ServiceHost);

    ems[IntegrationManager.SETUP]();
    await ems[IntegrationManager.ENABLE]();
    const mp = mockMediaPlayerInstances[0];
    expect(mp).toBeDefined();

    // Emit full state update
    playerEmitter.emit("state-changed", currentState);
    await new Promise((r) => setTimeout(r, 15));
    expect(mp.title).toBe("Track One");
    expect(mp.artist).toEqual(["Artist One"]);
    expect(mp.update).toHaveBeenCalled();

    // Exercise callbacks
    for (const btn of ["playpause", "play", "pause", "stop", "next", "previous"]) {
      mp.onButton?.(btn);
    }
    mp.onPosChanged?.(40);
    mp.onPosSeeked?.(10);
    mp.onPosSeeked?.(500); // > duration => next
    mp.onLoopChanged?.("none");
    mp.onLoopChanged?.("playlist");
    mp.onLoopChanged?.("track");
    mp.onShuffleChanged?.();
    mp.onVolumeChanged?.(0.5);

    expect(postMessage).toHaveBeenCalledWith("execute", "playPause");
    expect(postMessage).toHaveBeenCalledWith("execute", "seekTo", 40);
    expect(postMessage).toHaveBeenCalledWith("execute", "next");
    expect(postMessage).toHaveBeenCalledWith("execute", "repeatMode", "ONE");
    expect(postMessage).toHaveBeenCalledWith("execute", "shuffle");

    await ems[IntegrationManager.DISABLE]();
    expect(mp.deactivate).toHaveBeenCalled();
  });
});
