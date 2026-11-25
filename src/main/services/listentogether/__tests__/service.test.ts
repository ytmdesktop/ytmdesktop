import EventEmitter from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "2.2.0",
    getPath: () => "/tmp",
    isPackaged: false,
    isDefaultProtocolClient: () => true,
    setAsDefaultProtocolClient: () => true,
    setLoginItemSettings: () => {},
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  webContents: {
    fromId: vi.fn(() => null),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showMessageBoxSync: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    })),
  },
  shell: {
    openExternal: vi.fn(),
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

import { LISTEN_TOGETHER_IPC } from "~shared/listentogether/ipc";
import {
  parseInviteUrl,
  type QueueTrack,
} from "~shared/listentogether/protocol";
import { PlayerSignal, VideoState } from "~shared/playerstatestore/types";
import { YTMViewStatus } from "~shared/types";
import { createRelayServer } from "../../../../../server/listen-relay/src/index";
import ListenTogetherService, {
  extractVideoIdFromInput,
  type ListenTogetherServiceDeps,
} from "../index";
import type {
  RelayHostClient,
  RelayHostClientOptions,
  RelayWsTransport,
  RelayWsTransportOptions,
} from "../transport/relay-ws";
import type { TransportConnection } from "../transport/types";
import ProtectedAPIManager from "../../protectedapimanager";
import ProtocolManager from "../../protocolmanager";

function createFakeIpcMain() {
  const handles = new Map<
    string,
    (event: { sender: { id: number } }, ...args: unknown[]) => unknown
  >();
  const listeners = new Map<
    string,
    (event: { sender: { id: number } }, ...args: unknown[]) => void
  >();

  return {
    handles,
    listeners,
    handle: (
      channel: string,
      fn: (event: { sender: { id: number } }, ...args: unknown[]) => unknown,
    ) => {
      handles.set(channel, fn);
    },
    on: (
      channel: string,
      fn: (event: { sender: { id: number } }, ...args: unknown[]) => void,
    ) => {
      listeners.set(channel, fn);
    },
  };
}

function createFakeConfigStore(initial?: {
  displayName?: string;
  signalingUrl?: string | null;
  trustedSignalingHosts?: string[];
  tailcatDerpMapUrl?: string | null;
}) {
  const data = {
    displayName: initial?.displayName ?? "HostUser",
    signalingUrl: initial?.signalingUrl ?? null,
    trustedSignalingHosts: initial?.trustedSignalingHosts ?? [],
    tailcatDerpMapUrl: initial?.tailcatDerpMapUrl ?? null,
  };
  const emitter = new EventEmitter();

  return {
    get: (key: string) => {
      if (key === "listenTogether") return { ...data };
      if (key === "listenTogether.displayName") return data.displayName;
      if (key === "listenTogether.signalingUrl") return data.signalingUrl;
      if (key === "listenTogether.trustedSignalingHosts") {
        return [...data.trustedSignalingHosts];
      }
      if (key === "listenTogether.tailcatDerpMapUrl") {
        return data.tailcatDerpMapUrl;
      }
      if (key.startsWith("listenTogether.")) {
        const subKey = key.slice("listenTogether.".length);
        return (data as Record<string, unknown>)[subKey];
      }
      return undefined;
    },
    set: (key: string, value: unknown) => {
      if (key === "listenTogether.displayName") {
        data.displayName = String(value);
      } else if (key === "listenTogether.signalingUrl") {
        data.signalingUrl = value === null ? null : String(value);
      } else if (key === "listenTogether.trustedSignalingHosts") {
        data.trustedSignalingHosts = Array.isArray(value)
          ? value.map(String)
          : [];
      } else if (key === "listenTogether.tailcatDerpMapUrl") {
        data.tailcatDerpMapUrl = value === null ? null : String(value);
      } else if (key.startsWith("listenTogether.")) {
        const subKey = key.slice("listenTogether.".length);
        (data as Record<string, unknown>)[subKey] = value;
      }
      emitter.emit("listenTogether", { ...data });
    },
    onDidChange: (key: string, cb: (newVal: unknown) => void) => {
      emitter.on(key, cb);
      return () => emitter.off(key, cb);
    },
  };
}

function createFakeMemoryStore() {
  const map = new Map<string, unknown>([
    ["listenTogetherPendingColdStart", false],
  ]);
  return {
    get: (key: string) => map.get(key),
    set: (key: string, val: unknown) => map.set(key, val),
  };
}

class FakeYtmViewManager extends EventEmitter {
  public status = YTMViewStatus.Ready;
  public isInitialized() {
    return true;
  }
  public async ready() {}
  public getView() {
    return undefined;
  }
}

class FakePlayerStateStore extends EventEmitter {
  public getState() {
    return { videoDetails: null };
  }
}

function createFakeWindowManager() {
  const broadcasts: Array<{ channel: string; args: unknown[] }> = [];
  const mainWindow = {
    webContents: { id: 10 },
    ipcBroadcast: (channel: string, ...args: unknown[]) => {
      broadcasts.push({ channel, args });
    },
    showAndFocus: vi.fn(),
  };

  return {
    broadcasts,
    hasWindow: (name: string) => name === "Main",
    getWindow: (name: string) => {
      if (name !== "Main") throw new Error(`No window ${name}`);
      return mainWindow;
    },
    getWindows: () => [mainWindow],
  };
}

function createBoundProtectedApiManager(options?: {
  onInvoke?: (name: string, args: unknown[]) => unknown;
}) {
  const ipc = createFakeIpcMain();
  const manager = new ProtectedAPIManager().setDependencies({
    ipcMain: ipc as unknown as Electron.IpcMain,
  });
  manager.onInitialized();

  const listenApi = manager.createOrGetAPI("ListenTogether");
  const invokeLog: Array<{ name: string; args: unknown[] }> = [];
  const fakePort = {
    handlers: new Map<
      string,
      Array<(event: { data: any; ports: any[] }) => void>
    >(),
    on(event: string, listener: (event: any) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(listener);
      this.handlers.set(event, list);
    },
    start() {},
    postMessage(msg: any) {
      if (msg?.op === 2 /* Invoke */) {
        invokeLog.push({ name: msg.name, args: msg.args });
        let result: unknown = { ok: true };
        const override = options?.onInvoke?.(msg.name, msg.args);
        if (override !== undefined) {
          result = override;
        } else if (msg.name === "resolveVideoMeta") {
          result = {
            ok: true,
            meta: {
              videoId: msg.args[0],
              title: "Test Track",
              author: "Test Artist",
              durationSec: 180,
              thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            },
          };
        } else if (msg.name === "fetchAutoplayCandidates") {
          result = { ok: true, candidates: [] };
        }
        const messageHandlers = this.handlers.get("message") ?? [];
        for (const h of messageHandlers) {
          h({
            data: {
              op: 3 /* InvokeResponse */,
              id: msg.id,
              args: [result],
            },
            ports: [],
          });
        }
      }
    },
  };
  listenApi.setPort(fakePort as unknown as Electron.MessagePortMain);

  return { manager, listenApi, invokeLog };
}

function createSpyLogger() {
  const entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  const logger = {
    debug: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "debug", message, context }),
    info: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "info", message, context }),
    warn: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "warn", message, context }),
    error: (message: string, context?: Record<string, unknown>) =>
      entries.push({ level: "error", message, context }),
  };
  return { logger, entries };
}

type FakeVirtualHostClient = {
  options: RelayHostClientOptions;
  connected: boolean;
  emitPeerConnection: (conn: TransportConnection) => void;
  simulateDrop: (code?: number, reason?: string) => void;
  peers: Map<
    string,
    {
      hostConn: TransportConnection;
      guestConn: TransportConnection;
      closeBoth: (code?: number, reason?: string) => void;
    }
  >;
};

function createFakeRelayHub() {
  const hostsByLookup = new Map<string, FakeVirtualHostClient>();
  let peerSeq = 0;
  let rejectHostReconnect = false;
  let rejectGuestConnect = false;
  const connectModes: Array<{ lookupId: string; mode: "create" | "resume" }> =
    [];

  function makeConnectedPair(
    peerId: string,
    remoteLabel: string,
  ): {
    hostConn: TransportConnection;
    guestConn: TransportConnection;
    closeBoth: (code?: number, reason?: string) => void;
  } {
    let open = true;
    const hostMsg = new Set<(buf: Buffer) => void>();
    const hostClose = new Set<(code: number, reason: string) => void>();
    const hostErr = new Set<(err: Error) => void>();
    const guestMsg = new Set<(buf: Buffer) => void>();
    const guestClose = new Set<(code: number, reason: string) => void>();
    const guestErr = new Set<(err: Error) => void>();

    const closeBoth = (code = 1000, reason = "Closed") => {
      if (!open) return;
      open = false;
      for (const h of hostClose) h(code, reason);
      for (const h of guestClose) h(code, reason);
    };

    const hostConn: TransportConnection = {
      id: peerId,
      mode: "relay",
      remoteLabel: `relay:${peerId}`,
      get isOpen() {
        return open;
      },
      send(data) {
        if (!open) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        queueMicrotask(() => {
          if (!open) return;
          for (const h of guestMsg) h(buf);
        });
      },
      close(code, reason) {
        closeBoth(code ?? 1000, reason ?? "Closed by host");
      },
      onMessage(fn) {
        hostMsg.add(fn);
        return () => hostMsg.delete(fn);
      },
      onClose(fn) {
        hostClose.add(fn);
        return () => hostClose.delete(fn);
      },
      onError(fn) {
        hostErr.add(fn);
        return () => hostErr.delete(fn);
      },
    };

    const guestConn: TransportConnection = {
      id: `guest-conn-${peerId}`,
      mode: "relay",
      remoteLabel,
      get isOpen() {
        return open;
      },
      send(data) {
        if (!open) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        queueMicrotask(() => {
          if (!open) return;
          for (const h of hostMsg) h(buf);
        });
      },
      close(code, reason) {
        closeBoth(code ?? 1000, reason ?? "Closed by guest");
      },
      onMessage(fn) {
        guestMsg.add(fn);
        return () => guestMsg.delete(fn);
      },
      onClose(fn) {
        guestClose.add(fn);
        return () => guestClose.delete(fn);
      },
      onError(fn) {
        guestErr.add(fn);
        return () => guestErr.delete(fn);
      },
    };

    return { hostConn, guestConn, closeBoth };
  }

  const createRelayHostClient = (
    options: RelayHostClientOptions,
  ): RelayHostClient => {
    const peerHandlers = new Set<(conn: TransportConnection) => void>();
    const closeHandlers = new Set<(code: number, reason: string) => void>();
    const errorHandlers = new Set<(err: Error) => void>();
    const peers = new Map<
      string,
      {
        hostConn: TransportConnection;
        guestConn: TransportConnection;
        closeBoth: (code?: number, reason?: string) => void;
      }
    >();

    const record: FakeVirtualHostClient = {
      options,
      connected: false,
      peers,
      emitPeerConnection: (conn) => {
        for (const h of peerHandlers) h(conn);
      },
      simulateDrop: (code = 1006, reason = "Relay disconnected") => {
        if (!record.connected) return;
        record.connected = false;
        hostsByLookup.delete(options.lookupId);
        for (const pair of peers.values()) {
          pair.closeBoth(code, reason);
        }
        peers.clear();
        for (const h of closeHandlers) h(code, reason);
      },
    };

    const client = {
      onPeerConnection: (handler: (conn: TransportConnection) => void) => {
        peerHandlers.add(handler);
        return () => peerHandlers.delete(handler);
      },
      onError: (handler: (err: Error) => void) => {
        errorHandlers.add(handler);
        return () => errorHandlers.delete(handler);
      },
      onClose: (handler: (code: number, reason: string) => void) => {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      connect: async (mode: "create" | "resume" = "create") => {
        connectModes.push({ lookupId: options.lookupId, mode });
        if (mode === "resume" && rejectHostReconnect) {
          throw new Error("Host reconnect blocked");
        }
        record.connected = true;
        hostsByLookup.set(options.lookupId, record);
      },
      admitPeer: () => {},
      dropPeer: (relayPeerId: string, reason?: string) => {
        const pair = peers.get(relayPeerId);
        if (pair) {
          peers.delete(relayPeerId);
          pair.closeBoth(1000, reason ?? "Dropped by host");
        }
      },
      sendFrame: () => {},
      close: () => {
        record.connected = false;
        hostsByLookup.delete(options.lookupId);
        for (const pair of peers.values()) {
          pair.closeBoth(1000, "Host closing");
        }
        peers.clear();
      },
    };

    return client as unknown as RelayHostClient;
  };

  const createRelayTransport = (
    options: RelayWsTransportOptions,
  ): RelayWsTransport => {
    let activeConn: TransportConnection | null = null;
    const transport = {
      connect: async (signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new Error("Aborted");
        }
        if (rejectGuestConnect) {
          throw new Error("Relay unavailable");
        }
        const host = hostsByLookup.get(options.lookupId);
        if (!host || !host.connected) {
          throw new Error("Relay error (ROOM_NOT_FOUND): Room not found");
        }
        peerSeq += 1;
        const peerId = `relay-peer-${peerSeq}`;
        const pair = makeConnectedPair(peerId, options.signalingUrl);
        host.peers.set(peerId, pair);
        activeConn = pair.guestConn;
        host.emitPeerConnection(pair.hostConn);
        return pair.guestConn;
      },
      close: () => {
        activeConn?.close(1000, "Transport closed");
      },
    };
    return transport as unknown as RelayWsTransport;
  };

  return {
    hostsByLookup,
    connectModes,
    setRejectHostReconnect: (value: boolean) => {
      rejectHostReconnect = value;
    },
    setRejectGuestConnect: (value: boolean) => {
      rejectGuestConnect = value;
    },
    createRelayHostClient,
    createRelayTransport,
  };
}

function createServiceHarness(
  displayName = "HostUser",
  extraDeps: Partial<ListenTogetherServiceDeps> & {
    signalingUrl?: string | null;
    trustedSignalingHosts?: string[];
    onInvoke?: (name: string, args: unknown[]) => unknown;
    disableDirectHost?: boolean;
  } = {},
) {
  const ipc = createFakeIpcMain();
  const configStore = createFakeConfigStore({
    displayName,
    signalingUrl: extraDeps.signalingUrl ?? null,
    trustedSignalingHosts: extraDeps.trustedSignalingHosts ?? [],
  });
  const memoryStore = createFakeMemoryStore();
  const ytmViewManager = new FakeYtmViewManager();
  const playerStateStore = new FakePlayerStateStore();
  const {
    manager: protectedApiManager,
    listenApi,
    invokeLog,
  } = createBoundProtectedApiManager({ onInvoke: extraDeps.onInvoke });
  const windowManager = createFakeWindowManager();
  const protocolManager = new ProtocolManager().setDependencies({
    ytmViewManager: ytmViewManager as any,
    protectedApiManager,
    logger: extraDeps.logger as any,
  });

  const service = new ListenTogetherService().setDependencies({
    configStore: configStore as any,
    memoryStore: memoryStore as any,
    ytmViewManager: ytmViewManager as any,
    playerStateStore: playerStateStore as any,
    protectedApiManager,
    protocolManager,
    windowManager: windowManager as any,
    ipcMain: ipc as unknown as Electron.IpcMain,
    logger: extraDeps.logger,
    nowMs: extraDeps.nowMs,
    createDirectBrowser: extraDeps.createDirectBrowser,
    createRelayHostClient: extraDeps.createRelayHostClient,
    createRelayTransport: extraDeps.createRelayTransport,
    createTailcatHost: extraDeps.createTailcatHost,
    createTailcatTransport: extraDeps.createTailcatTransport,
    resolveTailcatBinaryFn: extraDeps.resolveTailcatBinaryFn ?? (() => null),
    relayHostClientOptions: extraDeps.relayHostClientOptions,
    relayTransportOptions: extraDeps.relayTransportOptions,
    directHostOptions: extraDeps.disableDirectHost
      ? {
          networkInterfacesFn: () => ({}),
        }
      : {
          networkInterfacesFn: () => ({
            eth0: [
              {
                address: "192.168.1.50",
                netmask: "255.255.255.0",
                family: "IPv4",
                mac: "00:00:00:00:00:00",
                internal: false,
                cidr: "192.168.1.50/24",
              },
            ],
          }),
        },
    createDirectWebSocket:
      extraDeps.createDirectWebSocket ??
      ((url, opts) =>
        new WebSocket(url.replace("192.168.1.50", "127.0.0.1"), opts)),
  });

  service.onInitialized();

  return {
    service,
    ipc,
    configStore,
    ytmViewManager,
    playerStateStore,
    protectedApiManager,
    listenApi,
    invokeLog,
    protocolManager,
    windowManager,
  };
}

describe("ListenTogetherService", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it("extracts video IDs from YTM, YouTube, youtu.be, and ytmd:// inputs", () => {
    expect(extractVideoIdFromInput("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(
      extractVideoIdFromInput("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractVideoIdFromInput("https://youtu.be/dQw4w9WgXcQ?t=12")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractVideoIdFromInput("ytmd://play/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractVideoIdFromInput("https://evil.example.com/watch?v=123"),
    ).toBe(null);
  });

  it("enforces strict authorized sender IDs across all listenTogether:* IPC channels", async () => {
    const h = createServiceHarness();
    cleanups.push(() => h.service.onTerminated());

    h.service.setAuthorizedSenderIds([10, 42]);

    const getStateHandler = h.ipc.handles.get(LISTEN_TOGETHER_IPC.getState)!;
    const actionHandler = h.ipc.handles.get(LISTEN_TOGETHER_IPC.action)!;
    const toggleListener = h.ipc.listeners.get(
      LISTEN_TOGETHER_IPC.togglePanel,
    )!;
    const closeListener = h.ipc.listeners.get(LISTEN_TOGETHER_IPC.closePanel)!;

    expect(() => getStateHandler({ sender: { id: 999 } })).toThrow(
      /Unauthorized sender/,
    );
    await expect(
      actionHandler({ sender: { id: 999 } }, { type: "dismissError" }),
    ).rejects.toThrow(/Unauthorized sender/);

    toggleListener({ sender: { id: 999 } });
    expect(h.service.getUIState().panelOpen).toBe(false);

    toggleListener({ sender: { id: 42 } });
    expect(h.service.getUIState().panelOpen).toBe(true);

    closeListener({ sender: { id: 10 } });
    expect(h.service.getUIState().panelOpen).toBe(false);
  });

  it("connects Host and Guest over DirectWs, rotates invite tokens, and syncs barrier -> playing", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    const createRes = await host.service.createRoom({
      displayName: "HostAlice",
    });
    expect(createRes).toEqual({ ok: true });

    const initialHostState = host.service.getUIState();
    expect(initialHostState.view).toBe("active");
    expect(initialHostState.room?.passcode).toMatch(
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/,
    );
    expect(initialHostState.room?.inviteUrl).toMatch(/^ytmd:\/\/l\//);
    expect(host.service.getHostQuitGuardInfo()).toEqual({
      shouldConfirm: false,
      guestCount: 0,
    });

    const inviteUrl = initialHostState.room!.inviteUrl!;
    const joinRes = await guest.service.joinByUrl(inviteUrl, {
      displayName: "GuestBob",
    });
    expect(joinRes).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.members.length).toBe(2);
      expect(guest.service.getUIState().view).toBe("active");
    });

    expect(host.service.getHostQuitGuardInfo()).toEqual({
      shouldConfirm: true,
      guestCount: 1,
    });

    const oldEnvelope = parseInviteUrl(inviteUrl)!;
    const resetRes = await host.service.resetInviteLinkAndCode();
    expect(resetRes).toEqual({ ok: true });
    const newInviteUrl = host.service.getUIState().room!.inviteUrl!;
    const newEnvelope = parseInviteUrl(newInviteUrl)!;
    expect(newEnvelope.te).toBe(oldEnvelope.te + 1);
    expect(host.service.getUIState().room?.members.length).toBe(2);

    const addRes = await host.service.handleCommand({
      type: "addSongByUrlOrId",
      input: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(addRes).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.currentTrack?.videoId).toBe(
        "dQw4w9WgXcQ",
      );
      expect(
        guest.invokeLog.some(
          (c) =>
            c.name === "loadExactVideo" &&
            (c.args[0] as any)?.videoId === "dQw4w9WgXcQ",
        ),
      ).toBe(true);
    });

    host.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });
    guest.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });

    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.anchor?.desiredState).toBe(
        "PLAYING",
      );
      expect(guest.service.getUIState().room?.anchor?.desiredState).toBe(
        "PLAYING",
      );
    });
  });

  it("re-applies setSessionLock and resyncs on YTMViewManager view-recreated and Ready", async () => {
    const host = createServiceHarness("HostAlice");
    cleanups.push(() => host.service.onTerminated());

    const seedTrack: QueueTrack = {
      entryId: "entry-1",
      videoId: "dQw4w9WgXcQ",
      title: "Seed Song",
      author: "Artist",
      durationSec: 200,
      thumbnailUrl: null,
      addedBy: "host",
      addedByName: "HostAlice",
      addedAtMs: 1,
      source: "dj",
      pinned: false,
    };

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: [seedTrack],
    });

    const lockCountBefore = host.invokeLog.filter(
      (c) => c.name === "setSessionLock",
    ).length;
    const loadCountBefore = host.invokeLog.filter(
      (c) => c.name === "loadExactVideo",
    ).length;

    host.ytmViewManager.emit("view-recreated");
    host.ytmViewManager.status = YTMViewStatus.Ready;
    host.ytmViewManager.emit("status-changed");

    await vi.waitFor(() => {
      const lockCountAfter = host.invokeLog.filter(
        (c) => c.name === "setSessionLock",
      ).length;
      const loadCountAfter = host.invokeLog.filter(
        (c) => c.name === "loadExactVideo",
      ).length;
      expect(lockCountAfter).toBeGreaterThan(lockCountBefore);
      expect(loadCountAfter).toBeGreaterThan(loadCountBefore);
    });
  });

  it("handles hostNewRoomWithQueue from ended state cleanly", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    const seedTrack: QueueTrack = {
      entryId: "entry-1",
      videoId: "dQw4w9WgXcQ",
      title: "Seed Song",
      author: "Artist",
      durationSec: 200,
      thumbnailUrl: null,
      addedBy: "host",
      addedByName: "HostAlice",
      addedAtMs: 1,
      source: "dj",
      pinned: false,
    };

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: [seedTrack],
    });
    const inviteUrl = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestBob" });

    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    await host.service.leaveRoom();

    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("ended");
      expect(guest.service.getUIState().ended?.reason).toBe("host-left");
      expect(guest.service.getUIState().ended?.queueSnapshot.length).toBe(1);
    });

    const contRes = await guest.service.hostNewRoomWithQueue();
    expect(contRes).toEqual({ ok: true });
    expect(guest.service.getUIState().view).toBe("active");
    expect(guest.service.getUIState().room?.isHost).toBe(true);
    expect(guest.service.getUIState().room?.currentTrack?.videoId).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("opens invite-confirm view when receiving an invite URL from ended state", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    await guest.service.joinByUrl(host.service.getUIState().room!.inviteUrl!, {
      displayName: "GuestBob",
    });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    await host.service.leaveRoom();
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("ended");
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    const freshInvite = host.service.getUIState().room!.inviteUrl!;
    guest.service.handleIncomingInviteUrl(freshInvite);

    expect(guest.service.getUIState().view).toBe("invite-confirm");
    expect(guest.service.getUIState().panelOpen).toBe(true);
    expect(guest.service.getUIState().pendingInvite?.rawUrl).toBe(freshInvite);
  });

  it("handles Rule 0 adStarted/adEnded and PlayerSignal.TrackEnded", async () => {
    const host = createServiceHarness("HostAlice");
    cleanups.push(() => host.service.onTerminated());

    const tracks: QueueTrack[] = [
      {
        entryId: "entry-1",
        videoId: "dQw4w9WgXcQ",
        title: "Track One",
        author: "Artist",
        durationSec: 200,
        thumbnailUrl: null,
        addedBy: "host",
        addedByName: "HostAlice",
        addedAtMs: 1,
        source: "dj",
        pinned: false,
      },
      {
        entryId: "entry-2",
        videoId: "9bZkp7q19f0",
        title: "Track Two",
        author: "Artist",
        durationSec: 210,
        thumbnailUrl: null,
        addedBy: "host",
        addedByName: "HostAlice",
        addedAtMs: 2,
        source: "dj",
        pinned: false,
      },
    ];

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: tracks,
    });
    host.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });

    expect(host.service.getUIState().room?.anchor?.desiredState).toBe(
      "PLAYING",
    );

    host.listenApi.emit("adStarted");
    expect(host.service.getUIState().room?.anchor?.pausedForAd).toBe(true);
    expect(host.service.getUIState().room?.syncStatus).toBe("paused-for-ad");

    host.listenApi.emit("adEnded", { localVideoId: "dQw4w9WgXcQ" });
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.anchor?.pausedForAd).toBe(false);
    });

    host.playerStateStore.emit("player-signal", PlayerSignal.TrackEnded);
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.currentTrack?.videoId).toBe(
        "9bZkp7q19f0",
      );
    });
  });

  it("logs unauthorized IPC channel + senderId and never leaks invite URLs, tokens, signatures, or passcodes", async () => {
    const hostLogs = createSpyLogger();
    const guestLogs = createSpyLogger();
    const host = createServiceHarness("HostAlice", { logger: hostLogs.logger });
    const guest = createServiceHarness("GuestBob", {
      logger: guestLogs.logger,
    });
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    host.service.setAuthorizedSenderIds([10]);
    const toggleListener = host.ipc.listeners.get(
      LISTEN_TOGETHER_IPC.togglePanel,
    )!;
    const closeListener = host.ipc.listeners.get(
      LISTEN_TOGETHER_IPC.closePanel,
    )!;
    toggleListener({ sender: { id: 777 } });
    closeListener({ sender: { id: 888 } });

    expect(hostLogs.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          context: expect.objectContaining({
            channel: LISTEN_TOGETHER_IPC.togglePanel,
            senderId: 777,
          }),
        }),
        expect.objectContaining({
          level: "warn",
          context: expect.objectContaining({
            channel: LISTEN_TOGETHER_IPC.closePanel,
            senderId: 888,
          }),
        }),
      ]),
    );

    await host.service.createRoom({ displayName: "HostAlice" });
    const room = host.service.getUIState().room!;
    const passcode = room.passcode!;
    const inviteUrl = room.inviteUrl!;
    const parsed = parseInviteUrl(inviteUrl)!;

    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestBob" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    await host.service.resetInviteLinkAndCode();
    const resetRoom = host.service.getUIState().room!;
    const newPasscode = resetRoom.passcode!;
    const newInviteUrl = resetRoom.inviteUrl!;
    const newParsed = parseInviteUrl(newInviteUrl)!;

    await guest.service.joinByPasscode(newPasscode, {
      displayName: "GuestBob",
      lanEndpoint: newParsed.ep?.[0],
    });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    guest.listenApi.emit("audioBlocked");
    expect(guest.service.getUIState().room?.audioBlocked).toBe(true);
    await guest.service.handleCommand({ type: "enableAudio" });
    expect(guest.service.getUIState().room?.audioBlocked).toBe(false);

    const badCode = "WXYZ-2345";
    await guest.service.joinByPasscode(badCode, { displayName: "GuestBob" });
    await guest.protocolManager.handleYTMDProtocol(newInviteUrl);

    const serializedLogs = JSON.stringify([
      ...hostLogs.entries,
      ...guestLogs.entries,
    ]);
    for (const secret of [
      passcode,
      passcode.replace("-", ""),
      newPasscode,
      newPasscode.replace("-", ""),
      badCode,
      badCode.replace("-", ""),
      inviteUrl,
      newInviteUrl,
      parsed.t,
      parsed.s,
      newParsed.t,
      newParsed.s,
    ]) {
      expect(serializedLogs).not.toContain(secret);
    }
    expect(serializedLogs).toContain("ytmd://l/[redacted]");
  });

  it("supports joinByPasscode over LAN discovery and rejects invalid or unknown passcodes", async () => {
    let onRoomsChangedCb: ((rooms: any[]) => void) | null = null;
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob", {
      createDirectBrowser: () => ({
        onRoomsChanged: (cb) => {
          onRoomsChangedCb = cb;
          return () => {
            onRoomsChangedCb = null;
          };
        },
        start: () => {},
        stop: async () => {},
      }),
    });
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.handleCommand({ type: "setLanDiscovery", enabled: true });
    await guest.service.handleCommand({ type: "setLanDiscovery", enabled: true });
    guest.service.onPostInitialized();

    // Invalid passcode format rejected immediately
    const invalidRes = await guest.service.joinByPasscode("bad-code", {
      displayName: "GuestBob",
    });
    expect(invalidRes).toEqual({ ok: false, error: "Invalid room code" });
    expect(guest.service.getUIState().view).toBe("lobby");
    expect(guest.service.getUIState().errorBanner).toBe("Invalid room code");

    // Valid format but unknown room without LAN/relay
    const unknownRes = await guest.service.joinByPasscode("ABCD-EFGH", {
      displayName: "GuestBob",
    });
    expect(unknownRes.ok).toBe(false);
    expect(guest.service.getUIState().view).toBe("lobby");
    expect(guest.service.getUIState().errorBanner).toBe(
      "Couldn't reach this room",
    );

    // Host creates room and LAN discovery advertises its endpoint
    await host.service.createRoom({ displayName: "HostAlice" });
    const hostRoom = host.service.getUIState().room!;
    const envelope = parseInviteUrl(hostRoom.inviteUrl!)!;
    const lanEndpoint = envelope.ep![0];
    const parsedEp = new URL(
      lanEndpoint.includes("://") ? lanEndpoint : `ws://${lanEndpoint}`,
    );

    // Join via explicit lanEndpoint
    const directRes = await guest.service.joinByPasscode(
      hostRoom.passcode!.replace("-", "").toLowerCase(),
      {
        displayName: "GuestBob",
        lanEndpoint,
      },
    );
    expect(directRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
      expect(guest.service.getUIState().room?.connectionKind).toBe("direct");
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });

    // Also verify LAN room discovery entry lookup works when leaving and re-joining without explicit lanEndpoint
    await guest.service.leaveRoom();
    const lookupMatches = (await import("../crypto")).derivePasscodeLookup(
      hostRoom.passcode!,
    );
    const { lookupId } = await lookupMatches;
    onRoomsChangedCb!([
      {
        lookupId,
        label: "HostAlice",
        host: parsedEp.hostname,
        port: Number(parsedEp.port),
        endpoint: lanEndpoint,
        lastSeenMs: Date.now(),
      },
    ]);
    expect(guest.service.getUIState().lanRooms).toHaveLength(1);

    const lanDiscoveredRes = await guest.service.joinByPasscode(
      hostRoom.passcode!,
      { displayName: "GuestBob" },
    );
    expect(lanDiscoveredRes).toEqual({ ok: true });
    expect(guest.service.getUIState().room?.connectionKind).toBe("direct");
  });

  it("supports joinByPasscode over real createRelayServer and rejects unknown passcode on relay", async () => {
    const relayServer = await createRelayServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      rateLimitMax: 100,
    });
    cleanups.push(() => relayServer.close());
    const relayUrl = await relayServer.start();

    const relayOpts = {
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 as const }],
      createWebSocket: (_url: string | URL, opts?: any) =>
        new WebSocket(relayUrl, opts),
      heartbeatIntervalMs: 0,
      timeoutMs: 2_000,
    };

    const host = createServiceHarness("HostAlice", {
      signalingUrl: "wss://relay.example.com/ws",
      relayHostClientOptions: relayOpts,
      disableDirectHost: true,
    });
    const guest = createServiceHarness("GuestBob", {
      signalingUrl: "wss://relay.example.com/ws",
      relayTransportOptions: relayOpts,
    });
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    // Unknown passcode fails cleanly against real relay
    const unknownRes = await guest.service.joinByPasscode("WXYZ-2345", {
      displayName: "GuestBob",
    });
    expect(unknownRes.ok).toBe(false);
    expect(guest.service.getUIState().view).toBe("lobby");
    expect(guest.service.getUIState().errorBanner).toBe(
      "Couldn't reach this room",
    );

    await host.service.createRoom({ displayName: "HostAlice" });
    const hostRoom = host.service.getUIState().room!;
    expect(hostRoom.connectionKind).toBe("relay");

    const joinRes = await guest.service.joinByPasscode(hostRoom.passcode!, {
      displayName: "GuestBob",
    });
    expect(joinRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
      expect(guest.service.getUIState().room?.connectionKind).toBe("relay");
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });
  });

  it("handles RelayHostClient 20s Host grace reconnect (epoch += 1 and Guest ClockSync reset)", async () => {
    vi.useFakeTimers();
    const hub = createFakeRelayHub();
    const hostLogs = createSpyLogger();
    const guestLogs = createSpyLogger();
    let hostClockMs = 5_000;
    let guestClockMs = 1_000;

    const host = createServiceHarness("HostAlice", {
      signalingUrl: "wss://relay.example.com/ws",
      logger: hostLogs.logger,
      nowMs: () => hostClockMs,
      disableDirectHost: true,
      createRelayHostClient: hub.createRelayHostClient,
    });
    const guest = createServiceHarness("GuestBob", {
      signalingUrl: "wss://relay.example.com/ws",
      logger: guestLogs.logger,
      nowMs: () => guestClockMs,
      createRelayTransport: hub.createRelayTransport,
    });
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    const passcode = host.service.getUIState().room!.passcode!;
    await guest.service.joinByPasscode(passcode, { displayName: "GuestBob" });

    // Let initial ClockSync burst record samples (hostClockMs - guestClockMs === 4000ms)
    await vi.advanceTimersByTimeAsync(250);
    expect(guest.service.getUIState().view).toBe("active");
    expect(guest.service.getUIState().room?.members.length).toBe(2);

    // Drop primary Host relay client -> closes Guest transport and starts Host reconnect + Guest 20s grace
    const primaryLookupId = Array.from(hub.hostsByLookup.keys()).find(
      (k) => k !== host.service.getUIState().room!.roomId,
    )!;
    hub.hostsByLookup.get(primaryLookupId)!.simulateDrop(1006, "Network lost");
    await vi.advanceTimersByTimeAsync(0);

    expect(host.service.getUIState().room?.isLocalNetworkOnly).toBe(true);
    expect(guest.service.getUIState().room?.hostGraceRemainingMs).toBe(20_000);

    // Advance 1s -> Host reconnects via HOST_RESUME (epoch 1 -> 2)
    hostClockMs += 1_000;
    guestClockMs += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(
      hub.connectModes.some(
        (m) => m.lookupId === primaryLookupId && m.mode === "resume",
      ),
    ).toBe(true);
    expect(host.service.getUIState().room?.isLocalNetworkOnly).toBe(false);
    expect(hostLogs.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message:
          "Host relay reconnected; incremented room epoch and broadcast SYNC_ANCHOR",
        context: expect.objectContaining({ prevEpoch: 1, epoch: 2 }),
      }),
    );

    // Advance 600ms -> Guest 1.5s retry reconnects within grace window and observes epoch change -> ClockSync reset
    hostClockMs += 600;
    guestClockMs += 600;
    await vi.advanceTimersByTimeAsync(600);

    expect(guest.service.getUIState().view).toBe("active");
    expect(guest.service.getUIState().room?.hostGraceRemainingMs).toBeNull();
    expect(guestLogs.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: "Recovered connection to Host within grace window",
      }),
    );
    expect(guestLogs.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message:
          "Guest observed room epoch change; resetting ClockSync and DriftController",
        context: expect.objectContaining({ prevEpoch: 1, epoch: 2 }),
      }),
    );
    expect(guestLogs.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: "ClockSync reset",
        context: expect.objectContaining({
          previousOffsetMs: 4000,
          previousSampleCount: expect.any(Number),
        }),
      }),
    );
  });

  it("transitions Guest to ended with queueSnapshot when 20s Host grace window expires", async () => {
    vi.useFakeTimers();
    const hub = createFakeRelayHub();
    let now = 10_000;
    const host = createServiceHarness("HostAlice", {
      signalingUrl: "wss://relay.example.com/ws",
      nowMs: () => now,
      disableDirectHost: true,
      createRelayHostClient: hub.createRelayHostClient,
    });
    const guest = createServiceHarness("GuestBob", {
      signalingUrl: "wss://relay.example.com/ws",
      nowMs: () => now,
      createRelayTransport: hub.createRelayTransport,
    });
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    const tracks: QueueTrack[] = [
      {
        entryId: "entry-1",
        videoId: "dQw4w9WgXcQ",
        title: "Track One",
        author: "Artist",
        durationSec: 200,
        thumbnailUrl: null,
        addedBy: "host",
        addedByName: "HostAlice",
        addedAtMs: 1,
        source: "dj",
        pinned: false,
      },
      {
        entryId: "entry-2",
        videoId: "9bZkp7q19f0",
        title: "Track Two",
        author: "Artist",
        durationSec: 210,
        thumbnailUrl: null,
        addedBy: "host",
        addedByName: "HostAlice",
        addedAtMs: 2,
        source: "dj",
        pinned: false,
      },
    ];

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: tracks,
    });
    const passcode = host.service.getUIState().room!.passcode!;
    await guest.service.joinByPasscode(passcode, { displayName: "GuestBob" });
    await vi.advanceTimersByTimeAsync(0);

    expect(guest.service.getUIState().room?.currentTrack?.videoId).toBe(
      "dQw4w9WgXcQ",
    );
    expect(guest.service.getUIState().room?.queue).toHaveLength(1);

    // Host goes completely offline and stays offline past the 20s grace window
    hub.setRejectHostReconnect(true);
    hub.setRejectGuestConnect(true);
    const primaryLookupId = Array.from(hub.hostsByLookup.keys()).find(
      (k) => k !== host.service.getUIState().room!.roomId,
    )!;
    hub.hostsByLookup.get(primaryLookupId)!.simulateDrop(1006, "Host offline");
    await vi.advanceTimersByTimeAsync(0);

    expect(guest.service.getUIState().view).toBe("active");
    expect(guest.service.getUIState().room?.hostGraceRemainingMs).toBe(20_000);

    now += 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(guest.service.getUIState().view).toBe("active");
    expect(guest.service.getUIState().room?.hostGraceRemainingMs).toBe(10_000);

    now += 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    const endedState = guest.service.getUIState();
    expect(endedState.view).toBe("ended");
    expect(endedState.ended?.reason).toBe("timeout");
    expect(endedState.ended?.queueSnapshot.map((t) => t.videoId)).toEqual([
      "dQw4w9WgXcQ",
      "9bZkp7q19f0",
    ]);
    expect(
      guest.invokeLog.some(
        (c) =>
          c.name === "setSessionLock" && (c.args[0] as any)?.locked === false,
      ),
    ).toBe(true);
  });

  it("tracks audioBlocked state, clears via enableAudio/resumeBlockedAudio, handles failures, and auto-clears on Playing", async () => {
    let resumeResult: { ok: boolean; error?: string } = { ok: true };
    const guest = createServiceHarness("GuestBob", {
      onInvoke: (name) => {
        if (name === "resumeBlockedAudio") return resumeResult;
        return undefined;
      },
    });
    const host = createServiceHarness("HostAlice");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    const seedTrack: QueueTrack = {
      entryId: "entry-1",
      videoId: "dQw4w9WgXcQ",
      title: "Track One",
      author: "Artist",
      durationSec: 200,
      thumbnailUrl: null,
      addedBy: "host",
      addedByName: "HostAlice",
      addedAtMs: 1,
      source: "dj",
      pinned: false,
    };

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: [seedTrack],
    });
    const inviteUrl = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestBob" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    host.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });
    guest.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.anchor?.desiredState).toBe(
        "PLAYING",
      );
    });

    // 1) audioBlocked sets UI state and emits state-changed
    const stateEvents: Array<boolean> = [];
    guest.service.on("state-changed", (s) => {
      if (s.room) stateEvents.push(s.room.audioBlocked);
    });
    guest.listenApi.emit("audioBlocked");
    expect(guest.service.getUIState().room?.audioBlocked).toBe(true);
    expect(stateEvents).toContain(true);

    // 2) Failed resumeBlockedAudio keeps audioBlocked = true
    resumeResult = { ok: false, error: "NotAllowedError" };
    const failRes = await guest.service.handleCommand({ type: "enableAudio" });
    expect(failRes).toEqual({ ok: false, error: "NotAllowedError" });
    expect(guest.service.getUIState().room?.audioBlocked).toBe(true);

    // 3) Successful resumeBlockedAudio clears audioBlocked and triggers syncPlayback("play")
    resumeResult = { ok: true };
    const syncCountBefore = guest.invokeLog.filter(
      (c) => c.name === "syncPlayback",
    ).length;
    const okRes = await guest.service.handleCommand({ type: "enableAudio" });
    expect(okRes).toEqual({ ok: true });
    expect(guest.service.getUIState().room?.audioBlocked).toBe(false);
    expect(guest.invokeLog.some((c) => c.name === "resumeBlockedAudio")).toBe(
      true,
    );
    const syncPlays = guest.invokeLog
      .slice(syncCountBefore)
      .filter(
        (c) =>
          c.name === "syncPlayback" && (c.args[0] as any)?.action === "play",
      );
    expect(syncPlays.length).toBeGreaterThanOrEqual(1);

    // 4) Entering VideoState.Playing also clears audioBlocked automatically
    guest.listenApi.emit("audioBlocked");
    expect(guest.service.getUIState().room?.audioBlocked).toBe(true);
    guest.playerStateStore.emit("state-changed", {
      trackState: VideoState.Playing,
      videoProgress: 1,
      adPlaying: false,
      videoDetails: { id: "dQw4w9WgXcQ" },
    });
    expect(guest.service.getUIState().room?.audioBlocked).toBe(false);
  });

  it("reports getHostQuitGuardInfo() accurately across Host guest counts and Guest role", async () => {
    const host = createServiceHarness("HostAlice");
    const guest1 = createServiceHarness("GuestOne");
    const guest2 = createServiceHarness("GuestTwo");
    cleanups.push(async () => {
      guest2.service.onTerminated();
      guest1.service.onTerminated();
      host.service.onTerminated();
    });

    // Inactive -> false
    expect(host.service.getHostQuitGuardInfo()).toEqual({
      shouldConfirm: false,
      guestCount: 0,
    });

    // Host with 0 guests -> false
    await host.service.createRoom({ displayName: "HostAlice" });
    expect(host.service.getHostQuitGuardInfo()).toEqual({
      shouldConfirm: false,
      guestCount: 0,
    });

    const inviteUrl = host.service.getUIState().room!.inviteUrl!;

    // 1 guest -> true
    await guest1.service.joinByUrl(inviteUrl, { displayName: "GuestOne" });
    await vi.waitFor(() => {
      expect(host.service.getHostQuitGuardInfo()).toEqual({
        shouldConfirm: true,
        guestCount: 1,
      });
    });

    // Guest role itself never triggers Host quit guard
    expect(guest1.service.getHostQuitGuardInfo()).toEqual({
      shouldConfirm: false,
      guestCount: 0,
    });

    // 2 guests -> true
    await guest2.service.joinByUrl(inviteUrl, { displayName: "GuestTwo" });
    await vi.waitFor(() => {
      expect(host.service.getHostQuitGuardInfo()).toEqual({
        shouldConfirm: true,
        guestCount: 2,
      });
    });

    // Guest 1 leaves -> still 1 guest -> true; Guest 2 leaves -> 0 guests -> false
    await guest1.service.leaveRoom();
    await vi.waitFor(() => {
      expect(host.service.getHostQuitGuardInfo()).toEqual({
        shouldConfirm: true,
        guestCount: 1,
      });
    });

    await guest2.service.leaveRoom();
    await vi.waitFor(() => {
      expect(host.service.getHostQuitGuardInfo()).toEqual({
        shouldConfirm: false,
        guestCount: 0,
      });
    });
  });

  it("supports pin/unpin, local listening mode ignoring room anchors, addLocalTrackToQueue, and tuneBackIn", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    const inviteUrl = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestBob" });

    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    await host.service.handleCommand({
      type: "addSongByUrlOrId",
      input: "dQw4w9WgXcQ",
    });
    await host.service.handleCommand({
      type: "addSongByUrlOrId",
      input: "9bZkp7q19f0",
    });
    await host.service.handleCommand({
      type: "addSongByUrlOrId",
      input: "abcDEF12345",
    });

    const beforePin = host.service.getUIState().room!.queue;
    expect(beforePin.map((t) => t.videoId)).toEqual([
      "9bZkp7q19f0",
      "abcDEF12345",
    ]);

    const secondEntryId = beforePin[1].entryId;
    await host.service.handleCommand({
      type: "pinTrackNext",
      entryId: secondEntryId,
    });
    expect(
      host.service.getUIState().room!.queue.map((t) => [t.videoId, t.pinned]),
    ).toEqual([
      ["abcDEF12345", true],
      ["9bZkp7q19f0", false],
    ]);

    await host.service.handleCommand({
      type: "unpinTrack",
      entryId: secondEntryId,
    });
    expect(
      host.service.getUIState().room!.queue.map((t) => [t.videoId, t.pinned]),
    ).toEqual([
      ["9bZkp7q19f0", false],
      ["abcDEF12345", false],
    ]);

    // Guest enters local listening mode
    guest.listenApi.emit("localPlaybackStarted", {
      kind: "track",
      videoId: "kJQP7kiw5Fk",
      title: "Despacito",
    });
    guest.listenApi.emit("localTrackMetaResolved", {
      videoId: "kJQP7kiw5Fk",
      title: "Despacito",
      author: "Luis Fonsi",
      durationSec: 281,
      thumbnailUrl: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    });

    expect(guest.service.getUIState().room?.listeningMode).toBe("local");
    expect(guest.service.getUIState().room?.localTrack?.title).toBe("Despacito");

    // Host skips -> guest receives SYNC_ANCHOR but does NOT call loadExactVideo while listening locally
    const guestLoadCountBefore = guest.invokeLog.filter(
      (c) => c.name === "loadExactVideo",
    ).length;
    await host.service.handleCommand({ type: "hostTransport", action: "skip" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.currentTrack?.videoId).toBe(
        "9bZkp7q19f0",
      );
    });
    const guestLoadCountDuringLocal = guest.invokeLog.filter(
      (c) => c.name === "loadExactVideo",
    ).length;
    expect(guestLoadCountDuringLocal).toBe(guestLoadCountBefore);

    // Guest adds local song to room queue
    const addLocalRes = await guest.service.handleCommand({
      type: "addLocalTrackToQueue",
    });
    expect(addLocalRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(
        host.service
          .getUIState()
          .room?.queue.some((t) => t.videoId === "kJQP7kiw5Fk"),
      ).toBe(true);
    });

    // Guest tunes back in -> resumes room playback on current room track
    await guest.service.handleCommand({ type: "tuneBackIn" });
    expect(guest.service.getUIState().room?.listeningMode).toBe("room");
    const guestLoadCountAfterTuneIn = guest.invokeLog.filter(
      (c) =>
        c.name === "loadExactVideo" &&
        (c.args[0] as any)?.videoId === "9bZkp7q19f0",
    ).length;
    expect(guestLoadCountAfterTuneIn).toBeGreaterThan(0);
  });

  it("wires TailcatHostSidecar, InviteEnvelope tc/tcp, setTailcatDerpMapUrl, and TailcatWsTransport guest join", async () => {
    const fakeTcAddr = "tcTEST1234567890abcdef1234567890";
    let boundHostPort = 0;
    let hostSidecarStopped = false;

    const host = createServiceHarness("HostAlice", {
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatHost: () => ({
        start: async ({ localPort }) => {
          boundHostPort = localPort;
          return { tcAddress: fakeTcAddr, remotePort: localPort };
        },
        stop: async () => {
          hostSidecarStopped = true;
        },
      }),
    });

    const guest = createServiceHarness("GuestBob", {
      disableDirectHost: true,
      createDirectWebSocket: () => {
        throw new Error("Force tailcat path");
      },
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatTransport: (opts) => {
        expect(opts.tcAddress).toBe(fakeTcAddr);
        expect(opts.remotePort).toBe(boundHostPort);
        return {
          mode: "tailcat",
          connect: async () => {
            const ws = new WebSocket(`ws://127.0.0.1:${opts.remotePort}/`);
            await new Promise<void>((resolve, reject) => {
              ws.once("open", () => resolve());
              ws.once("error", reject);
            });
            const msgHandlers = new Set<(buf: Buffer) => void>();
            const closeHandlers = new Set<(c: number, r: string) => void>();
            const errHandlers = new Set<(e: Error) => void>();
            ws.on("message", (d) => {
              const buf = Buffer.isBuffer(d)
                ? d
                : Buffer.from(d as ArrayBuffer);
              for (const h of msgHandlers) h(buf);
            });
            ws.on("close", (c, r) => {
              for (const h of closeHandlers) h(c, r.toString("utf8"));
            });
            ws.on("error", (e) => {
              for (const h of errHandlers) h(e);
            });
            return {
              id: "tc-test-conn",
              mode: "tailcat",
              remoteLabel: "tailcat:redacted",
              get isOpen() {
                return ws.readyState === WebSocket.OPEN;
              },
              send: (d) => ws.send(d),
              close: (c, r) => ws.close(c, r),
              onMessage: (h) => {
                msgHandlers.add(h);
                return () => msgHandlers.delete(h);
              },
              onClose: (h) => {
                closeHandlers.add(h);
                return () => closeHandlers.delete(h);
              },
              onError: (h) => {
                errHandlers.add(h);
                return () => errHandlers.delete(h);
              },
            };
          },
          close: () => {},
        } as any;
      },
    });

    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    // Rejects non-https DERP map URLs and accepts valid https:// URL
    const badDerp = await host.service.handleCommand({
      type: "setTailcatDerpMapUrl",
      url: "http://insecure.example/derp.json",
    });
    expect(badDerp.ok).toBe(false);
    const okDerp = await host.service.handleCommand({
      type: "setTailcatDerpMapUrl",
      url: "https://derp.example.org/derpmap.json",
    });
    expect(okDerp).toEqual({ ok: true });
    expect(host.service.getUIState().tailcatAvailable).toBe(true);
    expect(host.service.getUIState().tailcatDerpMapUrl).toBe(
      "https://derp.example.org/derpmap.json",
    );

    await host.service.createRoom({ displayName: "HostAlice" });
    const hostRoom = host.service.getUIState().room!;
    expect(hostRoom.connectionKind).toBe("tailcat");
    expect(hostRoom.isLocalNetworkOnly).toBe(false);

    const parsedInvite = parseInviteUrl(hostRoom.inviteUrl!)!;
    expect(parsedInvite.tc).toBe(fakeTcAddr);
    expect(parsedInvite.tcp).toBe(boundHostPort);

    const joinRes = await guest.service.joinByUrl(hostRoom.inviteUrl!, {
      displayName: "GuestBob",
    });
    expect(joinRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.connectionKind).toBe("tailcat");
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });

    await host.service.leaveRoom();
    expect(hostSidecarStopped).toBe(true);
  });

  it("ignores hostTransportRequested while in local listening mode and exposes remotePositionSec on UI state", async () => {
    const host = createServiceHarness("HostAlice");
    cleanups.push(async () => {
      host.service.onTerminated();
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    host.listenApi.emit("trackSelectedCandidate", {
      videoId: "dQw4w9WgXcQ",
      title: "Room Song",
      author: "Rick Astley",
      durationSec: 213,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    await host.service.handleCommand({ type: "acceptClickedCandidate" });
    host.listenApi.emit("trackReady", { videoId: "dQw4w9WgXcQ" });

    let state = host.service.getUIState();
    expect(state.room?.anchor?.desiredState).toBe("PLAYING");
    expect(state.room?.remotePositionAdvancing).toBe(true);
    expect(state.room?.remotePositionSec).toBeGreaterThanOrEqual(0);

    // Entering local listening mode preserves remote room PLAYING state even if YTMView posts hostTransportRequested('pause')
    host.listenApi.emit("localPlaybackStarted", {
      kind: "track",
      videoId: "9bZkp7q19f0",
    });
    host.listenApi.emit("hostTransportRequested", { action: "pause" });

    state = host.service.getUIState();
    expect(state.room?.listeningMode).toBe("local");
    expect(state.room?.anchor?.desiredState).toBe("PLAYING");
    expect(state.room?.remotePositionAdvancing).toBe(true);
  });

  it("handles reorderQueue, jumpToTrack, voteSkip, tuneBackIn, and resetInviteLinkAndCode end-to-end", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    const mk = (n: number, vid: string): QueueTrack => ({
      entryId: `e-${n}`,
      videoId: vid,
      title: `Track ${n}`,
      author: `Artist ${n}`,
      durationSec: 180,
      thumbnailUrl: null,
      addedBy: "host",
      addedByName: "HostAlice",
      addedAtMs: n,
      source: "dj",
      pinned: false,
    });

    await host.service.createRoom({
      displayName: "HostAlice",
      initialQueue: [
        mk(1, "dQw4w9WgXcQ"),
        mk(2, "9bZkp7q19f0"),
        mk(3, "kJQP7kiw5Fk"),
      ],
    });
    const oldInvite = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(oldInvite, { displayName: "GuestBob" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    // Reorder queued track 3 ahead of track 2
    await host.service.handleCommand({
      type: "reorderQueue",
      entryId: "e-3",
      targetIndex: 0,
    });
    await vi.waitFor(() => {
      expect(
        guest.service.getUIState().room?.queue.map((t) => t.entryId),
      ).toEqual(["e-3", "e-2"]);
    });

    // Jump forward to e-2 -> e-1 moves to history
    await host.service.handleCommand({
      type: "jumpToTrack",
      target: "queue",
      entryId: "e-2",
    });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.currentTrack?.entryId).toBe("e-2");
      expect(
        guest.service.getUIState().room?.history.map((t) => t.entryId),
      ).toEqual(["e-1"]);
    });

    // Guest votes skip (1/2) then host votes skip (2/2) -> advances to e-3
    await guest.service.handleCommand({ type: "voteSkip" });
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.skipVotes.length).toBe(1);
    });
    await host.service.handleCommand({ type: "voteSkip" });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.currentTrack?.entryId).toBe("e-3");
    });

    // Tune back in from local mode
    host.listenApi.emit("localPlaybackStarted", {
      kind: "track",
      videoId: "9bZkp7q19f0",
    });
    expect(host.service.getUIState().room?.listeningMode).toBe("local");
    await host.service.handleCommand({ type: "tuneBackIn" });
    expect(host.service.getUIState().room?.listeningMode).toBe("room");

    // Reset invite link
    const resetRes = await host.service.handleCommand({
      type: "resetInviteLinkAndCode",
    });
    expect(resetRes).toEqual({ ok: true });
    expect(host.service.getUIState().room?.inviteUrl).not.toBe(oldInvite);
  });

  it("handles settings, moderation, local queue add, invalid inputs, and lobby commands", async () => {
    const host = createServiceHarness("HostAlice");
    const guest = createServiceHarness("GuestBob");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.handleCommand({
      type: "setDisplayName",
      displayName: "HostAlice2",
    });
    await host.service.handleCommand({
      type: "setTailcatDerpMapUrl",
      url: "https://derp.example.com/map.json",
    });
    await host.service.handleCommand({
      type: "setTailcatDerpMapUrl",
      url: null,
    });
    await host.service.handleCommand({ type: "dismissError" });

    await host.service.createRoom({ displayName: "HostAlice2" });
    await guest.service.joinByUrl(host.service.getUIState().room!.inviteUrl!, {
      displayName: "GuestBob",
    });
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });

    const guestPeerId = host.service
      .getUIState()
      .room!.members.find((m) => m.displayName === "GuestBob")!.peerId;

    // Invalid song URL returns error cleanly
    const badAdd = await host.service.handleCommand({
      type: "addSongByUrlOrId",
      input: "not-a-valid-url",
    });
    expect(badAdd.ok).toBe(false);

    // Update room settings
    await host.service.handleCommand({
      type: "updateRoomSettings",
      settings: {
        queueMode: "fifo",
        voteSkipMode: "two-thirds",
        adSyncMode: "stay-live",
        rateLimitPreset: "strict",
        autoplayMode: "off",
      },
    });
    expect(host.service.getUIState().room?.settings.queueMode).toBe("fifo");
    expect(host.service.getUIState().room?.settings.voteSkipMode).toBe(
      "two-thirds",
    );

    // Moderate member: make-listener -> make-dj -> kick
    await host.service.handleCommand({
      type: "moderateMember",
      targetPeerId: guestPeerId,
      action: "make-listener",
    });
    expect(
      host.service
        .getUIState()
        .room?.members.find((m) => m.peerId === guestPeerId)?.role,
    ).toBe("listener");

    await host.service.handleCommand({
      type: "moderateMember",
      targetPeerId: guestPeerId,
      action: "make-dj",
    });
    expect(
      host.service
        .getUIState()
        .room?.members.find((m) => m.peerId === guestPeerId)?.role,
    ).toBe("dj");

    // Local track add
    host.listenApi.emit("localPlaybackStarted", {
      kind: "track",
      videoId: "dQw4w9WgXcQ",
      title: "Local Song",
    });
    const addLocalRes = await host.service.handleCommand({
      type: "addLocalTrackToQueue",
    });
    expect(addLocalRes).toEqual({ ok: true });
    expect(host.service.getUIState().room?.currentTrack?.videoId).toBe(
      "dQw4w9WgXcQ",
    );

    await host.service.handleCommand({ type: "dismissNotice" });
    await host.service.handleCommand({ type: "dismissClickedCandidate" });
    await host.service.handleCommand({ type: "openLogFile" });

    // Kick guest
    await host.service.handleCommand({
      type: "moderateMember",
      targetPeerId: guestPeerId,
      action: "kick",
    });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("ended");
    });
    await guest.service.handleCommand({ type: "returnToLobby" });
    expect(guest.service.getUIState().view).toBe("lobby");
  });

  it("persists clientSlug, persistentRoomEnabled, and favoriteRooms with autoJoin", async () => {
    const host = createServiceHarness();
    const guest = createServiceHarness();

    const slug = host.service.getUIState().clientSlug;
    expect(slug).toMatch(/^usr_[a-f0-9]{12}$/);

    await host.service.handleCommand({
      type: "setPersistentRoom",
      enabled: true,
    });
    expect(host.service.getUIState().persistentRoomEnabled).toBe(true);

    await host.service.createRoom({ displayName: "HostPersist" });
    const firstRoomId = host.service.getUIState().room?.roomId;
    const inviteUrl = host.service.getUIState().room?.inviteUrl;
    expect(firstRoomId).toBeTruthy();
    expect(inviteUrl).toBeTruthy();

    // Recreating room with persistentRoomEnabled reuses the same roomId
    await host.service.handleCommand({ type: "leaveRoom" });
    await host.service.createRoom({ displayName: "HostPersist" });
    expect(host.service.getUIState().room?.roomId).toBe(firstRoomId);

    const newInviteUrl = host.service.getUIState().room?.inviteUrl!;
    const joinRes = await guest.service.joinByUrl(newInviteUrl, {
      displayName: "GuestFav",
      trustRelayHost: true,
    });
    expect(joinRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    await guest.service.handleCommand({ type: "saveFavoriteRoom" });
    expect(guest.service.getUIState().room?.isFavorite).toBe(true);
    const favId = guest.service.getUIState().favoriteRooms[0]!.id;
    await guest.service.handleCommand({
      type: "toggleFavoriteAutoJoin",
      id: favId,
      autoJoin: true,
    });
    expect(guest.service.getUIState().favoriteRooms[0]!.autoJoin).toBe(true);

    await guest.service.handleCommand({ type: "removeFavoriteRoom", id: favId });
    expect(guest.service.getUIState().favoriteRooms).toHaveLength(0);
  });

  it("migrates host to promoted peer and preserves queue when host leaves without ending for all", async () => {
    const host = createServiceHarness("HostOwner");
    const guest = createServiceHarness("GuestPromoted");
    cleanups.push(async () => {
      guest.service.onTerminated();
      host.service.onTerminated();
    });

    await host.service.createRoom({
      displayName: "HostOwner",
      initialQueue: [
        {
          entryId: "e-mig-1",
          videoId: "dQw4w9WgXcQ",
          title: "Persistent Song",
          author: "Artist",
          durationSec: 212,
          thumbnailUrl: null,
          addedBy: "HostOwner",
          addedByName: "HostOwner",
          addedAtMs: 1,
          source: "dj",
          pinned: false,
        },
      ],
    });
    const inviteUrl = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestPromoted" });
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });

    const guestPeerId = host.service
      .getUIState()
      .room!.members.find((m) => m.displayName === "GuestPromoted")!.peerId;

    await host.service.handleCommand({
      type: "moderateMember",
      targetPeerId: guestPeerId,
      action: "promote-host",
    });

    await vi.waitFor(() => {
      expect(guest.service.getUIState().room?.isHost).toBe(true);
      expect(host.service.getUIState().room?.isHost).toBe(false);
    });
    expect(guest.service.getUIState().room?.currentTrack?.videoId).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("supports mutual friend handshake, Tailcat joinFriend without invite link, and removeFriend", async () => {
    const fakeTcAddr = "tcFRIEND1234567890abcdef12345678";
    const stableRemotePort = 44444;
    let boundHostPort = 0;

    const host = createServiceHarness("HostAlice", {
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatHost: () => ({
        start: async ({ localPort }) => {
          boundHostPort = localPort;
          return { tcAddress: fakeTcAddr, remotePort: stableRemotePort };
        },
        stop: async () => {},
      }),
    });

    const guest = createServiceHarness("GuestBob", {
      disableDirectHost: true,
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatTransport: (opts) => ({
        mode: "tailcat",
        connect: async () => {
          expect(opts.tcAddress).toBe(fakeTcAddr);
          expect(opts.remotePort).toBe(stableRemotePort);
          const ws = new WebSocket(`ws://127.0.0.1:${boundHostPort}/`);
          await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
          });
          const msgHandlers = new Set<(buf: Buffer) => void>();
          const closeHandlers = new Set<(c: number, r: string) => void>();
          const errHandlers = new Set<(e: Error) => void>();
          ws.on("message", (d) => {
            const buf = Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer);
            for (const h of msgHandlers) h(buf);
          });
          ws.on("close", (c, r) => {
            for (const h of closeHandlers) h(c, r.toString("utf8"));
          });
          ws.on("error", (e) => {
            for (const h of errHandlers) h(e);
          });
          return {
            id: "tc-friend-conn",
            mode: "tailcat",
            remoteLabel: "tailcat:redacted",
            get isOpen() {
              return ws.readyState === WebSocket.OPEN;
            },
            send: (d) => ws.send(d),
            close: (c, r) => ws.close(c, r),
            onMessage: (h) => {
              msgHandlers.add(h);
              return () => msgHandlers.delete(h);
            },
            onClose: (h) => {
              closeHandlers.add(h);
              return () => closeHandlers.delete(h);
            },
            onError: (h) => {
              errHandlers.add(h);
              return () => errHandlers.delete(h);
            },
          };
        },
        close: () => {},
      }) as never,
    });

    await host.service.createRoom({ displayName: "HostAlice" });
    const inviteUrl = host.service.getUIState().room!.inviteUrl!;
    await guest.service.joinByUrl(inviteUrl, { displayName: "GuestBob" });
    await vi.waitFor(() => {
      expect(host.service.getUIState().room?.members.length).toBe(2);
    });

    const hostPeerId = host.service.getUIState().room!.selfPeerId;
    const guestPeerId = guest.service.getUIState().room!.selfPeerId;

    // Guest requests Host as friend -> Host must accept for mutual friendship
    await guest.service.handleCommand({
      type: "sendFriendRequest",
      targetPeerId: hostPeerId,
    });
    expect(guest.service.getUIState().friends).toHaveLength(0);

    await vi.waitFor(() => {
      expect(host.service.getUIState().pendingFriendRequests).toHaveLength(1);
    });

    const reqId = host.service.getUIState().pendingFriendRequests[0]!.id;
    await host.service.handleCommand({
      type: "respondFriendRequest",
      requestId: reqId,
      accept: true,
    });

    await vi.waitFor(() => {
      expect(host.service.getUIState().friends).toHaveLength(1);
      expect(guest.service.getUIState().friends).toHaveLength(1);
    });
    expect(guest.service.getUIState().friends[0]!.tcAddress).toBe(fakeTcAddr);
    expect(guest.service.getUIState().friends[0]!.tcPort).toBe(
      stableRemotePort,
    );

    // Leave & reopen room on a brand new local port/token/passcode; guest joins via joinFriend
    await guest.service.handleCommand({ type: "leaveRoom" });
    await host.service.handleCommand({ type: "leaveRoom" });
    await host.service.createRoom({ displayName: "HostAlice" });

    const joinFriendRes = await guest.service.handleCommand({
      type: "joinFriend",
      pubKeyB64: hostPeerId,
    });
    expect(joinFriendRes).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(guest.service.getUIState().view).toBe("active");
    });

    // Removing friend revokes friend auth
    await host.service.handleCommand({
      type: "removeFriend",
      pubKeyB64: guestPeerId,
    });
    await vi.waitFor(() => {
      expect(host.service.getUIState().friends).toHaveLength(0);
      expect(guest.service.getUIState().friends).toHaveLength(0);
    });
  });

  it("allows friend-of-a-friend referral and 3-person host migration without auto-reclaim", async () => {
    const tcMap = new Map<string, number>();
    const makeTcTransport = (opts: { tcAddress: string; remotePort: number }) =>
      ({
        mode: "tailcat",
        connect: async () => {
          const port = tcMap.get(opts.tcAddress) ?? opts.remotePort;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
          await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
          });
          const msgHandlers = new Set<(buf: Buffer) => void>();
          const closeHandlers = new Set<(c: number, r: string) => void>();
          const errHandlers = new Set<(e: Error) => void>();
          ws.on("message", (d) => {
            const buf = Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer);
            for (const h of msgHandlers) h(buf);
          });
          ws.on("close", (c, r) => {
            for (const h of closeHandlers) h(c, r.toString("utf8"));
          });
          ws.on("error", (e) => {
            for (const h of errHandlers) h(e);
          });
          return {
            id: `tc-${opts.tcAddress}`,
            mode: "tailcat",
            remoteLabel: "tailcat:redacted",
            get isOpen() {
              return ws.readyState === WebSocket.OPEN;
            },
            send: (d: Buffer) => ws.send(d),
            close: (c?: number, r?: string) => ws.close(c, r),
            onMessage: (h: (buf: Buffer) => void) => {
              msgHandlers.add(h);
              return () => msgHandlers.delete(h);
            },
            onClose: (h: (c: number, r: string) => void) => {
              closeHandlers.add(h);
              return () => closeHandlers.delete(h);
            },
            onError: (h: (e: Error) => void) => {
              errHandlers.add(h);
              return () => errHandlers.delete(h);
            },
          };
        },
        close: () => {},
      }) as never;

    const tcA = "tcALICE1234567890abcdef123456789";
    const tcB = "tcBOB1234567890abcdef12345678901";
    const tcC = "tcCHARLIE1234567890abcdef1234567";

    const alice = createServiceHarness("Alice", {
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatHost: () => ({
        start: async ({ localPort }) => {
          tcMap.set(tcA, localPort);
          return { tcAddress: tcA, remotePort: localPort };
        },
        stop: async () => {},
      }),
      createTailcatTransport: makeTcTransport,
    });
    const bob = createServiceHarness("Bob", {
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatHost: () => ({
        start: async ({ localPort }) => {
          tcMap.set(tcB, localPort);
          return { tcAddress: tcB, remotePort: localPort };
        },
        stop: async () => {},
      }),
      createTailcatTransport: makeTcTransport,
    });
    const charlie = createServiceHarness("Charlie", {
      resolveTailcatBinaryFn: () => "/usr/local/bin/tailcat",
      createTailcatHost: () => ({
        start: async ({ localPort }) => {
          tcMap.set(tcC, localPort);
          return { tcAddress: tcC, remotePort: localPort };
        },
        stop: async () => {},
      }),
      createTailcatTransport: makeTcTransport,
    });

    // Establish B <-> C friendship first (Alice does NOT know Charlie)
    await bob.service.createRoom({ displayName: "Bob" });
    await charlie.service.joinByUrl(bob.service.getUIState().room!.inviteUrl!, {
      displayName: "Charlie",
    });
    await vi.waitFor(() => {
      expect(bob.service.getUIState().room?.members).toHaveLength(2);
    });
    const bobPeerId = bob.service.getUIState().room!.selfPeerId;
    await charlie.service.handleCommand({
      type: "sendFriendRequest",
      targetPeerId: bobPeerId,
    });
    await vi.waitFor(() => {
      expect(bob.service.getUIState().pendingFriendRequests).toHaveLength(1);
    });
    await bob.service.handleCommand({
      type: "respondFriendRequest",
      requestId: bob.service.getUIState().pendingFriendRequests[0]!.id,
      accept: true,
    });
    await vi.waitFor(() => {
      expect(charlie.service.getUIState().friends).toHaveLength(1);
    });
    await charlie.service.handleCommand({ type: "leaveRoom" });
    await bob.service.handleCommand({ type: "leaveRoom" });

    // Alice hosts, Bob joins Alice, Charlie (Bob's friend, NOT Alice's) joins via Bob's referral
    const prevBobPort = tcMap.get(tcB);
    await alice.service.createRoom({ displayName: "Alice" });
    await bob.service.joinByUrl(alice.service.getUIState().room!.inviteUrl!, {
      displayName: "Bob",
    });
    await vi.waitFor(() => {
      expect(alice.service.getUIState().room?.members).toHaveLength(2);
      expect(tcMap.get(tcB)).toBeDefined();
      expect(tcMap.get(tcB)).not.toBe(prevBobPort);
    });

    await charlie.service.handleCommand({
      type: "joinFriend",
      pubKeyB64: bobPeerId,
    });
    await vi.waitFor(() => {
      expect(alice.service.getUIState().room?.members).toHaveLength(3);
    });

    // 3-person host migration: Alice promotes Bob -> Charlie follows HOST_MIGRATED -> Alice becomes guest (no auto-reclaim)
    await alice.service.handleCommand({
      type: "moderateMember",
      targetPeerId: bobPeerId,
      action: "promote-host",
    });
    await vi.waitFor(() => {
      expect(bob.service.getUIState().room?.isHost).toBe(true);
      expect(bob.service.getUIState().room?.members).toHaveLength(3);
      expect(alice.service.getUIState().room?.isHost).toBe(false);
      expect(charlie.service.getUIState().room?.isHost).toBe(false);
    });
  });
});
