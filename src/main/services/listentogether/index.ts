import crypto from "node:crypto";
import path from "node:path";
import { app, ipcMain, shell, webContents, type IpcMain } from "electron";
import log from "electron-log";
import { ClockSync } from "~shared/listentogether/clock";
import { DriftController } from "~shared/listentogether/drift";
import {
  LISTEN_TOGETHER_IPC,
  type FavoriteRoomEntry,
  type ListenTogetherActionResult,
  type ListenTogetherActiveRoomUIState,
  type ListenTogetherCommand,
  type ListenTogetherEndedUIState,
  type ListenTogetherLanRoomUI,
  type ListenTogetherPendingInviteUI,
  type ListenTogetherSyncStatus,
  type ListenTogetherUIState,
} from "~shared/listentogether/ipc";
import {
  redactInviteUrl,
  redactLogUrl,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import {
  computeSkipVotesRequired,
  decodeAppMessage,
  encodeInviteUrl,
  isAllowedSignalingUrl,
  normalizePasscode,
  parseInviteUrl,
  QueueTrackMetaSchema,
  type AppMessage,
  type InviteEnvelope,
  type PlaybackAnchor,
  type QueueTrack,
  type QueueTrackMeta,
  type Role,
  type RoomMember,
  type RoomSettings,
} from "~shared/listentogether/protocol";
import {
  AD_STUCK_TIMEOUT_MS,
  buildPlaybackAnchor,
  createRoomState,
  LOADING_BARRIER_TIMEOUT_MS,
  projectLivePosSec,
  reduceRoomEvent,
  type RoomEffect,
  type RoomEvent,
  type RoomState,
} from "~shared/listentogether/room-fsm";
import {
  materializeQueue,
  peekAutoplayNext,
} from "~shared/listentogether/scheduler";
import { Value } from "@sinclair/typebox/value";
import { PlayerSignal, VideoState } from "~shared/playerstatestore/types";
import type { PlayerState } from "~shared/playerstatestore/types";
import type { MemoryStoreSchema } from "~shared/store/schema";
import { YTMViewStatus, type DependencyConstructor } from "~shared/types";
import ConfigStore from "../configstore";
import MemoryStore from "../memorystore";
import PlayerStateStore from "../playerstatestore";
import ProtectedAPIManager, { type ProtectedAPI } from "../protectedapimanager";
import ProtocolManager from "../protocolmanager";
import Service, { EventEmitterService } from "../service";
import { ServiceHost } from "../servicehost";
import AppWindowManager from "../windowmanager";
import YTMViewManager from "../ytmviewmanager";
import PlaybackArbiter, { type HostTransportCommand } from "./arbiter";
import {
  createGuestHandshake,
  createHostHandshake,
  decryptFrame,
  derivePasscodeLookup,
  encryptFrame,
  generateEd25519Keypair,
  generatePasscode,
  HandshakeError,
  HostAuthGuard,
  signInviteEnvelope,
  verifyInviteEnvelope,
  type ClientAuth,
  type ClientHello,
  type Ed25519Keypair,
  type HostHello,
  type LinkSession,
  type ServerAuth,
} from "./crypto";
import {
  DirectWsBrowser,
  DirectWsHost,
  DirectWsTransport,
  type DirectWebSocketFactory,
  type DirectWsBrowserOptions,
  type DirectWsHostOptions,
} from "./transport/direct-ws";
import {
  RelayHostClient,
  RelayWsTransport,
  resolveTailcatBinary,
  TailcatHostSidecar,
  TailcatWsTransport,
  TransportManager,
  type DiscoveredLanRoom,
  type RelayHostClientOptions,
  type RelayWsTransportOptions,
  type TailcatHostSidecarOptions,
  type TailcatWsTransportOptions,
  type TransportConnection,
  type TransportMode,
} from "./transport";

const MAX_ROOM_MEMBERS = 8;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_HANDSHAKE_JSON_BYTES = 16 * 1024;
const CLOCK_BURST_COUNT = 5;
const CLOCK_BURST_INTERVAL_MS = 200;
const CLOCK_STEADY_INTERVAL_MS = 5_000;
const HOST_GRACE_WINDOW_MS = 20_000;
const HOST_DURATION_TICK_MS = 1_000;
const CLICKED_CANDIDATE_TTL_MS = 10_000;
const NOTICE_BANNER_TTL_MS = 4_000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type ListenTogetherServiceEventMap = {
  "state-changed": [ListenTogetherUIState];
  "panel-toggled": [boolean];
};

export interface ListenTogetherServiceDeps {
  configStore?: ConfigStore;
  memoryStore?: MemoryStore<MemoryStoreSchema>;
  ytmViewManager?: YTMViewManager;
  playerStateStore?: PlayerStateStore;
  protectedApiManager?: ProtectedAPIManager;
  protocolManager?: ProtocolManager;
  windowManager?: AppWindowManager;
  ipcMain?: Pick<IpcMain, "handle" | "on">;
  logger?: ListenTogetherLogger;
  nowMs?: () => number;
  directHostOptions?: DirectWsHostOptions;
  directBrowserOptions?: DirectWsBrowserOptions;
  createDirectBrowser?: (
    options: DirectWsBrowserOptions,
  ) => Pick<DirectWsBrowser, "onRoomsChanged" | "start" | "stop">;
  createDirectWebSocket?: DirectWebSocketFactory;
  createRelayHostClient?: (options: RelayHostClientOptions) => RelayHostClient;
  createRelayTransport?: (options: RelayWsTransportOptions) => RelayWsTransport;
  createTailcatHost?: (
    options: TailcatHostSidecarOptions,
  ) => Pick<TailcatHostSidecar, "start" | "stop">;
  createTailcatTransport?: (
    options: TailcatWsTransportOptions,
  ) => TailcatWsTransport;
  resolveTailcatBinaryFn?: () => string | null;
  relayHostClientOptions?: Partial<
    Pick<
      RelayHostClientOptions,
      | "allowPrivateLiteral"
      | "lookupFn"
      | "createWebSocket"
      | "timeoutMs"
      | "heartbeatIntervalMs"
      | "rejectUnauthorized"
    >
  >;
  relayTransportOptions?: Partial<
    Pick<
      RelayWsTransportOptions,
      | "allowPrivateLiteral"
      | "lookupFn"
      | "createWebSocket"
      | "timeoutMs"
      | "heartbeatIntervalMs"
      | "rejectUnauthorized"
    >
  >;
}

type AuthenticatedHostPeer = {
  peerId: string;
  conn: TransportConnection;
  session: LinkSession;
  relayClient: RelayHostClient | null;
  unsubMessage: () => void;
  unsubClose: () => void;
  unsubError: () => void;
};

type GuestAuthResult = {
  session: LinkSession;
  earlyFrames: Buffer[];
};

type ActiveGuestJoinParams =
  | {
      kind: "url";
      rawUrl: string;
      envelope: InviteEnvelope;
    }
  | {
      kind: "passcode";
      code: string;
      lookupId: string;
      passcodeAuthKey: Buffer;
      lanEndpoint?: string;
    };

const SENSITIVE_LOG_KEY_RE =
  /passcode|roomcode|token|secret|password|privatekey|secretkey|keypair|authkey|lookupid|clientslug|authorization|cookie|sigurl|signalingurl|derpmapurl|inviteurl/i;

function sanitizeLogValue(val: unknown, depth = 0): unknown {
  if (depth > 4) return "[REDACTED]";
  if (typeof val === "string") {
    return redactInviteUrl(redactLogUrl(val));
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (val && typeof val === "object" && !(val instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = SENSITIVE_LOG_KEY_RE.test(k)
        ? "[REDACTED]"
        : sanitizeLogValue(v, depth + 1);
    }
    return out;
  }
  return val;
}

function createServiceLogger(): ListenTogetherLogger {
  return {
    debug: (message, context) => {
      const safeMsg = redactInviteUrl(redactLogUrl(message));
      if (context) log.debug(`[ListenTogether] ${safeMsg}`, sanitizeLogValue(context));
      else log.debug(`[ListenTogether] ${safeMsg}`);
    },
    info: (message, context) => {
      const safeMsg = redactInviteUrl(redactLogUrl(message));
      if (context) log.info(`[ListenTogether] ${safeMsg}`, sanitizeLogValue(context));
      else log.info(`[ListenTogether] ${safeMsg}`);
    },
    warn: (message, context) => {
      const safeMsg = redactInviteUrl(redactLogUrl(message));
      if (context) log.warn(`[ListenTogether] ${safeMsg}`, sanitizeLogValue(context));
      else log.warn(`[ListenTogether] ${safeMsg}`);
    },
    error: (message, context) => {
      const safeMsg = redactInviteUrl(redactLogUrl(message));
      if (context) log.error(`[ListenTogether] ${safeMsg}`, sanitizeLogValue(context));
      else log.error(`[ListenTogether] ${safeMsg}`);
    },
  };
}

function sanitizeDisplayName(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().slice(0, 32);
  return trimmed.length > 0 ? trimmed : "Friend";
}

function extractRelayHost(sigUrl: string | undefined | null): string | null {
  if (!sigUrl) return null;
  try {
    return new URL(sigUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function extractVideoIdFromInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === "ytmd:" && host === "play") {
      const seg = parsed.pathname.split("/").filter(Boolean)[0];
      return seg && VIDEO_ID_RE.test(seg) ? seg : null;
    }
    if (host === "youtu.be") {
      const seg = parsed.pathname.split("/").filter(Boolean)[0];
      return seg && VIDEO_ID_RE.test(seg) ? seg : null;
    }
    if (
      host === "music.youtube.com" ||
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com"
    ) {
      const v = parsed.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
    }
  } catch {
    return null;
  }
  return null;
}

function mapActionRejectedMessage(
  reason: "RATE_LIMITED" | "MAX_QUEUE_REACHED" | "NOT_DJ" | "INVALID_TRACK",
  rateLimitPreset: "off" | "strict",
  retryAfterMs?: number,
): { reasonText: string; remainingSec: number; notice: string } {
  if (reason === "RATE_LIMITED") {
    const sec = Math.max(1, Math.ceil((retryAfterMs ?? 30_000) / 1000));
    return {
      reasonText: `Wait ${sec}s`,
      remainingSec: sec,
      notice: `Wait ${sec}s before adding another song`,
    };
  }
  if (reason === "MAX_QUEUE_REACHED") {
    const text =
      rateLimitPreset === "strict"
        ? "Limit reached (3/3)"
        : "Queue limit reached";
    return {
      reasonText: text,
      remainingSec: 0,
      notice: text,
    };
  }
  if (reason === "NOT_DJ") {
    return {
      reasonText: "Listeners can't add songs",
      remainingSec: 0,
      notice: "Only Host and DJs can add songs",
    };
  }
  return {
    reasonText: "Track unavailable",
    remainingSec: 0,
    notice: "This track isn't available or is a live stream",
  };
}

/**
 * Main-process orchestrator for Listen Together rooms, cryptography, transports,
 * clock sync, drift correction, Rule 0 ad handling, and renderer IPC.
 */
export default class ListenTogetherService extends EventEmitterService<ListenTogetherServiceEventMap> {
  public static override readonly dependencies: DependencyConstructor<Service>[] =
    [
      ConfigStore,
      MemoryStore<MemoryStoreSchema>,
      YTMViewManager,
      PlayerStateStore,
      ProtectedAPIManager,
      ProtocolManager,
      AppWindowManager,
    ];

  private logger: ListenTogetherLogger = createServiceLogger();
  private injectedDeps: ListenTogetherServiceDeps = {};

  private configStore!: ConfigStore;
  private memoryStore!: MemoryStore<MemoryStoreSchema>;
  private ytmViewManager!: YTMViewManager;
  private playerStateStore!: PlayerStateStore;
  private protectedApiManager!: ProtectedAPIManager;
  private protocolManager!: ProtocolManager;
  private windowManager!: AppWindowManager;
  private listenTogetherApi!: ProtectedAPI;
  private arbiter!: PlaybackArbiter;
  private nowMs: () => number = () => performance.now();

  private authorizedSenderIds = new Set<number>();
  private initialized = false;
  private terminated = false;

  // UI state
  private panelOpen = false;
  private clientSlug = "";
  private displayName = "";
  private persistentRoomEnabled = false;
  private persistentRoomName = "";
  private favoriteRooms: FavoriteRoomEntry[] = [];
  private recentRooms: FavoriteRoomEntry[] = [];
  private signalingUrl: string | null = null;
  private trustedSignalingHosts: string[] = [];
  private lanDiscoveryEnabled = false;
  private tailcatDerpMapUrl: string | null = null;
  private lanRooms: ListenTogetherLanRoomUI[] = [];
  private rawDiscoveredLanRooms: DiscoveredLanRoom[] = [];
  private pendingInvite: ListenTogetherPendingInviteUI | null = null;
  private connectingStage: string | null = null;
  private errorBanner: string | null = null;
  private errorDetail: string | null = null;
  private endedState: ListenTogetherEndedUIState | null = null;
  private audioBlocked = false;
  private minorityUnavailable = false;
  private degradedSync = false;
  private clickedCandidate: QueueTrackMeta | null = null;
  private clickedCandidateTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeBanner: string | null = null;
  private noticeBannerTimer: ReturnType<typeof setTimeout> | null = null;
  private rateLimitRemainingSec = 0;
  private rateLimitReason: string | null = null;
  private rateLimitTimer: ReturnType<typeof setInterval> | null = null;
  private rateLimitClearTimer: ReturnType<typeof setTimeout> | null = null;

  // Discovery
  private lanBrowser: Pick<
    DirectWsBrowser,
    "onRoomsChanged" | "start" | "stop"
  > | null = null;

  // Shared active session state
  private sessionMode: "none" | "host" | "guest" = "none";
  private listeningMode: "room" | "local" = "room";
  private localTrack: QueueTrackMeta | null = null;
  private localPlaylist: {
    playlistId: string;
    title: string;
    trackCount?: number;
  } | null = null;
  private localInAd = false;
  private lastAppliedSeq: number | null = null;
  private pendingPlayTimer: ReturnType<typeof setTimeout> | null = null;
  private adPostRollReloadedSeqs = new Set<number>();
  private lastAppliedSessionLock: {
    locked: boolean;
    isHost: boolean;
    canAddSongs: boolean;
    videoId: string | null;
    listeningMode: "room" | "local";
  } | null = null;

  // Host state
  private hostKeypair: Ed25519Keypair | null = null;
  private roomOwnerPubKey: string | null = null;
  private pendingMigrationResolve: ((inviteUrl: string | null) => void) | null = null;
  private roomState: RoomState | null = null;
  private roomSalt: Buffer | null = null;
  private roomInviteToken: Buffer | null = null;
  private roomTokenEpoch = 1;
  private roomPasscode: string | null = null;
  private roomShortCode: string | null = null;
  private roomShortInviteUrl: string | null = null;
  private roomLookupId: string | null = null;
  private roomPasscodeAuthKey: Buffer | null = null;
  private roomDirectEndpoints: string[] = [];
  private roomInviteUrl: string | null = null;
  private authGuard: HostAuthGuard | null = null;
  private directWsHost: DirectWsHost | null = null;
  private tailcatHostSidecar: Pick<
    TailcatHostSidecar,
    "start" | "stop"
  > | null = null;
  private roomTailcatAddress: string | null = null;
  private roomTailcatRemotePort: number | null = null;
  private relayClients = new Set<RelayHostClient>();
  private primaryRelayConnected = false;
  private hostRelayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hostRelayReconnectAttempts = 0;
  private hostPeers = new Map<string, AuthenticatedHostPeer>();
  private loadingBarrierTimer: ReturnType<typeof setTimeout> | null = null;
  private adStuckTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hostDurationTickTimer: ReturnType<typeof setInterval> | null = null;
  private roomHistoryTracks: QueueTrack[] = [];
  private lastDjVideoId: string | null = null;
  private autoplayFetchInFlightKey: string | null = null;
  private dismissedAutoplayVideoIds = new Set<string>();

  // Guest state
  private guestKeypair: Ed25519Keypair | null = null;
  private guestJoinAbort: AbortController | null = null;
  private lastGuestJoinParams: ActiveGuestJoinParams | null = null;
  private guestConn: TransportConnection | null = null;
  private guestSession: LinkSession | null = null;
  private guestTransportMode: TransportMode = "direct";
  private guestEpoch: number | null = null;
  private guestRoomId: string | null = null;
  private guestSettings: RoomSettings | null = null;
  private guestMembers: RoomMember[] = [];
  private guestCurrentTrack: QueueTrack | null = null;
  private guestAnchor: PlaybackAnchor | null = null;
  private guestQueue: QueueTrack[] = [];
  private guestHistory: QueueTrack[] = [];
  private guestSkipVotes: string[] = [];
  private guestAutoplayNext: QueueTrack | null = null;
  private guestLastKnownQueueSnapshot: QueueTrack[] = [];
  private guestClockSync: ClockSync | null = null;
  private guestDriftController: DriftController | null = null;
  private clockBurstTimers: ReturnType<typeof setTimeout>[] = [];
  private clockSteadyTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPings = new Map<string, number>();
  private guestGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private guestGraceCountdownTimer: ReturnType<typeof setInterval> | null =
    null;
  private guestGraceDeadlineMs: number | null = null;
  private guestGraceRemainingMs: number | null = null;
  private guestReconnecting = false;
  private guestReconnectAbort: AbortController | null = null;
  private guestReconnectRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private guestConnUnsubs: Array<() => void> = [];

  public setDependencies(deps: ListenTogetherServiceDeps): this {
    this.injectedDeps = deps;
    if (deps.logger) {
      this.logger = deps.logger;
    }
    if (deps.nowMs) {
      this.nowMs = deps.nowMs;
    }
    return this;
  }

  public override [ServiceHost.INJECT](host: ServiceHost) {
    super[ServiceHost.INJECT](host);
  }

  public override onPreInitialized(): void {}

  public override onInitialized(): void {
    if (this.initialized) {
      throw new Error("ListenTogetherService is already initialized!");
    }
    this.initialized = true;

    this.configStore =
      this.injectedDeps.configStore ?? this.getDependency(ConfigStore);
    this.memoryStore =
      this.injectedDeps.memoryStore ??
      this.getDependency(MemoryStore<MemoryStoreSchema>);
    this.ytmViewManager =
      this.injectedDeps.ytmViewManager ?? this.getDependency(YTMViewManager);
    this.playerStateStore =
      this.injectedDeps.playerStateStore ??
      this.getDependency(PlayerStateStore);
    this.protectedApiManager =
      this.injectedDeps.protectedApiManager ??
      this.getDependency(ProtectedAPIManager);
    this.protocolManager =
      this.injectedDeps.protocolManager ?? this.getDependency(ProtocolManager);
    this.windowManager =
      this.injectedDeps.windowManager ?? this.getDependency(AppWindowManager);

    this.loadConfigState();
    this.configStore.onDidChange("listenTogether", () => {
      this.loadConfigState();
      this.emitStateChanged();
    });

    this.arbiter = new PlaybackArbiter({
      logger: this.logger,
      onHostTransport: (command, ...args) =>
        this.handleArbiterHostTransport(command, ...args),
      onGuestBlockedCommand: () => {
        if (this.sessionMode === "guest") {
          this.showTransientNotice("Playback is controlled by the Host");
        }
      },
      onHostBlockedCommand: () => {
        if (this.sessionMode === "host") {
          this.showTransientNotice(
            "Only Play, Pause, Skip, and Seek are shared",
          );
        }
      },
    });
    this.arbiter.attach(this.protectedApiManager);

    this.protocolManager.setPlaybackArbiter(this.arbiter);
    this.protocolManager.setListenInviteHandler((rawUrl) => {
      this.handleIncomingInviteUrl(rawUrl);
    });

    this.listenTogetherApi =
      this.protectedApiManager.createOrGetAPI("ListenTogether");
    this.bindProtectedApiListeners();
    this.bindPlayerStateListeners();
    this.bindYtmViewListeners();
    this.bindIpcHandlers();

    this.logger.info?.("ListenTogetherService initialized");
  }

  public override onPostInitialized(): void {
    if (this.lanDiscoveryEnabled) {
      this.startLanDiscovery();
    }
  }

  public override onTerminated(): void {
    this.terminated = true;
    this.stopLanDiscovery();
    void this.teardownActiveSession({ sendRoomEnded: true, unlockView: false });
    this.clearUiTimers();
    this.arbiter?.detach();
    this.protocolManager?.setListenInviteHandler(null);
    this.protocolManager?.setPlaybackArbiter(null);
    this.logger.info?.("ListenTogetherService terminated");
  }

  /**
   * Restricts `listenTogether:*` IPC handlers to the given Main-owned `webContents.id`s.
   */
  public setAuthorizedSenderIds(ids: number[]): void {
    this.authorizedSenderIds = new Set(
      ids.filter((id) => Number.isInteger(id) && id > 0),
    );
    this.logger.debug?.("Updated authorized Listen Together IPC sender IDs", {
      senderIds: [...this.authorizedSenderIds],
    });
  }

  /**
   * Returns Host quit-confirmation metadata for `Main` window close guarding.
   */
  public getHostQuitGuardInfo(): {
    shouldConfirm: boolean;
    guestCount: number;
  } {
    if (this.sessionMode !== "host" || !this.roomState) {
      return { shouldConfirm: false, guestCount: 0 };
    }
    const guestCount = Math.max(
      0,
      Object.keys(this.roomState.members).filter(
        (id) => id !== this.roomState!.hostPeerId,
      ).length,
    );
    return {
      shouldConfirm: guestCount >= 1,
      guestCount,
    };
  }

  /**
   * Returns a snapshot of the full Listen Together UI state for renderer windows.
   */
  public getUIState(): ListenTogetherUIState {
    let view: ListenTogetherUIState["view"] = "lobby";
    if (this.endedState) {
      view = "ended";
    } else if (this.sessionMode !== "none") {
      view = "active";
    } else if (this.connectingStage !== null) {
      view = "connecting";
    } else if (this.pendingInvite !== null) {
      view = "invite-confirm";
    }

    return {
      view,
      panelOpen: this.panelOpen,
      clientSlug: this.clientSlug,
      displayName: this.displayName,
      persistentRoomEnabled: this.persistentRoomEnabled,
      persistentRoomName: this.persistentRoomName,
      favoriteRooms: [...this.favoriteRooms].slice(0, 5),
      recentRooms: [...this.recentRooms].slice(0, 5),
      signalingUrl: this.signalingUrl,
      trustedSignalingHosts: [...this.trustedSignalingHosts],
      lanDiscoveryEnabled: this.lanDiscoveryEnabled,
      tailcatAvailable: this.isTailcatAvailable(),
      tailcatDerpMapUrl: this.tailcatDerpMapUrl,
      logFilePath: this.getLogFilePath(),
      lanRooms: [...this.lanRooms],
      pendingInvite: this.pendingInvite ? { ...this.pendingInvite } : null,
      connectingStage: this.connectingStage,
      errorBanner: this.errorBanner,
      errorDetail: this.errorDetail,
      room: this.buildActiveRoomUIState(),
      ended: this.endedState
        ? {
            ...this.endedState,
            queueSnapshot: [...this.endedState.queueSnapshot],
          }
        : null,
    };
  }

  public setPanelOpen(open: boolean): void {
    const next = Boolean(open);
    if (this.panelOpen === next) return;
    this.panelOpen = next;
    this.emit("panel-toggled", next);
    this.emitStateChanged();
    if (
      next &&
      this.sessionMode === "none" &&
      !this.pendingInvite &&
      !this.connectingStage
    ) {
      const autoFav = this.favoriteRooms.find((r) => r.autoJoin);
      if (autoFav) {
        void this.joinFavoriteRoom(autoFav.id);
      }
    }
  }

  public togglePanel(): void {
    this.setPanelOpen(!this.panelOpen);
  }

  /**
   * Handles a `ytmd://listen/v1/...` deep link by opening the confirmation card.
   */
  public handleIncomingInviteUrl(rawUrl: string): void {
    const safeUrl = redactInviteUrl(redactLogUrl(rawUrl));
    const envelope = parseInviteUrl(rawUrl, this.logger);
    if (!envelope) {
      this.logger.warn?.("Rejected incoming invite URL: parse failed", {
        url: safeUrl,
      });
      if (this.sessionMode === "none") {
        this.endedState = null;
        this.pendingInvite = null;
      }
      this.errorBanner = "Invalid invite link";
      this.errorDetail =
        "The link is malformed or corrupted. Ask the host for a fresh invite link.";
      this.setPanelOpen(true);
      this.emitStateChanged();
      return;
    }

    if (!verifyInviteEnvelope(envelope, { logger: this.logger })) {
      this.logger.warn?.("Rejected incoming invite URL: verification failed", {
        roomId: envelope.r,
        url: safeUrl,
      });
      if (this.sessionMode === "none") {
        this.endedState = null;
        this.pendingInvite = null;
      }
      this.errorBanner = "Invite link expired or invalid";
      this.errorDetail =
        "Ask the host to share a fresh Listen Together invite link.";
      this.setPanelOpen(true);
      this.emitStateChanged();
      return;
    }

    const relayHost = extractRelayHost(envelope.sig);
    const relayTrusted =
      relayHost === null || this.trustedSignalingHosts.includes(relayHost);

    if (this.sessionMode === "none") {
      this.endedState = null;
    }
    this.pendingInvite = {
      rawUrl,
      envelope,
      relayHost,
      relayTrusted,
    };
    this.errorBanner = null;
    this.errorDetail = null;
    this.panelOpen = true;
    this.emit("panel-toggled", true);
    this.emitStateChanged();

    if (this.windowManager.hasWindow("Main")) {
      this.windowManager.getWindow("Main").showAndFocus();
    }
    this.logger.info?.("Prepared invite confirmation card", {
      roomId: envelope.r,
      url: redactInviteUrl(rawUrl),
      hasRelay: Boolean(envelope.sig),
      directCount: envelope.ep?.length ?? 0,
    });
  }

  /**
   * Creates and hosts a new Listen Together room.
   */
  public async createRoom(options: {
    displayName: string;
    initialQueue?: QueueTrack[];
    initialPositionSec?: number;
    initialSettings?: RoomSettings;
    ownerPubKey?: string;
  }): Promise<ListenTogetherActionResult> {
    const cleanName = sanitizeDisplayName(
      options.displayName || this.displayName,
    );
    this.saveDisplayName(cleanName);

    await this.teardownActiveSession({
      sendRoomEnded: true,
      unlockView: false,
    });
    this.endedState = null;
    this.pendingInvite = null;
    this.errorBanner = null;
    this.errorDetail = null;
    this.connectingStage = "Creating room…";
    this.emitStateChanged();
    this.logger.info?.("Creating Listen Together room", {
      initialQueueCount: options.initialQueue?.length ?? 0,
      hasSignalingUrl: Boolean(this.signalingUrl),
    });

    try {
      const { hostKeypair, roomId } = this.resolveRoomIdentity();
      const roomSalt = crypto.randomBytes(16);
      const roomInviteToken = crypto.randomBytes(16);
      const tokenEpoch = 1;
      const passcode = generatePasscode();
      const { lookupId, passcodeAuthKey } = await derivePasscodeLookup(
        passcode,
        { logger: this.logger },
      );

      const directWsHost = new DirectWsHost({
        logger: this.logger,
        ...this.injectedDeps.directHostOptions,
      });
      let directPort = 0;
      let endpoints: string[] = [];
      try {
        const started = await directWsHost.start({
          lookupId,
          label: cleanName,
          host: this.lanDiscoveryEnabled ? "0.0.0.0" : "127.0.0.1",
          announceMdns: this.lanDiscoveryEnabled,
        });
        directPort = started.port;
        endpoints = started.endpoints;
      } catch (err) {
        this.logger.warn?.("DirectWsHost failed to bind; continuing", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      let tailcatHostSidecar: Pick<TailcatHostSidecar, "start" | "stop"> | null =
        null;
      let tailcatAddress: string | null = null;
      let tailcatRemotePort: number | null = null;
      if (
        directPort > 0 &&
        (this.injectedDeps.createTailcatHost || this.isTailcatAvailable())
      ) {
        try {
          const sidecarOpts: TailcatHostSidecarOptions = {
            logger: this.logger,
          };
          tailcatHostSidecar = this.injectedDeps.createTailcatHost
            ? this.injectedDeps.createTailcatHost(sidecarOpts)
            : new TailcatHostSidecar(sidecarOpts);
          const startedTc = await tailcatHostSidecar.start({
            localPort: directPort,
            derpMapUrl: this.tailcatDerpMapUrl,
            stateDir: this.getPersistentTailcatStateDir(),
            timeoutMs: 8_000,
          });
          tailcatAddress = startedTc.tcAddress;
          tailcatRemotePort = startedTc.remotePort;
        } catch (err) {
          this.logger.warn?.(
            "TailcatHostSidecar failed to start; continuing without Tailcat",
            {
              error: redactInviteUrl(
                redactLogUrl(err instanceof Error ? err.message : String(err)),
              ),
            },
          );
          if (tailcatHostSidecar) {
            await tailcatHostSidecar.stop().catch(() => {});
            tailcatHostSidecar = null;
          }
        }
      }

      this.sessionMode = "host";
      this.hostKeypair = hostKeypair;
      this.roomOwnerPubKey = options.ownerPubKey ?? hostKeypair.publicKeyB64;
      this.roomSalt = roomSalt;
      this.roomInviteToken = roomInviteToken;
      this.roomTokenEpoch = tokenEpoch;
      this.roomPasscode = passcode;
      this.roomLookupId = lookupId;
      this.roomPasscodeAuthKey = passcodeAuthKey;
      this.roomDirectEndpoints = endpoints;
      this.authGuard = new HostAuthGuard({ logger: this.logger });
      this.directWsHost = directWsHost;
      this.tailcatHostSidecar = tailcatHostSidecar;
      this.roomTailcatAddress = tailcatAddress;
      this.roomTailcatRemotePort = tailcatRemotePort;
      this.roomHistoryTracks = [];
      this.lastDjVideoId = null;
      this.autoplayFetchInFlightKey = null;
      this.dismissedAutoplayVideoIds.clear();
      this.listeningMode = "room";
      this.localTrack = null;
      this.localPlaylist = null;
      this.localInAd = false;
      this.lastAppliedSeq = null;
      this.adPostRollReloadedSeqs.clear();

      directWsHost.onConnection((conn) => {
        this.handleHostIncomingConnection(conn, null);
      });

      const initialQueue =
        options.initialQueue ??
        (this.persistentRoomEnabled
          ? this.loadPersistentQueue(roomId)
          : undefined);

      this.roomState = createRoomState({
        roomId,
        hostPeerId: hostKeypair.publicKeyB64,
        hostDisplayName: cleanName,
        settings: options.initialSettings,
        initialQueue,
        nowMs: this.nowMs(),
        logger: this.logger,
      });

      await this.connectHostRelays(lookupId, roomId);
      this.rebuildHostInviteUrl();
      this.recordRecentRoom();

      this.connectingStage = null;
      this.arbiter.setSessionState({
        active: true,
        isHost: true,
        listeningMode: "room",
      });
      await this.applySessionLockToView(
        true,
        true,
        this.roomState.currentTrack?.videoId ?? null,
        "room",
      );

      this.startHostDurationTicker();

      if (
        (options.initialQueue && options.initialQueue.length > 0) ||
        (initialQueue && initialQueue.length > 0)
      ) {
        this.dispatchRoomEvent({
          type: "HOST_TRANSPORT",
          actorId: hostKeypair.publicKeyB64,
          action: "play",
        });
        if (
          typeof options.initialPositionSec === "number" &&
          options.initialPositionSec > 0
        ) {
          this.dispatchRoomEvent({
            type: "HOST_TRANSPORT",
            actorId: hostKeypair.publicKeyB64,
            action: "seek",
            seekPosSec: options.initialPositionSec,
          });
        }
      }

      this.emitStateChanged();
      this.logger.info?.("Created Listen Together room", {
        roomId,
        directEndpointCount: endpoints.length,
        relayConnected: this.primaryRelayConnected,
      });
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create room";
      this.logger.error?.("Failed to create Listen Together room", {
        error: redactInviteUrl(redactLogUrl(message)),
      });
      await this.teardownActiveSession({
        sendRoomEnded: false,
        unlockView: true,
      });
      this.connectingStage = null;
      this.errorBanner = "Couldn't create room";
      this.errorDetail = message;
      this.emitStateChanged();
      return { ok: false, error: message };
    }
  }

  /**
   * Regenerates the room passcode and invite token (`tokenEpoch += 1`) without dropping active peers.
   */
  public async resetInviteLinkAndCode(): Promise<ListenTogetherActionResult> {
    if (this.sessionMode !== "host" || !this.roomState || !this.hostKeypair) {
      this.logger.warn?.(
        "Rejected resetInviteLinkAndCode: caller is not an active Host",
        { sessionMode: this.sessionMode },
      );
      return { ok: false, error: "Only the Host can reset the invite link" };
    }

    const passcode = generatePasscode();
    const { lookupId, passcodeAuthKey } = await derivePasscodeLookup(
      passcode,
      { logger: this.logger },
    );

    this.roomTokenEpoch += 1;
    this.roomPasscode = passcode;
    this.roomLookupId = lookupId;
    this.roomPasscodeAuthKey = passcodeAuthKey;
    this.roomInviteToken = crypto.randomBytes(16);
    this.authGuard?.resetPasscodeLockout();

    const hostName =
      this.roomState.members[this.roomState.hostPeerId]?.displayName ??
      this.displayName;
    this.directWsHost?.updateAnnouncement({ lookupId, label: hostName });

    if (this.signalingUrl) {
      void this.registerRelayLookupClient(lookupId, "create");
    }

    this.rebuildHostInviteUrl();
    this.logger.info?.("Reset Listen Together invite link and room code", {
      roomId: this.roomState.roomId,
      tokenEpoch: this.roomTokenEpoch,
      peerCount: this.hostPeers.size,
      url: this.roomInviteUrl ? redactInviteUrl(this.roomInviteUrl) : null,
    });
    this.emitStateChanged();
    this.showTransientNotice("Created a new invite link and room code");
    return { ok: true };
  }

  /**
   * Joins a room via `ytmd://listen/v1/...` invite URL using `TransportManager` connection racing.
   */
  public async joinByUrl(
    rawUrl: string,
    opts: { displayName?: string; trustRelayHost?: boolean } = {},
  ): Promise<ListenTogetherActionResult> {
    let resolvedUrl = rawUrl.trim();
    const shortCode = this.extractShortCodeFromInput(resolvedUrl);
    if (shortCode) {
      const unwrapped = await this.resolveShortInviteFromRelay(shortCode);
      if (unwrapped) {
        resolvedUrl = unwrapped;
      } else {
        return this.joinByPasscode(shortCode, {
          displayName: opts.displayName,
        });
      }
    }

    const safeUrl = redactInviteUrl(redactLogUrl(resolvedUrl));
    const envelope = parseInviteUrl(resolvedUrl, this.logger);
    if (!envelope || !verifyInviteEnvelope(envelope, { logger: this.logger })) {
      this.logger.warn?.("Rejected joinByUrl: invalid or expired invite link", {
        url: safeUrl,
      });
      this.pendingInvite = null;
      this.errorBanner = "Invite link expired or invalid";
      this.errorDetail =
        "Ask the host to share a fresh Listen Together invite link.";
      this.emitStateChanged();
      return { ok: false, error: "Invalid or expired invite link" };
    }

    const cleanName = sanitizeDisplayName(opts.displayName ?? this.displayName);
    this.saveDisplayName(cleanName);

    const relayHost = extractRelayHost(envelope.sig);
    if (opts.trustRelayHost && relayHost && envelope.sig) {
      this.trustSignalingHost(relayHost);
      if (!this.signalingUrl) {
        this.saveSignalingUrl(envelope.sig);
      }
    }

    this.logger.info?.("Joining Listen Together room by invite URL", {
      roomId: envelope.r,
      url: safeUrl,
      hasRelay: Boolean(envelope.sig),
      directCount: envelope.ep?.length ?? 0,
      trustRelayHost: Boolean(opts.trustRelayHost),
    });

    return this.executeGuestJoin(
      {
        kind: "url",
        rawUrl: resolvedUrl,
        envelope,
      },
      cleanName,
    );
  }

  /**
   * Joins a room via an 8-character Crockford Base32 passcode (`XXXX-XXXX`).
   */
  public async joinByPasscode(
    code: string,
    opts: { displayName?: string; lanEndpoint?: string } = {},
  ): Promise<ListenTogetherActionResult> {
    const normalized = normalizePasscode(code, this.logger);
    if (!normalized) {
      this.logger.warn?.("Rejected joinByPasscode: invalid room code format");
      this.errorBanner = "Invalid room code";
      this.errorDetail = "Enter the 8-character code shown by the host.";
      this.emitStateChanged();
      return { ok: false, error: "Invalid room code" };
    }

    const cleanName = sanitizeDisplayName(opts.displayName ?? this.displayName);
    this.saveDisplayName(cleanName);

    this.endedState = null;
    this.pendingInvite = null;
    this.errorBanner = null;
    this.errorDetail = null;
    this.connectingStage = "Checking passcode…";
    this.emitStateChanged();

    let lookup: { lookupId: string; passcodeAuthKey: Buffer };
    try {
      lookup = await derivePasscodeLookup(normalized, { logger: this.logger });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to verify passcode";
      this.logger.warn?.(
        "Rejected joinByPasscode: passcode derivation failed",
        {
          error: msg,
        },
      );
      this.connectingStage = null;
      this.errorBanner = "Invalid room code";
      this.errorDetail = msg;
      this.emitStateChanged();
      return { ok: false, error: msg };
    }

    this.logger.info?.("Joining Listen Together room by passcode", {
      lookupId: lookup.lookupId,
      hasLanEndpoint: Boolean(opts.lanEndpoint),
      hasRelay: Boolean(this.signalingUrl),
    });

    return this.executeGuestJoin(
      {
        kind: "passcode",
        code: normalized,
        lookupId: lookup.lookupId,
        passcodeAuthKey: lookup.passcodeAuthKey,
        lanEndpoint: opts.lanEndpoint,
      },
      cleanName,
    );
  }

  /**
   * Starts a fresh room preloaded with `queueSnapshot` from the `ended` state.
   */
  public async hostNewRoomWithQueue(): Promise<ListenTogetherActionResult> {
    const queueSnapshot = this.endedState?.queueSnapshot ?? [];
    const name = this.displayName || "Host";
    this.logger.info?.(
      "Starting new Listen Together room from ended queue snapshot",
      {
        queueSnapshotCount: queueSnapshot.length,
        previousEndedReason: this.endedState?.reason ?? null,
      },
    );
    await this.leaveRoom();
    return this.createRoom({
      displayName: name,
      initialQueue: queueSnapshot,
    });
  }

  /**
   * Leaves or ends the current room cleanly, releasing player locks and closing transports.
   */
  public async leaveRoom(endForAll = true): Promise<void> {
    this.logger.info?.("Leaving Listen Together room", {
      previousMode: this.sessionMode,
      roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
      endForAll,
    });
    if (!endForAll && this.sessionMode === "host" && this.hostPeers.size > 0) {
      const successor = this.pickMigrationSuccessor();
      if (successor) {
        await this.initiateHostMigration(successor, "host-left", false);
      }
    }
    await this.teardownActiveSession({ sendRoomEnded: true, unlockView: true });
    this.endedState = null;
    this.pendingInvite = null;
    this.connectingStage = null;
    this.errorBanner = null;
    this.errorDetail = null;
    this.emitStateChanged();
  }

  /**
   * Executes a renderer UI command received via `listenTogether:action`.
   */
  public async handleCommand(
    command: ListenTogetherCommand,
  ): Promise<ListenTogetherActionResult> {
    this.logger.debug?.("Handling Listen Together UI command", {
      type: command.type,
    });
    switch (command.type) {
      case "setDisplayName": {
        const clean = command.displayName.trim().slice(0, 32);
        this.saveDisplayName(clean);
        this.emitStateChanged();
        return { ok: true };
      }

      case "setPersistentRoom": {
        this.persistentRoomEnabled = Boolean(command.enabled);
        this.configStore.set(
          "listenTogether.persistentRoomEnabled",
          this.persistentRoomEnabled,
        );
        if (typeof command.roomName === "string") {
          this.persistentRoomName = command.roomName.trim().slice(0, 48);
          this.configStore.set(
            "listenTogether.persistentRoomName",
            this.persistentRoomName,
          );
        }
        this.emitStateChanged();
        return { ok: true };
      }

      case "openAddToPlaylist": {
        const cleanId = extractVideoIdFromInput(command.videoId);
        this.logger.info?.("Handling openAddToPlaylist command", {
          videoId: cleanId,
        });
        if (!cleanId) {
          return { ok: false, error: "Invalid video ID" };
        }
        try {
          await this.ensureProtectedApiPortReady();
          const res = (await this.listenTogetherApi.invokeMessage(
            "openAddToPlaylist",
            { videoId: cleanId },
          )) as [{ ok?: boolean; error?: string }] | undefined;
          const result = Array.isArray(res) ? res[0] : undefined;
          this.logger.info?.("openAddToPlaylist view invocation result", {
            videoId: cleanId,
            result: result ?? null,
          });
          if (!result?.ok) {
            return {
              ok: false,
              error: result?.error ?? "Could not open playlist menu",
            };
          }
          return { ok: true };
        } catch (err) {
          this.logger.warn?.("openAddToPlaylist failed", {
            videoId: cleanId,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to open playlist menu",
          };
        }
      }

      case "dismissAutoplayNext": {
        if (this.sessionMode !== "host" || !this.roomState) {
          this.logger.warn?.("Rejected dismissAutoplayNext: host only", {
            sessionMode: this.sessionMode,
          });
          return { ok: false, error: "Host only" };
        }
        const currentAutoplay = peekAutoplayNext(this.roomState.scheduler);
        const beforeLen = this.roomState.scheduler.autoplayPool.length;
        if (currentAutoplay) {
          this.dismissedAutoplayVideoIds.add(currentAutoplay.videoId);
        }
        this.dispatchRoomEvent({
          type: "AUTOPLAY_DISMISS",
          actorId: this.roomState.hostPeerId,
        });
        const afterLen = this.roomState.scheduler.autoplayPool.length;
        this.logger.info?.("Dismissed autoplay suggestion", {
          dismissedVideoId: currentAutoplay?.videoId ?? null,
          beforePoolLen: beforeLen,
          afterPoolLen: afterLen,
        });
        return { ok: true };
      }

      case "saveFavoriteRoom": {
        return this.saveActiveRoomAsFavorite(command.label, command.autoJoin);
      }

      case "removeFavoriteRoom": {
        this.favoriteRooms = this.favoriteRooms.filter(
          (r) => r.id !== command.id,
        );
        this.saveFavoriteRooms();
        this.emitStateChanged();
        return { ok: true };
      }

      case "toggleFavoriteAutoJoin": {
        this.favoriteRooms = this.favoriteRooms.map((r) =>
          r.id === command.id ? { ...r, autoJoin: Boolean(command.autoJoin) } : r,
        );
        this.saveFavoriteRooms();
        this.emitStateChanged();
        return { ok: true };
      }

      case "joinFavoriteRoom": {
        return this.joinFavoriteRoom(command.id);
      }

      case "setSignalingUrl": {
        return this.updateSignalingUrl(command.signalingUrl);
      }

      case "setLanDiscovery": {
        this.lanDiscoveryEnabled = Boolean(command.enabled);
        this.configStore.set(
          "listenTogether.lanDiscoveryEnabled",
          this.lanDiscoveryEnabled,
        );
        if (this.lanDiscoveryEnabled) {
          this.startLanDiscovery();
        } else {
          this.stopLanDiscovery();
          this.rawDiscoveredLanRooms = [];
          this.lanRooms = [];
        }
        this.emitStateChanged();
        return { ok: true };
      }

      case "setTailcatDerpMapUrl": {
        return this.updateTailcatDerpMapUrl(command.url);
      }

      case "createRoom": {
        return this.createRoom({
          displayName: command.displayName ?? this.displayName,
          initialQueue: command.initialQueue,
        });
      }

      case "joinByUrl": {
        return this.joinByUrl(command.rawUrl, {
          displayName: command.displayName,
          trustRelayHost: command.trustRelayHost,
        });
      }

      case "joinByPasscode": {
        return this.joinByPasscode(command.code, {
          displayName: command.displayName,
          lanEndpoint: command.lanEndpoint,
        });
      }

      case "confirmPendingInvite": {
        if (!this.pendingInvite) {
          return { ok: false, error: "No pending invite" };
        }
        const rawUrl = this.pendingInvite.rawUrl;
        return this.joinByUrl(rawUrl, {
          displayName: command.displayName,
          trustRelayHost: command.trustRelayHost,
        });
      }

      case "cancelPendingInvite": {
        this.pendingInvite = null;
        this.emitStateChanged();
        return { ok: true };
      }

      case "cancelConnecting": {
        this.logger.info?.("Cancelled Listen Together connection attempt");
        this.guestJoinAbort?.abort();
        this.guestJoinAbort = null;
        this.connectingStage = null;
        await this.teardownActiveSession({
          sendRoomEnded: false,
          unlockView: true,
        });
        this.emitStateChanged();
        return { ok: true };
      }

      case "retryConnect": {
        if (!this.lastGuestJoinParams) {
          return { ok: false, error: "Nothing to retry" };
        }
        return this.executeGuestJoin(
          this.lastGuestJoinParams,
          sanitizeDisplayName(this.displayName),
        );
      }

      case "dismissError": {
        this.errorBanner = null;
        this.errorDetail = null;
        this.emitStateChanged();
        return { ok: true };
      }

      case "leaveRoom": {
        await this.leaveRoom(command.endForAll ?? true);
        return { ok: true };
      }

      case "addSongByUrlOrId": {
        return this.addSongByInput(command.input);
      }

      case "acceptClickedCandidate": {
        const candidate = this.clickedCandidate;
        if (!candidate) {
          return { ok: false, error: "No selected candidate" };
        }
        this.clearClickedCandidate();
        return this.enqueueTrackMeta(candidate);
      }

      case "dismissClickedCandidate": {
        this.clearClickedCandidate();
        return { ok: true };
      }

      case "removeTrack": {
        this.handleRemoveTrack(command.entryId);
        return { ok: true };
      }

      case "pinTrackNext": {
        this.handlePinTrackNext(command.entryId);
        return { ok: true };
      }

      case "unpinTrack": {
        this.handleUnpinTrack(command.entryId);
        return { ok: true };
      }

      case "reorderQueue": {
        this.handleReorderQueue(command.entryId, command.targetIndex);
        return { ok: true };
      }

      case "jumpToTrack": {
        this.handleJumpToTrack(command.target, command.entryId);
        return { ok: true };
      }

      case "voteSkip": {
        this.handleVoteSkip();
        return { ok: true };
      }

      case "tuneBackIn": {
        await this.handleTuneBackIn();
        return { ok: true };
      }

      case "tuneOut": {
        await this.handleTuneOut();
        return { ok: true };
      }

      case "addLocalTrackToQueue": {
        return this.handleAddLocalTrackToQueue();
      }

      case "addLocalPlaylistToQueue": {
        return this.handleAddLocalPlaylistToQueue();
      }

      case "hostTransport": {
        this.handleHostTransport(command.action, command.seekPosSec);
        return { ok: true };
      }

      case "forceResumeFromAd": {
        this.handleForceResumeFromAd();
        return { ok: true };
      }

      case "moderateMember": {
        this.handleModerateMember(command.targetPeerId, command.action);
        return { ok: true };
      }

      case "updateRoomSettings": {
        this.handleUpdateSettings(command.settings);
        return { ok: true };
      }

      case "resetInviteLinkAndCode": {
        return this.resetInviteLinkAndCode();
      }

      case "enableAudio": {
        return this.resumeBlockedAudio();
      }

      case "reconnectNow": {
        if (this.sessionMode === "guest") {
          this.triggerGuestReconnectAttempt();
          return { ok: true };
        }
        if (
          this.sessionMode === "host" &&
          this.roomLookupId &&
          this.roomState
        ) {
          void this.connectHostRelays(
            this.roomLookupId,
            this.roomState.roomId,
            true,
          );
          return { ok: true };
        }
        return { ok: false, error: "Not in a room" };
      }

      case "dismissNotice": {
        this.clearNoticeBanner();
        return { ok: true };
      }

      case "hostNewRoomWithQueue": {
        return this.hostNewRoomWithQueue();
      }

      case "returnToLobby": {
        await this.leaveRoom();
        return { ok: true };
      }

      case "openLogFile": {
        return this.openLogFile();
      }
    }
  }

  private loadConfigState(): void {
    const cfg = this.configStore.get("listenTogether") as
      | {
          clientSlug?: string;
          displayName?: string;
          persistentRoomEnabled?: boolean;
          favoriteRooms?: FavoriteRoomEntry[];
          signalingUrl?: string | null;
          trustedSignalingHosts?: string[];
          tailcatDerpMapUrl?: string | null;
        }
      | undefined;
    const rawSlug =
      cfg?.clientSlug ??
      (this.configStore.get("listenTogether.clientSlug") as string | undefined);
    if (
      typeof rawSlug === "string" &&
      /^[a-z0-9_-]{6,64}$/i.test(rawSlug.trim())
    ) {
      this.clientSlug = rawSlug.trim();
    } else if (!this.clientSlug) {
      this.clientSlug = `usr_${crypto.randomBytes(6).toString("hex")}`;
      this.configStore.set("listenTogether.clientSlug", this.clientSlug);
    }
    this.displayName =
      typeof cfg?.displayName === "string" ? cfg.displayName : "";
    const rawPersistent =
      cfg?.persistentRoomEnabled ??
      this.configStore.get("listenTogether.persistentRoomEnabled");
    this.persistentRoomEnabled = Boolean(rawPersistent);
    const rawPersistentName =
      (cfg as { persistentRoomName?: unknown } | undefined)?.persistentRoomName ??
      this.configStore.get("listenTogether.persistentRoomName");
    this.persistentRoomName =
      typeof rawPersistentName === "string"
        ? rawPersistentName.trim().slice(0, 48)
        : "";
    const rawFavorites =
      cfg?.favoriteRooms ??
      this.configStore.get("listenTogether.favoriteRooms");
    this.favoriteRooms = Array.isArray(rawFavorites)
      ? rawFavorites.filter(
          (r): r is FavoriteRoomEntry =>
            Boolean(r && typeof r.id === "string" && typeof r.hostPubKeyB64 === "string"),
        )
      : [];
    const rawRecents =
      (cfg as { recentRooms?: unknown } | undefined)?.recentRooms ??
      this.configStore.get("listenTogether.recentRooms");
    this.recentRooms = Array.isArray(rawRecents)
      ? rawRecents
          .filter(
            (r): r is FavoriteRoomEntry =>
              Boolean(
                r &&
                  typeof r.id === "string" &&
                  typeof r.hostPubKeyB64 === "string",
              ),
          )
          .slice(0, 5)
      : [];
    this.signalingUrl =
      typeof cfg?.signalingUrl === "string" && cfg.signalingUrl.trim()
        ? cfg.signalingUrl
        : null;
    this.trustedSignalingHosts = Array.isArray(cfg?.trustedSignalingHosts)
      ? cfg.trustedSignalingHosts
      : [];
    const rawLan =
      (cfg as { lanDiscoveryEnabled?: unknown } | undefined)?.lanDiscoveryEnabled ??
      this.configStore.get("listenTogether.lanDiscoveryEnabled");
    this.lanDiscoveryEnabled = Boolean(rawLan);
    this.tailcatDerpMapUrl =
      typeof cfg?.tailcatDerpMapUrl === "string" && cfg.tailcatDerpMapUrl.trim()
        ? cfg.tailcatDerpMapUrl
        : null;
  }

  private getPersistentTailcatStateDir(): string | null {
    if (!this.persistentRoomEnabled) return null;
    try {
      const userData = app?.getPath?.("userData");
      if (typeof userData === "string" && userData.trim()) {
        return path.join(userData, "listentogether-tailcat-state");
      }
    } catch {
      // Ignore in test environments without Electron app.getPath
    }
    return null;
  }

  private resolveRoomIdentity(): {
    hostKeypair: Ed25519Keypair;
    roomId: string;
  } {
    if (this.persistentRoomEnabled) {
      const savedKey = this.configStore.get(
        "listenTogether.persistentHostKeypair",
      ) as { publicKeyB64?: string; privateKeyPem?: string } | undefined;
      const savedRoomId = this.configStore.get(
        "listenTogether.persistentRoomId",
      ) as string | undefined;
      if (
        savedKey?.publicKeyB64 &&
        savedKey?.privateKeyPem &&
        typeof savedRoomId === "string" &&
        savedRoomId.trim()
      ) {
        try {
          const privateKey = crypto.createPrivateKey(savedKey.privateKeyPem);
          return {
            hostKeypair: {
              publicKeyB64: savedKey.publicKeyB64,
              privateKey,
            },
            roomId: savedRoomId,
          };
        } catch {
          // Fall through to generate fresh persistent identity
        }
      }
      const generated = generateEd25519Keypair();
      const newRoomId = crypto.randomUUID();
      const privateKeyPem = generated.privateKey.export({
        type: "pkcs8",
        format: "pem",
      });
      this.configStore.set("listenTogether.persistentHostKeypair", {
        publicKeyB64: generated.publicKeyB64,
        privateKeyPem: String(privateKeyPem),
      });
      this.configStore.set("listenTogether.persistentRoomId", newRoomId);
      return { hostKeypair: generated, roomId: newRoomId };
    }
    return {
      hostKeypair: generateEd25519Keypair(),
      roomId: crypto.randomUUID(),
    };
  }

  private saveFavoriteRooms(): void {
    this.configStore.set("listenTogether.favoriteRooms", this.favoriteRooms);
  }

  private loadPersistentQueue(roomId: string): QueueTrack[] {
    const raw = this.configStore.get("listenTogether.persistentQueue") as
      | Record<string, unknown>
      | unknown[]
      | undefined;
    if (!raw || Array.isArray(raw) || typeof raw !== "object") return [];
    const roomTracks = raw[roomId];
    if (!Array.isArray(roomTracks)) return [];
    return roomTracks.filter(
      (t): t is QueueTrack =>
        Boolean(
          t && typeof t.entryId === "string" && typeof t.videoId === "string",
        ),
    );
  }

  private savePersistentQueue(): void {
    if (
      !this.persistentRoomEnabled ||
      this.sessionMode !== "host" ||
      !this.roomState
    ) {
      return;
    }
    const snapshot = this.roomState.currentTrack
      ? [
          this.roomState.currentTrack,
          ...materializeQueue(this.roomState.scheduler),
        ]
      : materializeQueue(this.roomState.scheduler);
    const raw = this.configStore.get("listenTogether.persistentQueue");
    const existing: Record<string, QueueTrack[]> =
      raw && !Array.isArray(raw) && typeof raw === "object"
        ? { ...(raw as Record<string, QueueTrack[]>) }
        : {};
    existing[this.roomState.roomId] = snapshot.slice(0, 50);
    this.configStore.set("listenTogether.persistentQueue", existing);
  }

  private recordRecentRoom(): void {
    if (this.sessionMode === "host") {
      if (!this.hostKeypair) return;
      const hostPubKeyB64 = this.hostKeypair.publicKeyB64;
      const label =
        this.persistentRoomName.trim() || `${this.displayName || "My"}'s Room`;
      const entry: FavoriteRoomEntry = {
        id: hostPubKeyB64,
        label: label.slice(0, 64),
        ownerName: this.displayName || "You",
        hostPubKeyB64,
        hostClientSlug: this.clientSlug || null,
        inviteUrl: null,
        passcode: "__host__",
        shortCode: null,
        signalingUrl: this.signalingUrl,
        autoJoin: false,
        lastJoinedAtMs: Date.now(),
      };
      this.recentRooms = [
        entry,
        ...this.recentRooms.filter((r) => r.id !== hostPubKeyB64),
      ].slice(0, 5);
      this.configStore.set("listenTogether.recentRooms", this.recentRooms);
      return;
    }
    if (this.sessionMode !== "guest") return;
    const hostPubKeyB64 =
      this.lastGuestJoinParams?.kind === "url"
        ? this.lastGuestJoinParams.envelope.k
        : (this.guestRoomId ?? "");
    if (!hostPubKeyB64) return;
    const hostMember = this.guestMembers.find((m) => m.role === "admin");
    const label = hostMember ? `${hostMember.displayName}'s Room` : "Recent Room";
    const entry: FavoriteRoomEntry = {
      id: hostPubKeyB64,
      label: label.slice(0, 64),
      ownerName: hostMember?.displayName ?? null,
      hostPubKeyB64,
      hostClientSlug: hostMember?.clientSlug ?? null,
      inviteUrl:
        this.lastGuestJoinParams?.kind === "url"
          ? this.lastGuestJoinParams.rawUrl
          : null,
      passcode:
        this.lastGuestJoinParams?.kind === "passcode"
          ? this.lastGuestJoinParams.code
          : null,
      shortCode: this.roomShortCode,
      signalingUrl: this.signalingUrl,
      autoJoin: false,
      lastJoinedAtMs: Date.now(),
    };
    this.recentRooms = [
      entry,
      ...this.recentRooms.filter((r) => r.id !== hostPubKeyB64),
    ].slice(0, 5);
    this.configStore.set("listenTogether.recentRooms", this.recentRooms);
  }

  private getActiveRoomKey(): string | null {
    return this.sessionMode === "host"
      ? (this.hostKeypair?.publicKeyB64 ?? null)
      : this.lastGuestJoinParams?.kind === "url"
        ? this.lastGuestJoinParams.envelope.k
        : this.guestRoomId;
  }

  private isCurrentRoomFavorited(): boolean {
    const key = this.getActiveRoomKey();
    if (!key) return false;
    return this.favoriteRooms.some((r) => r.id === key);
  }

  private saveActiveRoomAsFavorite(
    label?: string,
    autoJoin = false,
  ): ListenTogetherActionResult {
    const hostPubKeyB64 = this.getActiveRoomKey() ?? "";
    if (!hostPubKeyB64) {
      return { ok: false, error: "No active room to favorite" };
    }
    const members =
      this.sessionMode === "host" && this.roomState
        ? Object.values(this.roomState.members)
        : this.guestMembers;
    const hostMember = members.find((m) => m.role === "admin");
    const cleanLabel =
      (typeof label === "string" && label.trim()) ||
      (hostMember ? `${hostMember.displayName}'s Room` : "Saved Room");
    const existing = this.favoriteRooms.find((r) => r.id === hostPubKeyB64);
    if (existing) {
      this.favoriteRooms = this.favoriteRooms.filter(
        (r) => r.id !== hostPubKeyB64,
      );
      this.saveFavoriteRooms();
      this.emitStateChanged();
      return { ok: true };
    }
    const entry: FavoriteRoomEntry = {
      id: hostPubKeyB64,
      label: cleanLabel.slice(0, 64),
      ownerName: hostMember?.displayName ?? null,
      hostPubKeyB64,
      hostClientSlug: hostMember?.clientSlug ?? null,
      inviteUrl:
        this.sessionMode === "host"
          ? this.roomInviteUrl
          : this.lastGuestJoinParams?.kind === "url"
            ? this.lastGuestJoinParams.rawUrl
            : null,
      passcode:
        this.sessionMode === "host"
          ? this.roomPasscode
          : this.lastGuestJoinParams?.kind === "passcode"
            ? this.lastGuestJoinParams.code
            : null,
      shortCode: this.roomShortCode,
      signalingUrl: this.signalingUrl,
      autoJoin: Boolean(autoJoin),
      lastJoinedAtMs: Date.now(),
    };
    this.favoriteRooms = [entry, ...this.favoriteRooms].slice(0, 12);
    this.saveFavoriteRooms();
    this.emitStateChanged();
    return { ok: true };
  }

  private async joinFavoriteRoom(
    id: string,
  ): Promise<ListenTogetherActionResult> {
    const fav =
      this.favoriteRooms.find((r) => r.id === id) ??
      this.recentRooms.find((r) => r.id === id);
    if (!fav) {
      return { ok: false, error: "Saved room not found" };
    }
    if (fav.passcode === "__host__") {
      return this.createRoom({ displayName: this.displayName });
    }
    if (fav.shortCode) {
      const res = await this.joinByUrl(fav.shortCode, {
        displayName: this.displayName,
        trustRelayHost: true,
      });
      if (res.ok) return res;
    }
    if (fav.inviteUrl) {
      const res = await this.joinByUrl(fav.inviteUrl, {
        displayName: this.displayName,
        trustRelayHost: true,
      });
      if (res.ok) return res;
    }
    if (fav.passcode) {
      return this.joinByPasscode(fav.passcode, {
        displayName: this.displayName,
      });
    }
    return { ok: false, error: "No saved invite link or code for this room" };
  }

  private extractShortCodeFromInput(raw: string): string | null {
    const trimmed = raw.trim();
    const joinPrefixMatch = /^ytmd:\/\/join\/([A-Za-z0-9-]+)\/?$/i.exec(
      trimmed,
    );
    const candidate = joinPrefixMatch ? joinPrefixMatch[1]! : trimmed;
    if (
      trimmed.toLowerCase().startsWith("ytmd://listen/") ||
      trimmed.includes("://") && !joinPrefixMatch
    ) {
      return null;
    }
    return normalizePasscode(candidate, this.logger);
  }

  private signalingWsToHttpBase(wsUrl: string | null): string | null {
    if (!wsUrl) return null;
    try {
      const parsed = new URL(wsUrl);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  private async publishShortInviteToRelay(): Promise<void> {
    const inviteUrl = this.roomInviteUrl;
    const base = this.signalingWsToHttpBase(this.signalingUrl);
    if (!inviteUrl || !base || this.sessionMode !== "host") return;
    try {
      const res = await fetch(`${base}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteUrl }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        code?: string;
        shortUrl?: string;
      };
      if (
        this.sessionMode === "host" &&
        this.roomInviteUrl === inviteUrl &&
        typeof data.code === "string"
      ) {
        this.roomShortCode = data.code;
        this.roomShortInviteUrl =
          typeof data.shortUrl === "string"
            ? data.shortUrl
            : `ytmd://join/${data.code}`;
        this.emitStateChanged();
      }
    } catch {
      // Relay short-code publishing is best-effort; full inviteUrl still works
    }
  }

  private async resolveShortInviteFromRelay(
    code: string,
  ): Promise<string | null> {
    const base = this.signalingWsToHttpBase(this.signalingUrl);
    if (!base) return null;
    try {
      const res = await fetch(
        `${base}/invites/${encodeURIComponent(code)}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { inviteUrl?: unknown };
      return typeof data.inviteUrl === "string" ? data.inviteUrl : null;
    } catch {
      return null;
    }
  }

  private isTailcatAvailable(): boolean {
    if (this.injectedDeps.resolveTailcatBinaryFn) {
      return Boolean(this.injectedDeps.resolveTailcatBinaryFn());
    }
    return Boolean(resolveTailcatBinary());
  }

  private saveDisplayName(name: string): void {
    this.displayName = name;
    this.configStore.set("listenTogether.displayName", name);
  }

  private saveSignalingUrl(url: string | null): void {
    this.signalingUrl = url;
    this.configStore.set("listenTogether.signalingUrl", url);
  }

  private saveTailcatDerpMapUrl(url: string | null): void {
    this.tailcatDerpMapUrl = url;
    this.configStore.set("listenTogether.tailcatDerpMapUrl", url);
  }

  private updateTailcatDerpMapUrl(
    rawUrl: string | null,
  ): ListenTogetherActionResult {
    if (rawUrl === null || rawUrl.trim() === "") {
      this.saveTailcatDerpMapUrl(null);
      this.logger.info?.("Cleared Listen Together Tailcat DERP map URL");
      this.emitStateChanged();
      return { ok: true };
    }
    const trimmed = rawUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") {
        throw new Error("DERP map URL must use https://");
      }
    } catch {
      this.logger.warn?.(
        "Rejected invalid Listen Together Tailcat DERP map URL",
        {
          url: redactLogUrl(trimmed),
        },
      );
      return {
        ok: false,
        error: "Enter a valid https:// DERP map JSON URL.",
      };
    }
    this.saveTailcatDerpMapUrl(trimmed);
    this.logger.info?.("Updated Listen Together Tailcat DERP map URL", {
      url: redactLogUrl(trimmed),
    });
    this.emitStateChanged();
    return { ok: true };
  }

  private trustSignalingHost(host: string): void {
    const lower = host.toLowerCase();
    if (!this.trustedSignalingHosts.includes(lower)) {
      const updated = [...this.trustedSignalingHosts, lower];
      this.trustedSignalingHosts = updated;
      this.configStore.set("listenTogether.trustedSignalingHosts", updated);
    }
  }

  private updateSignalingUrl(
    rawUrl: string | null,
  ): ListenTogetherActionResult {
    if (rawUrl === null || rawUrl.trim() === "") {
      this.saveSignalingUrl(null);
      this.logger.info?.("Cleared Listen Together signaling URL");
      this.emitStateChanged();
      return { ok: true };
    }
    const trimmed = rawUrl.trim();
    if (!isAllowedSignalingUrl(trimmed, true, this.logger)) {
      this.logger.warn?.("Rejected invalid Listen Together signaling URL", {
        url: redactInviteUrl(redactLogUrl(trimmed)),
      });
      return {
        ok: false,
        error: "Enter a valid https:// or wss:// relay server URL.",
      };
    }
    this.saveSignalingUrl(trimmed);
    const host = extractRelayHost(trimmed);
    if (host) {
      this.trustSignalingHost(host);
    }
    this.logger.info?.("Updated Listen Together signaling URL", {
      url: redactLogUrl(trimmed),
    });
    this.emitStateChanged();
    return { ok: true };
  }

  private startLanDiscovery(): void {
    if (this.lanBrowser || this.terminated) return;
    try {
      const browserOpts: DirectWsBrowserOptions = {
        logger: this.logger,
        ...this.injectedDeps.directBrowserOptions,
      };
      const browser = this.injectedDeps.createDirectBrowser
        ? this.injectedDeps.createDirectBrowser(browserOpts)
        : new DirectWsBrowser(browserOpts);
      browser.onRoomsChanged((rooms) => {
        this.rawDiscoveredLanRooms = rooms;
        this.syncLanRoomsUI();
      });
      browser.start();
      this.lanBrowser = browser;
    } catch (err) {
      this.logger.warn?.("Failed to initialize LAN mDNS browser", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private stopLanDiscovery(): void {
    if (!this.lanBrowser) return;
    const browser = this.lanBrowser;
    this.lanBrowser = null;
    void browser.stop();
  }

  private syncLanRoomsUI(): void {
    const ownLookupId = this.sessionMode === "host" ? this.roomLookupId : null;
    this.lanRooms = this.rawDiscoveredLanRooms
      .filter((r) => !ownLookupId || r.lookupId !== ownLookupId)
      .map((r) => ({
        lookupId: r.lookupId,
        label: r.label,
        port: r.port,
        ip: r.host,
      }));
    this.emitStateChanged();
  }

  private bindIpcHandlers(): void {
    const ipc = this.injectedDeps.ipcMain ?? ipcMain;

    ipc.handle(LISTEN_TOGETHER_IPC.getState, (event) => {
      this.assertAuthorizedSender(
        event.sender?.id,
        LISTEN_TOGETHER_IPC.getState,
      );
      return this.getUIState();
    });

    ipc.handle(
      LISTEN_TOGETHER_IPC.action,
      async (event, command: ListenTogetherCommand) => {
        this.assertAuthorizedSender(
          event.sender?.id,
          LISTEN_TOGETHER_IPC.action,
        );
        return this.handleCommand(command);
      },
    );

    ipc.on(LISTEN_TOGETHER_IPC.togglePanel, (event) => {
      if (!this.isAuthorizedSender(event.sender?.id)) {
        this.logger.warn?.("Rejected unauthorized Listen Together IPC", {
          channel: LISTEN_TOGETHER_IPC.togglePanel,
          senderId: event.sender?.id ?? null,
        });
        return;
      }
      this.togglePanel();
    });

    ipc.on(LISTEN_TOGETHER_IPC.closePanel, (event) => {
      if (!this.isAuthorizedSender(event.sender?.id)) {
        this.logger.warn?.("Rejected unauthorized Listen Together IPC", {
          channel: LISTEN_TOGETHER_IPC.closePanel,
          senderId: event.sender?.id ?? null,
        });
        return;
      }
      this.setPanelOpen(false);
    });
  }

  private isAuthorizedSender(senderId: number | undefined): boolean {
    return (
      typeof senderId === "number" && this.authorizedSenderIds.has(senderId)
    );
  }

  private assertAuthorizedSender(
    senderId: number | undefined,
    channel: string,
  ): void {
    if (!this.isAuthorizedSender(senderId)) {
      this.logger.warn?.("Rejected unauthorized Listen Together IPC", {
        channel,
        senderId: senderId ?? null,
      });
      throw new Error(`Unauthorized sender for ${channel}`);
    }
  }

  private emitStateChanged(): void {
    const snapshot = this.getUIState();
    this.emit("state-changed", snapshot);

    const sentIds = new Set<number>();
    for (const win of this.windowManager.getWindows()) {
      const wcId = win.webContents?.id;
      if (wcId !== undefined) {
        sentIds.add(wcId);
      }
      win.ipcBroadcast(LISTEN_TOGETHER_IPC.stateChanged, snapshot);
    }

    for (const id of this.authorizedSenderIds) {
      if (sentIds.has(id)) continue;
      try {
        const wc = webContents.fromId(id);
        if (wc && !wc.isDestroyed()) {
          wc.send(LISTEN_TOGETHER_IPC.stateChanged, snapshot);
        }
      } catch {
        // Ignore in non-Electron test environments
      }
    }
  }

  private bindProtectedApiListeners(): void {
    this.listenTogetherApi.on(
      "hostTransportRequested",
      (payload: {
        action?: "play" | "pause" | "seek" | "skip";
        posSec?: number;
      }) => {
        if (
          this.sessionMode !== "host" ||
          this.listeningMode === "local" ||
          !payload?.action
        ) {
          return;
        }
        this.handleHostTransport(payload.action, payload.posSec);
      },
    );

    this.listenTogetherApi.on("trackSelectedCandidate", (rawMeta: unknown) => {
      if (this.sessionMode === "none") return;
      if (this.getLocalRole() === "listener") {
        this.showTransientNotice(
          "You are a Listener — only Host and DJs can queue songs",
        );
        return;
      }
      if (!Value.Check(QueueTrackMetaSchema, rawMeta)) {
        this.showTransientNotice(
          "This track isn't available or is a live stream",
        );
        return;
      }
      this.setClickedCandidate(rawMeta);
    });

    this.listenTogetherApi.on(
      "blockedAction",
      (payload: { action?: string; videoId?: string; error?: string }) => {
        if (this.sessionMode === "none") return;
        const action = payload?.action;
        if (action === "playlist") {
          this.showTransientNotice("Playlists can't be queued — pick a song");
        } else if (action === "invalidTrack") {
          this.showTransientNotice(
            "This track isn't available or is a live stream",
          );
        } else if (action === "avToggle") {
          return;
        } else if (this.sessionMode === "guest") {
          this.showTransientNotice("Playback is controlled by the Host");
        }
      },
    );

    this.listenTogetherApi.on("audioBlocked", () => {
      if (this.sessionMode === "none") return;
      this.audioBlocked = true;
      this.logger.warn?.(
        "Playback blocked by autoplay policy (NotAllowedError); audioBlocked=true",
        {
          sessionMode: this.sessionMode,
          roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
        },
      );
      this.emitStateChanged();
    });

    this.listenTogetherApi.on("trackReady", (payload: { videoId?: string }) => {
      this.handleLocalTrackReady(payload?.videoId ?? null);
    });

    this.listenTogetherApi.on("adStarted", () => {
      this.handleLocalAdStarted();
    });

    this.listenTogetherApi.on(
      "adEnded",
      (payload: { localVideoId?: string | null }) => {
        void this.handleLocalAdEnded(payload?.localVideoId ?? null);
      },
    );

    this.listenTogetherApi.on(
      "adPostRollEnded",
      (payload: {
        appliedPendingLoad?: boolean;
        videoId?: string;
        localVideoId?: string | null;
      }) => {
        void this.handleLocalAdPostRollEnded(payload);
      },
    );

    this.listenTogetherApi.on(
      "localPlaybackStarted",
      (payload: {
        kind?: "track" | "playlist";
        videoId?: string | null;
        playlistId?: string | null;
        title?: string | null;
      }) => {
        this.handleLocalPlaybackStarted(payload ?? {});
      },
    );

    this.listenTogetherApi.on(
      "localPlaylistResolved",
      (payload: {
        playlistId?: string;
        title?: string;
        trackCount?: number;
      }) => {
        this.handleLocalPlaylistResolved(payload ?? {});
      },
    );

    this.listenTogetherApi.on("localTrackMetaResolved", (rawMeta: unknown) => {
      this.handleLocalTrackMetaUpdated(rawMeta);
    });

    this.listenTogetherApi.on("localTrackUpdated", (rawMeta: unknown) => {
      this.handleLocalTrackMetaUpdated(rawMeta);
    });

    this.listenTogetherApi.on(
      "quickAddTrack",
      (payload: { videoId?: string }) => {
        if (typeof payload?.videoId === "string") {
          void this.handleQuickAddTrack(payload.videoId);
        }
      },
    );

    this.listenTogetherApi.on(
      "quickAddPlaylist",
      (payload: { playlistId?: string }) => {
        if (typeof payload?.playlistId === "string") {
          void this.handleQuickAddPlaylist(payload.playlistId);
        }
      },
    );

    this.listenTogetherApi.on(
      "ytmViewLog",
      (payload: {
        level?: "debug" | "info" | "warn" | "error";
        message?: string;
        context?: Record<string, unknown>;
      }) => {
        if (!payload || typeof payload.message !== "string") return;
        const level =
          payload.level === "debug" ||
          payload.level === "info" ||
          payload.level === "warn" ||
          payload.level === "error"
            ? payload.level
            : "info";
        this.logger[level]?.(`[YTMView] ${payload.message}`, payload.context);
      },
    );
  }

  private bindPlayerStateListeners(): void {
    this.playerStateStore.on("state-changed", (playerState) => {
      this.handlePlayerStateChanged(playerState);
    });

    this.playerStateStore.on("player-signal", (signal) => {
      if (signal === PlayerSignal.TrackEnded) {
        this.handleLocalTrackEnded();
      }
    });

    this.playerStateStore.on("track-unavailable", (_videoId, reason) => {
      this.handleLocalTrackUnavailable(reason);
    });
  }

  private bindYtmViewListeners(): void {
    this.ytmViewManager.on("status-changed", () => {
      if (
        this.ytmViewManager.status === YTMViewStatus.Ready &&
        this.sessionMode !== "none"
      ) {
        this.logger.info?.(
          "YTMView entered Ready state during active session; resyncing view",
          {
            sessionMode: this.sessionMode,
            roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
          },
        );
        void this.resyncViewAfterReady();
      }
    });

    this.ytmViewManager.on("view-recreated", () => {
      this.lastAppliedSessionLock = null;
      if (this.sessionMode !== "none") {
        this.logger.info?.(
          "YTMView recreated during active session; cleared lock cache and scheduling relock/resync",
          {
            sessionMode: this.sessionMode,
            roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
          },
        );
        void this.resyncViewAfterReady();
      }
    });
  }

  private async resyncViewAfterReady(): Promise<void> {
    if (this.sessionMode === "none") return;
    const isHost = this.sessionMode === "host";
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();
    this.logger.info?.("Relocking and resyncing YTMView after ready", {
      isHost,
      listeningMode: this.listeningMode,
      videoId: currentTrack?.videoId ?? null,
      seq: anchor?.seq ?? null,
    });
    await this.applySessionLockToView(
      true,
      isHost,
      currentTrack?.videoId ?? null,
      this.listeningMode,
    );
    if (this.listeningMode === "room" && anchor && currentTrack) {
      this.lastAppliedSeq = null;
      await this.applyAnchorToLocalView(anchor);
    }
  }

  private handlePlayerStateChanged(playerState: PlayerState): void {
    if (this.sessionMode !== "guest") return;
    if (this.listeningMode === "local") return;
    if (this.localInAd || playerState.adPlaying) return;

    const anchor = this.guestAnchor;
    const track = this.guestCurrentTrack;
    if (
      !anchor ||
      !track ||
      !this.guestClockSync ||
      !this.guestDriftController
    ) {
      return;
    }

    if (playerState.trackState === VideoState.Playing && this.audioBlocked) {
      this.audioBlocked = false;
      this.logger.info?.(
        "Guest playback entered Playing state; cleared audioBlocked",
        { roomId: this.guestRoomId },
      );
      this.emitStateChanged();
    }

    if (playerState.videoDetails?.id !== track.videoId) {
      return;
    }

    const localNowMs = this.nowMs();
    const hostNowMs = this.guestClockSync.projectHostNow(localNowMs);
    const evaluation = this.guestDriftController.evaluateDrift(
      anchor,
      playerState.videoProgress,
      hostNowMs,
      localNowMs,
    );

    if (evaluation.action === "seek" && evaluation.targetPosSec !== undefined) {
      this.guestDriftController.markSeekIssued(localNowMs);
      const nextDegraded = this.guestDriftController.isDegraded(localNowMs);
      if (nextDegraded !== this.degradedSync) {
        this.degradedSync = nextDegraded;
        this.emitStateChanged();
      }
      void this.invokeViewSyncPlayback({
        action: "seek",
        posSec: evaluation.targetPosSec,
      });
    } else {
      const nextDegraded = this.guestDriftController.isDegraded(localNowMs);
      if (nextDegraded !== this.degradedSync) {
        this.degradedSync = nextDegraded;
        this.emitStateChanged();
      }
    }
  }

  private handleLocalTrackReady(videoId: string | null): void {
    if (
      this.sessionMode === "none" ||
      this.listeningMode === "local" ||
      this.localInAd
    ) {
      return;
    }
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();
    if (
      !currentTrack ||
      !anchor ||
      !videoId ||
      videoId !== currentTrack.videoId
    ) {
      return;
    }

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "TRACK_READY",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "TRACK_READY",
        seq: anchor.seq,
      });
      if (anchor.desiredState === "PLAYING" && !anchor.pausedForAd) {
        void this.applyAnchorToLocalView(anchor);
      }
    }
  }

  private handleLocalTrackEnded(): void {
    if (
      this.sessionMode === "none" ||
      this.listeningMode === "local" ||
      this.localInAd
    ) {
      return;
    }
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();
    if (!currentTrack || !anchor) return;

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "TRACK_ENDED",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "TRACK_ENDED",
        seq: anchor.seq,
      });
    }
  }

  private handleLocalTrackUnavailable(reason: string | number): void {
    if (
      this.sessionMode === "none" ||
      this.listeningMode === "local" ||
      this.localInAd
    ) {
      return;
    }
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();
    if (!currentTrack || !anchor) return;

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "TRACK_UNAVAILABLE",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
        errorCode: reason,
      });
    } else if (this.sessionMode === "guest") {
      const localMember = this.getLocalMember();
      if (
        localMember?.role !== "admin" &&
        currentTrack.addedBy !== this.getSelfPeerId()
      ) {
        this.minorityUnavailable = true;
        this.emitStateChanged();
      }
      this.sendGuestAppMessage({
        type: "TRACK_UNAVAILABLE",
        seq: anchor.seq,
        errorCode: reason,
      });
    }
  }

  private handleLocalAdStarted(): void {
    if (this.sessionMode === "none" || this.listeningMode === "local") return;
    this.localInAd = true;
    this.clearPendingPlayTimer();
    const anchor = this.getCurrentAnchor();
    this.logger.info?.("Local ad started", {
      sessionMode: this.sessionMode,
      seq: anchor?.seq ?? null,
    });
    if (!anchor) {
      this.emitStateChanged();
      return;
    }

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "AD_STARTED",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "AD_STARTED",
        seq: anchor.seq,
      });
    }
    this.emitStateChanged();
  }

  private async handleLocalAdEnded(localVideoId: string | null): Promise<void> {
    if (this.sessionMode === "none" || this.listeningMode === "local") return;
    this.localInAd = false;
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();
    this.logger.info?.("Local ad ended", {
      sessionMode: this.sessionMode,
      seq: anchor?.seq ?? null,
      localVideoId,
    });
    if (!anchor) {
      this.emitStateChanged();
      return;
    }

    if (currentTrack) {
      const projectedPosSec = this.projectCurrentRoomPosSec(anchor);
      if (projectedPosSec >= currentTrack.durationSec - 1.5) {
        this.handleLocalTrackEnded();
      } else if (
        localVideoId &&
        localVideoId !== currentTrack.videoId &&
        !this.adPostRollReloadedSeqs.has(anchor.seq)
      ) {
        this.adPostRollReloadedSeqs.add(anchor.seq);
        await this.invokeViewLoadExactVideo({
          videoId: currentTrack.videoId,
          startPosSec: projectedPosSec,
          pausedForBarrier:
            anchor.desiredState === "LOADING_BARRIER" ||
            anchor.pausedForAd ||
            anchor.desiredState === "PAUSED_BY_USER",
        });
      } else if (anchor.pausedForAd) {
        await this.invokeViewSyncPlayback({
          action: "pause",
          posSec: anchor.anchorPosSec,
        });
      }
    }

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "AD_ENDED",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
      });
      if (this.roomState) {
        await this.applyAnchorToLocalView(buildPlaybackAnchor(this.roomState));
      }
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "AD_ENDED",
        seq: anchor.seq,
      });
      await this.applyAnchorToLocalView(anchor);
    }
    this.emitStateChanged();
  }

  private async handleLocalAdPostRollEnded(payload: {
    appliedPendingLoad?: boolean;
    videoId?: string;
    localVideoId?: string | null;
  }): Promise<void> {
    if (this.sessionMode === "none" || this.listeningMode === "local") return;
    this.localInAd = false;
    const anchor = this.getCurrentAnchor();
    this.logger.info?.("Local ad post-roll ended", {
      sessionMode: this.sessionMode,
      seq: anchor?.seq ?? null,
      appliedPendingLoad: Boolean(payload?.appliedPendingLoad),
      videoId: payload?.videoId ?? null,
    });
    if (!anchor) {
      this.emitStateChanged();
      return;
    }

    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "AD_ENDED",
        peerId: this.roomState.hostPeerId,
        seq: anchor.seq,
      });
      if (payload?.appliedPendingLoad && this.roomState) {
        await this.applyAnchorToLocalView(buildPlaybackAnchor(this.roomState));
      }
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "AD_ENDED",
        seq: anchor.seq,
      });
      await this.applyAnchorToLocalView(anchor);
    }
    this.emitStateChanged();
  }

  private handleArbiterHostTransport(
    command: HostTransportCommand,
    ...args: unknown[]
  ): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    if (command === "play") {
      this.handleHostTransport("play");
    } else if (command === "pause") {
      this.handleHostTransport("pause");
    } else if (command === "playPause") {
      const nextAction =
        this.roomState.desiredPlaybackState === "PLAYING" ? "pause" : "play";
      this.handleHostTransport(nextAction);
    } else if (command === "next") {
      this.handleHostTransport("skip");
    } else if (command === "seekTo") {
      const posSec = typeof args[0] === "number" ? args[0] : undefined;
      if (posSec !== undefined && Number.isFinite(posSec)) {
        this.handleHostTransport("seek", posSec);
      }
    }
  }

  private handleHostTransport(
    action: "play" | "pause" | "skip" | "seek",
    seekPosSec?: number,
  ): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "HOST_TRANSPORT",
      actorId: this.roomState.hostPeerId,
      action,
      seekPosSec,
    });
  }

  private handleForceResumeFromAd(): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "HOST_FORCE_RESUME_FROM_AD",
      actorId: this.roomState.hostPeerId,
      seq: this.roomState.seq,
    });
  }

  private handleModerateMember(
    targetPeerId: string,
    action:
      | "make-dj"
      | "make-listener"
      | "demote-clear"
      | "kick"
      | "promote-host",
  ): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    if (action === "promote-host") {
      void this.initiateHostMigration(targetPeerId, "promoted", true);
      return;
    }
    this.dispatchRoomEvent({
      type: "HOST_MODERATION",
      actorId: this.roomState.hostPeerId,
      targetPeerId,
      action,
    });
  }

  private pickMigrationSuccessor(): string | null {
    if (!this.roomState) return null;
    const connectedIds = [...this.hostPeers.keys()];
    if (connectedIds.length === 0) return null;
    const djPeer = connectedIds.find(
      (id) => this.roomState?.members[id]?.role === "dj",
    );
    return djPeer ?? connectedIds[0] ?? null;
  }

  private async initiateHostMigration(
    targetPeerId: string,
    reason: "promoted" | "host-left" | "host-reclaimed",
    rejoinAsGuest: boolean,
  ): Promise<void> {
    if (this.sessionMode !== "host" || !this.roomState) return;
    const targetPeer = this.hostPeers.get(targetPeerId);
    if (!targetPeer) return;

    const queueSnapshot = this.roomState.currentTrack
      ? [
          this.roomState.currentTrack,
          ...materializeQueue(this.roomState.scheduler),
        ]
      : materializeQueue(this.roomState.scheduler);

    const newInviteUrl = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingMigrationResolve === resolve) {
          this.pendingMigrationResolve = null;
          resolve(null);
        }
      }, 6_000);
      this.pendingMigrationResolve = (url) => {
        clearTimeout(timer);
        this.pendingMigrationResolve = null;
        resolve(url);
      };
      const anchor = this.getCurrentAnchor();
      const initialPositionSec = anchor
        ? this.projectCurrentRoomPosSec(anchor)
        : 0;
      this.sendEncryptedToPeer(targetPeerId, {
        type: "HOST_MIGRATION_PREPARE",
        targetPeerId,
        ownerPubKey:
          reason === "promoted"
            ? targetPeerId
            : (this.roomOwnerPubKey ?? this.roomState!.hostPeerId),
        reason,
        settings: { ...this.roomState!.settings },
        queueSnapshot,
        initialPositionSec,
        history: [...this.roomState!.history],
      });
    });

    if (!newInviteUrl || this.sessionMode !== "host") {
      this.logger.warn?.("Host migration timed out or cancelled", {
        targetPeerId,
        reason,
      });
      return;
    }

    this.logger.info?.("Broadcasting HOST_MIGRATED to peers", {
      targetPeerId,
      reason,
      rejoinAsGuest,
    });
    for (const [peerId] of this.hostPeers) {
      if (peerId === targetPeerId) continue;
      this.sendEncryptedToPeer(peerId, {
        type: "HOST_MIGRATED",
        newHostPeerId: targetPeerId,
        newInviteUrl,
        reason,
      });
    }

    if (rejoinAsGuest) {
      await this.teardownActiveSession({
        sendRoomEnded: false,
        unlockView: false,
      });
      await this.joinByUrl(newInviteUrl, {
        displayName: this.displayName,
        trustRelayHost: true,
      });
    }
  }

  private handleUpdateSettings(settings: Partial<RoomSettings>): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "HOST_UPDATE_SETTINGS",
      actorId: this.roomState.hostPeerId,
      settings,
    });
  }

  private handleRemoveTrack(entryId: string): void {
    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "QUEUE_REMOVE",
        actorId: this.roomState.hostPeerId,
        entryId,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "QUEUE_REMOVE",
        entryId,
      });
    }
  }

  private handlePinTrackNext(entryId: string): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "QUEUE_PIN_NEXT",
      actorId: this.roomState.hostPeerId,
      entryId,
    });
  }

  private handleUnpinTrack(entryId: string): void {
    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "QUEUE_UNPIN",
        actorId: this.roomState.hostPeerId,
        entryId,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "QUEUE_UNPIN",
        entryId,
      });
    }
  }

  private handleReorderQueue(entryId: string, targetIndex: number): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "QUEUE_REORDER",
      actorId: this.roomState.hostPeerId,
      entryId,
      targetIndex,
    });
  }

  private handleJumpToTrack(
    target: "queue" | "history",
    entryId: string,
  ): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    this.dispatchRoomEvent({
      type: "HOST_JUMP_TRACK",
      actorId: this.roomState.hostPeerId,
      target,
      entryId,
    });
  }

  private handleVoteSkip(): void {
    if (this.sessionMode === "host" && this.roomState) {
      if (!this.roomState.currentTrack) return;
      this.dispatchRoomEvent({
        type: "VOTE_SKIP",
        peerId: this.roomState.hostPeerId,
        seq: this.roomState.seq,
      });
    } else if (this.sessionMode === "guest" && this.guestAnchor) {
      if (!this.guestCurrentTrack) return;
      this.sendGuestAppMessage({
        type: "VOTE_SKIP",
        seq: this.guestAnchor.seq,
      });
    }
  }

  private handleLocalPlaybackStarted(payload: {
    kind?: "track" | "playlist";
    videoId?: string | null;
    playlistId?: string | null;
    title?: string | null;
  }): void {
    if (this.sessionMode === "none") return;
    const isHost = this.sessionMode === "host";
    this.listeningMode = "local";
    if (this.lastAppliedSessionLock) {
      this.lastAppliedSessionLock = {
        ...this.lastAppliedSessionLock,
        listeningMode: "local",
      };
    }
    this.clearPendingPlayTimer();
    this.arbiter.setSessionState({
      active: true,
      isHost,
      listeningMode: "local",
    });
    this.syncSelfListeningMode("local");

    if (payload.kind === "playlist" && payload.playlistId) {
      this.localPlaylist = {
        playlistId: payload.playlistId,
        title:
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim().slice(0, 120)
            : `Playlist (${payload.playlistId.slice(0, 12)})`,
      };
    } else if (payload.kind === "track") {
      this.localPlaylist = null;
    }

    const vid =
      typeof payload.videoId === "string" && VIDEO_ID_RE.test(payload.videoId)
        ? payload.videoId
        : null;
    if (vid && this.localTrack?.videoId !== vid) {
      const playerDetails = this.playerStateStore.getState?.()?.videoDetails;
      if (playerDetails && playerDetails.id === vid) {
        this.localTrack = {
          videoId: vid,
          title: playerDetails.title || `Track (${vid})`,
          author: playerDetails.author || "",
          durationSec: Math.max(1, Math.round(playerDetails.durationSeconds || 180)),
          thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        };
      } else {
        this.localTrack = {
          videoId: vid,
          title:
            typeof payload.title === "string" && payload.title.trim()
              ? payload.title.trim().slice(0, 200)
              : `Playing track (${vid})`,
          author: "",
          durationSec: 180,
          thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        };
      }
    }

    this.logger.info?.("Entered local listening mode", {
      kind: payload.kind ?? "track",
      videoId: vid,
      playlistId: payload.playlistId ?? null,
    });
    this.emitStateChanged();
  }

  private handleLocalPlaylistResolved(payload: {
    playlistId?: string;
    title?: string;
    trackCount?: number;
  }): void {
    if (
      this.sessionMode === "none" ||
      this.listeningMode !== "local" ||
      !payload.playlistId
    ) {
      return;
    }
    this.localPlaylist = {
      playlistId: payload.playlistId,
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim().slice(0, 120)
          : `Playlist (${payload.playlistId.slice(0, 12)})`,
      trackCount:
        typeof payload.trackCount === "number" ? payload.trackCount : undefined,
    };
    this.emitStateChanged();
  }

  private handleLocalTrackMetaUpdated(rawMeta: unknown): void {
    if (this.sessionMode === "none" || this.listeningMode !== "local") return;
    if (!rawMeta || typeof rawMeta !== "object") return;
    const candidate = { ...(rawMeta as Record<string, unknown>) };
    if (
      candidate.thumbnailUrl == null &&
      typeof candidate.videoId === "string" &&
      VIDEO_ID_RE.test(candidate.videoId)
    ) {
      candidate.thumbnailUrl = `https://i.ytimg.com/vi/${candidate.videoId}/hqdefault.jpg`;
    }
    if (!Value.Check(QueueTrackMetaSchema, candidate)) return;
    this.localTrack = candidate;
    this.emitStateChanged();
  }

  private async handleTuneBackIn(): Promise<void> {
    if (this.sessionMode === "none") return;
    const isHost = this.sessionMode === "host";
    const currentTrack = this.getCurrentTrack();
    const anchor = this.getCurrentAnchor();

    this.listeningMode = "room";
    this.localTrack = null;
    this.localPlaylist = null;
    this.arbiter.setSessionState({
      active: true,
      isHost,
      listeningMode: "room",
    });

    await this.applySessionLockToView(
      true,
      isHost,
      currentTrack?.videoId ?? null,
      "room",
    );

    this.lastAppliedSeq = null;
    if (anchor) {
      await this.applyAnchorToLocalView(anchor);
    }

    this.logger.info?.("Tuned back into Listen Together room", {
      isHost,
      videoId: currentTrack?.videoId ?? null,
      seq: anchor?.seq ?? null,
    });
    this.syncSelfListeningMode("room");
    this.emitStateChanged();
  }

  private async handleTuneOut(): Promise<void> {
    if (this.sessionMode === "none") return;
    const isHost = this.sessionMode === "host";
    const currentTrack = this.getCurrentTrack();

    this.listeningMode = "local";
    this.clearPendingPlayTimer();
    this.arbiter.setSessionState({
      active: true,
      isHost,
      listeningMode: "local",
    });
    this.syncSelfListeningMode("local");

    await this.applySessionLockToView(
      true,
      isHost,
      currentTrack?.videoId ?? null,
      "local",
    );
    await this.invokeViewSyncPlayback({ action: "pause", posSec: 0 });

    this.logger.info?.("Tuned out of Listen Together room", {
      isHost,
      videoId: currentTrack?.videoId ?? null,
    });
    this.emitStateChanged();
  }

  private syncSelfListeningMode(mode: "room" | "local"): void {
    if (this.sessionMode === "host" && this.roomState) {
      this.dispatchRoomEvent({
        type: "MEMBER_LISTENING_MODE",
        peerId: this.roomState.hostPeerId,
        listeningMode: mode,
      });
    } else if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "SET_LISTENING_MODE",
        listeningMode: mode,
      });
    }
  }

  private handleAddLocalTrackToQueue(): ListenTogetherActionResult {
    if (this.sessionMode === "none") {
      return { ok: false, error: "Not in a room" };
    }
    if (this.getLocalRole() === "listener") {
      this.showTransientNotice("Only Host and DJs can add songs");
      return { ok: false, error: "Listeners cannot add songs" };
    }

    let meta = this.localTrack;
    if (!meta) {
      const details = this.playerStateStore.getState?.()?.videoDetails;
      if (details && VIDEO_ID_RE.test(details.id)) {
        meta = {
          videoId: details.id,
          title: details.title || `Track (${details.id})`,
          author: details.author || "",
          durationSec: Math.max(1, Math.round(details.durationSeconds || 180)),
          thumbnailUrl: `https://i.ytimg.com/vi/${details.id}/hqdefault.jpg`,
        };
      }
    }

    if (!meta) {
      return { ok: false, error: "No local track selected" };
    }

    const res = this.enqueueTrackMeta(meta);
    if (res.ok) {
      this.showTransientNotice(`Added '${meta.title}' to Room Queue`);
    }
    return res;
  }

  private async handleAddLocalPlaylistToQueue(): Promise<ListenTogetherActionResult> {
    if (this.sessionMode === "none") {
      return { ok: false, error: "Not in a room" };
    }
    if (this.getLocalRole() === "listener") {
      this.showTransientNotice("Only Host and DJs can add songs");
      return { ok: false, error: "Listeners cannot add songs" };
    }
    if (!this.localPlaylist?.playlistId) {
      return { ok: false, error: "No local playlist active" };
    }

    return this.handleQuickAddPlaylist(this.localPlaylist.playlistId);
  }

  private async handleQuickAddTrack(
    videoId: string,
  ): Promise<ListenTogetherActionResult> {
    const res = await this.addSongByInput(videoId);
    if (res.ok) {
      this.showTransientNotice("Added song to Room Queue");
    }
    return res;
  }

  private async handleQuickAddPlaylist(
    playlistId: string,
  ): Promise<ListenTogetherActionResult> {
    if (this.sessionMode === "none") {
      return { ok: false, error: "Not in a room" };
    }
    if (this.getLocalRole() === "listener") {
      this.showTransientNotice("Only Host and DJs can add songs");
      return { ok: false, error: "Listeners cannot add songs" };
    }
    const cleanId = playlistId.trim();
    if (!cleanId) {
      return { ok: false, error: "No playlist specified" };
    }

    try {
      await this.ensureProtectedApiPortReady();
      const [res] = (await this.listenTogetherApi.invokeMessage(
        "resolvePlaylistTracks",
        { playlistId: cleanId, limit: 25 },
      )) as [
        | { ok: true; tracks: QueueTrackMeta[]; title: string }
        | { ok: false; error: string },
      ];
      if (!res || !res.ok || res.tracks.length === 0) {
        const error = !res?.ok
          ? (res?.error ?? "EMPTY_PLAYLIST")
          : "No playable songs found";
        this.showTransientNotice("Could not load playlist songs");
        return { ok: false, error };
      }

      let addedCount = 0;
      for (const track of res.tracks) {
        const enqueueRes = this.enqueueTrackMeta(track);
        if (!enqueueRes.ok) break;
        addedCount += 1;
      }

      if (addedCount > 0) {
        this.showTransientNotice(
          `Added ${addedCount} ${addedCount === 1 ? "song" : "songs"} from playlist`,
        );
        return { ok: true };
      }
      return { ok: false, error: "Queue limit reached" };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load playlist";
      this.showTransientNotice("Could not load playlist songs");
      return { ok: false, error: message };
    }
  }

  private getLogFilePath(): string | null {
    return (
      (
        log as unknown as {
          transports?: { file?: { getFile?: () => { path?: string } | null } };
        }
      ).transports?.file?.getFile?.()?.path ?? null
    );
  }

  private async openLogFile(): Promise<ListenTogetherActionResult> {
    const filePath = this.getLogFilePath();

    if (!filePath) {
      return { ok: false, error: "Log file path unavailable" };
    }

    try {
      if (typeof shell.showItemInFolder === "function") {
        shell.showItemInFolder(filePath);
        return { ok: true };
      }
      if (typeof shell.openPath === "function") {
        const errMsg = await shell.openPath(path.dirname(filePath));
        if (errMsg) {
          return { ok: false, error: errMsg };
        }
        return { ok: true };
      }
      return { ok: false, error: "File manager unavailable" };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to open log file",
      };
    }
  }

  private async addSongByInput(
    input: string,
  ): Promise<ListenTogetherActionResult> {
    if (this.sessionMode === "none") {
      return { ok: false, error: "Not in a room" };
    }
    if (this.getLocalRole() === "listener") {
      this.showTransientNotice("Only Host and DJs can add songs");
      return { ok: false, error: "Listeners cannot add songs" };
    }

    const videoId = extractVideoIdFromInput(input);
    if (!videoId) {
      this.showTransientNotice("Paste a valid YouTube Music song link");
      return { ok: false, error: "Invalid YouTube Music link or video ID" };
    }

    try {
      await this.ensureProtectedApiPortReady();
      const [res] = (await this.listenTogetherApi.invokeMessage(
        "resolveVideoMeta",
        videoId,
      )) as [{ ok: true; meta: QueueTrackMeta } | { ok: false; error: string }];
      if (!res || !res.ok) {
        this.logger.warn?.("resolveVideoMeta failed for user song input", {
          videoId,
          error: res?.error ?? "Unavailable track",
        });
        this.showTransientNotice(
          "This track isn't available or is a live stream",
        );
        return { ok: false, error: res?.error ?? "Unavailable track" };
      }
      return this.enqueueTrackMeta(res.meta);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to resolve track";
      this.logger.warn?.("addSongByInput failed while resolving track", {
        videoId,
        error: message,
      });
      this.showTransientNotice("Could not load song details");
      return { ok: false, error: message };
    }
  }

  private enqueueTrackMeta(meta: QueueTrackMeta): ListenTogetherActionResult {
    if (this.sessionMode === "host" && this.roomState) {
      const hostMember = this.roomState.members[this.roomState.hostPeerId];
      const track: QueueTrack = {
        entryId: crypto.randomUUID(),
        videoId: meta.videoId,
        title: meta.title,
        author: meta.author,
        durationSec: meta.durationSec,
        thumbnailUrl: meta.thumbnailUrl,
        addedBy: this.roomState.hostPeerId,
        addedByName: hostMember?.displayName ?? this.displayName,
        addedAtMs: this.nowMs(),
        source: "dj",
        pinned: false,
      };
      this.lastDjVideoId = meta.videoId;
      this.dispatchRoomEvent({
        type: "QUEUE_ADD",
        actorId: this.roomState.hostPeerId,
        track,
      });
      return { ok: true };
    }

    if (this.sessionMode === "guest") {
      this.sendGuestAppMessage({
        type: "QUEUE_ADD",
        videoId: meta.videoId,
        title: meta.title,
        author: meta.author,
        durationSec: meta.durationSec,
        thumbnailUrl: meta.thumbnailUrl,
      });
      return { ok: true };
    }

    return { ok: false, error: "Not in a room" };
  }

  private dispatchRoomEvent(event: RoomEvent): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    const prevState = this.roomState;
    const { state: nextState, effects } = reduceRoomEvent(
      prevState,
      event,
      this.nowMs(),
      this.logger,
    );
    this.roomState = nextState;

    if (
      nextState.currentTrack &&
      nextState.currentTrack.entryId !== prevState.currentTrack?.entryId
    ) {
      this.recordRoomHistoryTrack(nextState.currentTrack);
      if (nextState.currentTrack.source === "dj") {
        this.lastDjVideoId = nextState.currentTrack.videoId;
      }
      if (
        prevState.currentTrack &&
        event.type === "TRACK_UNAVAILABLE" &&
        prevState.seq !== nextState.seq
      ) {
        this.showTransientNotice(
          `Skipped '${prevState.currentTrack.title}' — unavailable`,
        );
      }
    }

    if (
      event.type === "HOST_UPDATE_SETTINGS" &&
      nextState.settings.autoplayMode === "off" &&
      prevState.settings.autoplayMode !== "off"
    ) {
      this.dispatchRoomEvent({
        type: "AUTOPLAY_CANDIDATES",
        actorId: nextState.hostPeerId,
        candidates: [],
      });
    }

    this.executeRoomEffects(effects);
    if (
      event.type !== "AUTOPLAY_DISMISS" ||
      nextState.scheduler.autoplayPool.length === 0
    ) {
      if (
        event.type === "AUTOPLAY_DISMISS" &&
        nextState.scheduler.autoplayPool.length === 0
      ) {
        this.autoplayFetchInFlightKey = null;
      }
      this.maybeRequestLazyAutoplay();
    }
    this.emitStateChanged();
  }

  private recordRoomHistoryTrack(track: QueueTrack): void {
    this.roomHistoryTracks = [
      ...this.roomHistoryTracks.filter((t) => t.videoId !== track.videoId),
      track,
    ].slice(-25);
  }

  private executeRoomEffects(effects: RoomEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "SEND_ROOM_SNAPSHOT": {
          this.sendEncryptedToPeer(effect.peerId, {
            type: "ROOM_SNAPSHOT",
            epoch: effect.epoch,
            roomId: effect.roomId,
            settings: effect.settings,
            members: effect.members,
            currentTrack: effect.currentTrack,
            anchor: effect.anchor,
            queue: effect.queue,
            autoplayNext: effect.autoplayNext,
            history: effect.history,
            skipVotes: effect.skipVotes,
          });
          break;
        }

        case "BROADCAST_SYNC_ANCHOR": {
          this.broadcastEncryptedToPeers({
            type: "SYNC_ANCHOR",
            epoch: effect.epoch,
            anchor: effect.anchor,
          });
          void this.applyAnchorToLocalView(effect.anchor);
          break;
        }

        case "BROADCAST_QUEUE_UPDATED": {
          this.broadcastEncryptedToPeers({
            type: "QUEUE_UPDATED",
            epoch: effect.epoch,
            currentTrack: effect.currentTrack,
            queue: effect.queue,
            autoplayNext: effect.autoplayNext,
            history: effect.history,
            skipVotes: effect.skipVotes,
          });
          break;
        }

        case "BROADCAST_MEMBERS_UPDATED": {
          this.broadcastEncryptedToPeers({
            type: "MEMBERS_UPDATED",
            epoch: effect.epoch,
            members: effect.members,
          });
          break;
        }

        case "BROADCAST_SETTINGS_UPDATED": {
          this.broadcastEncryptedToPeers({
            type: "SETTINGS_UPDATED",
            epoch: effect.epoch,
            settings: effect.settings,
          });
          break;
        }

        case "SEND_ACTION_REJECTED": {
          if (this.roomState && effect.peerId === this.roomState.hostPeerId) {
            this.applyActionRejectedFeedback(
              effect.reason,
              effect.retryAfterMs,
            );
          } else {
            this.sendEncryptedToPeer(effect.peerId, {
              type: "ACTION_REJECTED",
              reason: effect.reason,
              retryAfterMs: effect.retryAfterMs,
            });
          }
          break;
        }

        case "DISCONNECT_PEER": {
          this.kickHostPeer(effect.peerId, effect.reason);
          break;
        }

        case "SCHEDULE_TIMER": {
          this.scheduleRoomEffectTimer(effect);
          break;
        }

        case "CANCEL_TIMER": {
          this.cancelRoomEffectTimer(effect.timer, effect.peerId);
          break;
        }
      }
    }
  }

  private scheduleRoomEffectTimer(
    effect: Extract<RoomEffect, { type: "SCHEDULE_TIMER" }>,
  ): void {
    if (effect.timer === "LOADING_BARRIER") {
      if (this.loadingBarrierTimer) {
        clearTimeout(this.loadingBarrierTimer);
      }
      const delayMs = effect.delayMs ?? LOADING_BARRIER_TIMEOUT_MS;
      this.loadingBarrierTimer = setTimeout(() => {
        this.loadingBarrierTimer = null;
        if (this.sessionMode === "host" && this.roomState) {
          this.dispatchRoomEvent({ type: "TICK" });
        }
      }, delayMs);
      return;
    }

    if (effect.timer === "AD_STUCK" && effect.peerId) {
      const prev = this.adStuckTimers.get(effect.peerId);
      if (prev) clearTimeout(prev);
      const peerId = effect.peerId;
      const delayMs = effect.delayMs ?? AD_STUCK_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.adStuckTimers.delete(peerId);
        if (this.sessionMode === "host" && this.roomState) {
          this.dispatchRoomEvent({ type: "TICK" });
        }
      }, delayMs);
      this.adStuckTimers.set(peerId, timer);
    }
  }

  private cancelRoomEffectTimer(
    timerType: "LOADING_BARRIER" | "AD_STUCK",
    peerId?: string,
  ): void {
    if (timerType === "LOADING_BARRIER") {
      if (this.loadingBarrierTimer) {
        clearTimeout(this.loadingBarrierTimer);
        this.loadingBarrierTimer = null;
      }
      return;
    }

    if (peerId) {
      const existing = this.adStuckTimers.get(peerId);
      if (existing) {
        clearTimeout(existing);
        this.adStuckTimers.delete(peerId);
      }
      return;
    }

    for (const timer of this.adStuckTimers.values()) {
      clearTimeout(timer);
    }
    this.adStuckTimers.clear();
  }

  private startHostDurationTicker(): void {
    if (this.hostDurationTickTimer) {
      clearInterval(this.hostDurationTickTimer);
    }
    this.hostDurationTickTimer = setInterval(() => {
      if (this.sessionMode !== "host" || !this.roomState) return;
      if (
        this.roomState.desiredPlaybackState === "PLAYING" &&
        !this.roomState.pausedForAd &&
        this.roomState.currentTrack !== null &&
        projectLivePosSec(this.roomState, this.nowMs()) >=
          this.roomState.currentTrack.durationSec
      ) {
        this.dispatchRoomEvent({ type: "TICK" });
      }
    }, HOST_DURATION_TICK_MS);
  }

  private dispatchHistoryAutoplayFallback(state: RoomState): void {
    const eligible = this.roomHistoryTracks.filter(
      (t) => !this.dismissedAutoplayVideoIds.has(t.videoId),
    );
    if (eligible.length === 0) {
      this.logger.info?.("Autoplay history fallback exhausted after dismissals");
      return;
    }
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const candidates: QueueTrack[] = shuffled.slice(0, 5).map((t) => ({
      ...t,
      entryId: crypto.randomUUID(),
      addedBy: state.hostPeerId,
      addedByName:
        state.members[state.hostPeerId]?.displayName ?? this.displayName,
      addedAtMs: this.nowMs(),
      source: "autoplay",
      pinned: false,
    }));
    this.dispatchRoomEvent({
      type: "AUTOPLAY_CANDIDATES",
      actorId: state.hostPeerId,
      candidates,
    });
  }

  private maybeRequestLazyAutoplay(): void {
    if (this.sessionMode !== "host" || !this.roomState) return;
    const state = this.roomState;
    if (state.settings.autoplayMode === "off") return;

    const djQueueCount = materializeQueue(state.scheduler).length;
    if (djQueueCount > 1 || state.scheduler.autoplayPool.length > 2) return;

    if (state.settings.autoplayMode === "history") {
      this.dispatchHistoryAutoplayFallback(state);
      return;
    }

    const seedVideoId =
      this.lastDjVideoId ?? state.currentTrack?.videoId ?? null;
    if (!seedVideoId) return;

    const fetchKey = `${seedVideoId}:${state.seq}`;
    if (this.autoplayFetchInFlightKey === fetchKey) return;
    this.autoplayFetchInFlightKey = fetchKey;

    void this.fetchAndApplyHostAutoplayCandidates(seedVideoId, fetchKey);
  }

  private async fetchAndApplyHostAutoplayCandidates(
    seedVideoId: string,
    fetchKey: string,
  ): Promise<void> {
    try {
      await this.ensureProtectedApiPortReady();
      const [res] = (await this.listenTogetherApi.invokeMessage(
        "fetchAutoplayCandidates",
        { videoId: seedVideoId, limit: 5 },
      )) as [
        | { ok: true; candidates: QueueTrackMeta[] }
        | { ok: false; error: string },
      ];
      if (
        this.sessionMode !== "host" ||
        !this.roomState ||
        this.autoplayFetchInFlightKey !== fetchKey
      ) {
        return;
      }
      if (!res || !res.ok || res.candidates.length === 0) {
        if (!res || !res.ok) {
          this.logger.warn?.("fetchAutoplayCandidates returned error", {
            seedVideoId,
            error: res?.error ?? "EMPTY_RESPONSE",
          });
        }
        this.dispatchHistoryAutoplayFallback(this.roomState);
        return;
      }
      const hostName =
        this.roomState.members[this.roomState.hostPeerId]?.displayName ??
        this.displayName;
      const now = this.nowMs();
      const filteredCandidates = res.candidates.filter(
        (c) => !this.dismissedAutoplayVideoIds.has(c.videoId),
      );
      if (filteredCandidates.length === 0) {
        this.logger.info?.("All fetched autoplay candidates were dismissed; trying history fallback", {
          seedVideoId,
          dismissedCount: this.dismissedAutoplayVideoIds.size,
        });
        this.dispatchHistoryAutoplayFallback(this.roomState);
        return;
      }
      const tracks: QueueTrack[] = filteredCandidates.slice(0, 5).map((c) => ({
        entryId: crypto.randomUUID(),
        videoId: c.videoId,
        title: c.title,
        author: c.author,
        durationSec: c.durationSec,
        thumbnailUrl: c.thumbnailUrl,
        addedBy: this.roomState!.hostPeerId,
        addedByName: hostName,
        addedAtMs: now,
        source: "autoplay",
        pinned: false,
      }));
      this.dispatchRoomEvent({
        type: "AUTOPLAY_CANDIDATES",
        actorId: this.roomState.hostPeerId,
        candidates: tracks,
      });
    } catch (err) {
      this.logger.warn?.("Autoplay candidate fetch failed", {
        seedVideoId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (this.autoplayFetchInFlightKey === fetchKey) {
        this.autoplayFetchInFlightKey = null;
      }
    }
  }

  private async connectHostRelays(
    lookupId: string,
    roomId: string,
    isReconnect = false,
  ): Promise<void> {
    if (!this.signalingUrl || !this.hostKeypair) {
      this.primaryRelayConnected = false;
      return;
    }

    const mode = isReconnect ? "resume" : "create";
    const results = await Promise.allSettled([
      this.registerRelayLookupClient(lookupId, mode, true),
      this.registerRelayLookupClient(roomId, mode, false),
    ]);

    const anySucceeded = results.some((r) => r.status === "fulfilled");
    this.primaryRelayConnected = anySucceeded;

    this.logger.info?.("Host relay registration completed", {
      roomId,
      mode,
      anySucceeded,
      url: redactLogUrl(this.signalingUrl),
    });

    if (anySucceeded && isReconnect && this.roomState) {
      const prevEpoch = this.roomState.epoch;
      const nextEpoch = prevEpoch + 1;
      this.roomState = {
        ...this.roomState,
        epoch: nextEpoch,
      };
      this.logger.info?.(
        "Host relay reconnected; incremented room epoch and broadcast SYNC_ANCHOR",
        {
          roomId: this.roomState.roomId,
          prevEpoch,
          epoch: nextEpoch,
          seq: this.roomState.seq,
        },
      );
      this.broadcastEncryptedToPeers({
        type: "SYNC_ANCHOR",
        epoch: nextEpoch,
        anchor: buildPlaybackAnchor(this.roomState),
      });
      this.emitStateChanged();
    }
  }

  private async registerRelayLookupClient(
    lookupId: string,
    mode: "create" | "resume",
    trackPrimaryDisconnect = false,
  ): Promise<void> {
    if (
      !this.signalingUrl ||
      !this.hostKeypair ||
      this.sessionMode !== "host"
    ) {
      return;
    }

    const relayOptions: RelayHostClientOptions = {
      signalingUrl: this.signalingUrl,
      lookupId,
      hostPubKeyB64: this.hostKeypair.publicKeyB64,
      hostPrivKey: this.hostKeypair.privateKey,
      allowPrivateLiteral: true,
      logger: this.logger,
      ...this.injectedDeps.relayHostClientOptions,
    };
    const client = this.injectedDeps.createRelayHostClient
      ? this.injectedDeps.createRelayHostClient(relayOptions)
      : new RelayHostClient(relayOptions);

    client.onPeerConnection((conn) => {
      this.handleHostIncomingConnection(conn, client);
    });

    client.onClose((code, reason) => {
      this.relayClients.delete(client);
      if (this.sessionMode !== "host" || this.terminated) return;
      this.logger.warn?.("Host relay connection closed", {
        trackPrimaryDisconnect,
        code,
        reason,
        url: this.signalingUrl ? redactLogUrl(this.signalingUrl) : null,
      });
      if (trackPrimaryDisconnect) {
        this.primaryRelayConnected = false;
        this.scheduleHostRelayReconnect();
        this.emitStateChanged();
      }
    });

    await client.connect(mode);
    if (this.sessionMode !== "host" || this.terminated) {
      client.close();
      return;
    }
    this.relayClients.add(client);
    if (trackPrimaryDisconnect) {
      this.primaryRelayConnected = true;
      this.hostRelayReconnectAttempts = 0;
    }
  }

  private scheduleHostRelayReconnect(): void {
    if (
      this.hostRelayReconnectTimer ||
      this.sessionMode !== "host" ||
      !this.signalingUrl ||
      !this.roomLookupId ||
      !this.roomState
    ) {
      return;
    }
    const delayMs = Math.min(
      8_000,
      1_000 * 2 ** this.hostRelayReconnectAttempts,
    );
    this.hostRelayReconnectAttempts += 1;
    this.logger.info?.("Scheduling Host relay reconnect", {
      roomId: this.roomState.roomId,
      attempt: this.hostRelayReconnectAttempts,
      delayMs,
    });
    this.hostRelayReconnectTimer = setTimeout(() => {
      this.hostRelayReconnectTimer = null;
      if (
        this.sessionMode === "host" &&
        this.roomLookupId &&
        this.roomState &&
        !this.terminated
      ) {
        void this.connectHostRelays(
          this.roomLookupId,
          this.roomState.roomId,
          true,
        );
      }
    }, delayMs);
  }

  private rebuildHostInviteUrl(): void {
    if (!this.roomState || !this.hostKeypair || !this.roomInviteToken) {
      this.roomInviteUrl = null;
      return;
    }
    const envelope = signInviteEnvelope(
      {
        r: this.roomState.roomId,
        k: this.hostKeypair.publicKeyB64,
        t: this.roomInviteToken.toString("base64url"),
        ep:
          this.roomDirectEndpoints.length > 0
            ? this.roomDirectEndpoints
            : undefined,
        sig: this.signalingUrl ?? undefined,
        tc: this.roomTailcatAddress ?? undefined,
        tcp: this.roomTailcatRemotePort ?? undefined,
        te: this.roomTokenEpoch,
      },
      this.hostKeypair.privateKey,
    );
    this.roomInviteUrl = encodeInviteUrl(envelope, this.logger);
    this.roomShortCode = null;
    this.roomShortInviteUrl = null;
    void this.publishShortInviteToRelay();
  }

  private handleHostIncomingConnection(
    conn: TransportConnection,
    relayClient: RelayHostClient | null,
  ): void {
    if (
      this.sessionMode !== "host" ||
      !this.roomState ||
      !this.hostKeypair ||
      !this.roomSalt ||
      !this.roomLookupId
    ) {
      conn.close(1008, "Room closed");
      return;
    }

    const handshake = createHostHandshake({
      roomId: this.roomState.roomId,
      lookupId: this.roomLookupId,
      epoch: this.roomState.epoch,
      roomSalt: this.roomSalt,
      hostKeypair: this.hostKeypair,
      roomInviteToken: this.roomInviteToken ?? undefined,
      roomTokenEpoch: this.roomTokenEpoch,
      passcodeAuthKey: this.roomPasscodeAuthKey ?? undefined,
      authGuard: this.authGuard ?? undefined,
      peerRateKey: conn.remoteLabel,
      logger: this.logger,
    });

    let stage: "await_hello" | "await_auth" | "authenticated" = "await_hello";
    let settled = false;

    const handshakeTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanupHandshakeListeners();
        this.logger.warn?.("Host incoming peer handshake timed out", {
          remoteLabel: redactLogUrl(conn.remoteLabel),
          stage,
        });
        conn.close(1008, "Handshake timeout");
      }
    }, HANDSHAKE_TIMEOUT_MS);

    const failHandshake = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimer);
      cleanupHandshakeListeners();
      const reason =
        err instanceof HandshakeError ? err.code : "HANDSHAKE_FAILED";
      this.logger.warn?.("Host incoming peer handshake failed", {
        remoteLabel: redactLogUrl(conn.remoteLabel),
        stage,
        reason,
      });
      conn.close(1008, reason);
    };

    const onMessage = (buf: Buffer) => {
      if (stage === "authenticated") return;
      if (buf.length > MAX_HANDSHAKE_JSON_BYTES) {
        failHandshake(
          new HandshakeError("MALFORMED", "Handshake frame too big"),
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.toString("utf8"));
      } catch {
        failHandshake(new HandshakeError("MALFORMED", "Invalid JSON"));
        return;
      }

      try {
        if (stage === "await_hello") {
          const hello = parsed as ClientHello;
          const hostHello = handshake.receiveClientHello(hello);
          stage = "await_auth";
          conn.send(Buffer.from(JSON.stringify(hostHello), "utf8"));
          return;
        }

        if (stage === "await_auth") {
          const authWithMeta = parsed as ClientAuth & { displayName?: unknown };
          const guestName = sanitizeDisplayName(
            typeof authWithMeta.displayName === "string"
              ? authWithMeta.displayName
              : "Friend",
          );
          const result = handshake.verifyClientAuth(authWithMeta);

          if (
            !this.roomState ||
            (!this.roomState.members[result.clientIdentityPubB64] &&
              Object.keys(this.roomState.members).length >= MAX_ROOM_MEMBERS)
          ) {
            settled = true;
            clearTimeout(handshakeTimer);
            cleanupHandshakeListeners();
            this.logger.warn?.("Rejected guest connection: room full", {
              roomId: this.roomState?.roomId ?? null,
              peerId: result.clientIdentityPubB64,
              maxMembers: MAX_ROOM_MEMBERS,
            });
            conn.close(1008, "Room full");
            return;
          }

          stage = "authenticated";
          settled = true;
          clearTimeout(handshakeTimer);
          cleanupHandshakeListeners();

          conn.send(Buffer.from(JSON.stringify(result.serverAuth), "utf8"));
          if (relayClient) {
            relayClient.admitPeer(conn.id);
          }

          this.attachAuthenticatedHostPeer({
            peerId: result.clientIdentityPubB64,
            displayName: guestName,
            conn,
            session: result.session,
            relayClient,
            consumedAuthBuffer: buf,
          });
        }
      } catch (err) {
        failHandshake(err);
      }
    };

    const onClose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        cleanupHandshakeListeners();
      }
    };

    const onError = () => {
      failHandshake(new Error("Socket error during handshake"));
    };

    const unsubMsg = conn.onMessage(onMessage);
    const unsubClose = conn.onClose(onClose);
    const unsubError = conn.onError(onError);

    function cleanupHandshakeListeners(): void {
      unsubMsg();
      unsubClose();
      unsubError();
    }
  }

  private attachAuthenticatedHostPeer(params: {
    peerId: string;
    displayName: string;
    conn: TransportConnection;
    session: LinkSession;
    relayClient: RelayHostClient | null;
    consumedAuthBuffer?: Buffer;
  }): void {
    const existing = this.hostPeers.get(params.peerId);
    if (existing) {
      this.logger.info?.(
        "Replacing existing connection for authenticated peer",
        {
          peerId: params.peerId,
        },
      );
      existing.unsubMessage();
      existing.unsubClose();
      existing.unsubError();
      this.hostPeers.delete(params.peerId);
      existing.conn.close(1000, "Replaced by newer connection");
    }

    let consumedAuthBuffer: Buffer | null = params.consumedAuthBuffer ?? null;
    queueMicrotask(() => {
      consumedAuthBuffer = null;
    });

    const unsubMessage = params.conn.onMessage((buf) => {
      if (consumedAuthBuffer && buf === consumedAuthBuffer) {
        consumedAuthBuffer = null;
        return;
      }
      consumedAuthBuffer = null;
      this.handleHostEncryptedPeerFrame(params.peerId, buf);
    });

    const unsubClose = params.conn.onClose((code, reason) => {
      const current = this.hostPeers.get(params.peerId);
      if (current?.conn === params.conn) {
        current.unsubMessage();
        current.unsubClose();
        current.unsubError();
        this.hostPeers.delete(params.peerId);
        this.logger.info?.("Authenticated peer disconnected", {
          peerId: params.peerId,
          code,
          reason,
        });
        if (this.sessionMode === "host" && this.roomState) {
          this.dispatchRoomEvent({ type: "PEER_LEFT", peerId: params.peerId });
        }
      }
    });

    const unsubError = params.conn.onError((err) => {
      this.logger.warn?.("Host peer connection error", {
        peerId: params.peerId,
        error: err.message,
      });
    });

    this.hostPeers.set(params.peerId, {
      peerId: params.peerId,
      conn: params.conn,
      session: params.session,
      relayClient: params.relayClient,
      unsubMessage,
      unsubClose,
      unsubError,
    });

    this.dispatchRoomEvent({
      type: "PEER_JOINED",
      peerId: params.peerId,
      displayName: params.displayName,
      transport: params.conn.mode,
    });

    if (
      this.roomOwnerPubKey &&
      this.hostKeypair &&
      this.hostKeypair.publicKeyB64 !== this.roomOwnerPubKey &&
      params.peerId === this.roomOwnerPubKey
    ) {
      this.logger.info?.("Original room owner rejoined; reclaiming host", {
        ownerPubKey: this.roomOwnerPubKey,
      });
      setTimeout(() => {
        if (
          this.sessionMode === "host" &&
          this.hostPeers.has(params.peerId)
        ) {
          void this.initiateHostMigration(
            params.peerId,
            "host-reclaimed",
            true,
          );
        }
      }, 200);
    }
  }

  private handleHostEncryptedPeerFrame(peerId: string, frame: Buffer): void {
    const peer = this.hostPeers.get(peerId);
    if (!peer || this.sessionMode !== "host" || !this.roomState) return;

    let plaintext: Buffer;
    try {
      plaintext = decryptFrame(peer.session, frame, this.logger);
    } catch (err) {
      this.logger.warn?.("Host decryptFrame failed", {
        peerId,
        byteLength: frame.length,
        error: err instanceof Error ? err.message : String(err),
      });
      peer.conn.close(1008, "Decryption failed");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString("utf8"));
    } catch {
      this.logger.warn?.("Host received non-JSON decrypted peer message", {
        peerId,
      });
      return;
    }

    const msg = decodeAppMessage(parsed, this.logger);
    if (!msg) return;

    switch (msg.type) {
      case "PING": {
        const t1 = this.nowMs();
        this.sendEncryptedToPeer(peerId, {
          type: "PONG",
          pingId: msg.pingId,
          t0: msg.t0,
          t1,
          t2: this.nowMs(),
        });
        return;
      }

      case "TRACK_READY": {
        this.dispatchRoomEvent({
          type: "TRACK_READY",
          peerId,
          seq: msg.seq,
        });
        return;
      }

      case "TRACK_ENDED": {
        this.dispatchRoomEvent({
          type: "TRACK_ENDED",
          peerId,
          seq: msg.seq,
        });
        return;
      }

      case "TRACK_UNAVAILABLE": {
        this.dispatchRoomEvent({
          type: "TRACK_UNAVAILABLE",
          peerId,
          seq: msg.seq,
          errorCode: msg.errorCode,
        });
        return;
      }

      case "AD_STARTED": {
        this.dispatchRoomEvent({
          type: "AD_STARTED",
          peerId,
          seq: msg.seq,
        });
        return;
      }

      case "AD_ENDED": {
        this.dispatchRoomEvent({
          type: "AD_ENDED",
          peerId,
          seq: msg.seq,
        });
        return;
      }

      case "QUEUE_ADD": {
        const member = this.roomState.members[peerId];
        const track: QueueTrack = {
          entryId: crypto.randomUUID(),
          videoId: msg.videoId,
          title: msg.title,
          author: msg.author,
          durationSec: msg.durationSec,
          thumbnailUrl: msg.thumbnailUrl,
          addedBy: peerId,
          addedByName: member?.displayName ?? "Friend",
          addedAtMs: this.nowMs(),
          source: "dj",
          pinned: false,
        };
        this.lastDjVideoId = msg.videoId;
        this.dispatchRoomEvent({
          type: "QUEUE_ADD",
          actorId: peerId,
          track,
        });
        return;
      }

      case "QUEUE_REMOVE": {
        this.dispatchRoomEvent({
          type: "QUEUE_REMOVE",
          actorId: peerId,
          entryId: msg.entryId,
        });
        return;
      }

      case "QUEUE_PIN_NEXT": {
        this.dispatchRoomEvent({
          type: "QUEUE_PIN_NEXT",
          actorId: peerId,
          entryId: msg.entryId,
        });
        return;
      }

      case "QUEUE_UNPIN": {
        this.dispatchRoomEvent({
          type: "QUEUE_UNPIN",
          actorId: peerId,
          entryId: msg.entryId,
        });
        return;
      }

      case "QUEUE_REORDER": {
        this.dispatchRoomEvent({
          type: "QUEUE_REORDER",
          actorId: peerId,
          entryId: msg.entryId,
          targetIndex: msg.targetIndex,
        });
        return;
      }

      case "HOST_JUMP_TRACK": {
        this.dispatchRoomEvent({
          type: "HOST_JUMP_TRACK",
          actorId: peerId,
          target: msg.target,
          entryId: msg.entryId,
        });
        return;
      }

      case "VOTE_SKIP": {
        this.dispatchRoomEvent({
          type: "VOTE_SKIP",
          peerId,
          seq: msg.seq,
        });
        return;
      }

      case "SET_LISTENING_MODE": {
        this.dispatchRoomEvent({
          type: "MEMBER_LISTENING_MODE",
          peerId,
          listeningMode: msg.listeningMode,
        });
        return;
      }

      case "HOST_MIGRATION_READY": {
        if (this.pendingMigrationResolve) {
          this.pendingMigrationResolve(msg.newInviteUrl);
        }
        return;
      }

      case "AUTOPLAY_CANDIDATES": {
        const member = this.roomState.members[peerId];
        const now = this.nowMs();
        const candidates: QueueTrack[] = msg.candidates
          .slice(0, 5)
          .map((c) => ({
            entryId: crypto.randomUUID(),
            videoId: c.videoId,
            title: c.title,
            author: c.author,
            durationSec: c.durationSec,
            thumbnailUrl: c.thumbnailUrl,
            addedBy: peerId,
            addedByName: member?.displayName ?? "Friend",
            addedAtMs: now,
            source: "autoplay",
            pinned: false,
          }));
        this.dispatchRoomEvent({
          type: "AUTOPLAY_CANDIDATES",
          actorId: peerId,
          candidates,
        });
        return;
      }

      case "HOST_TRANSPORT":
      case "HOST_FORCE_RESUME_FROM_AD":
      case "HOST_MODERATION":
      case "HOST_UPDATE_SETTINGS": {
        this.dispatchRoomEvent({
          ...msg,
          actorId: peerId,
        });
        return;
      }
    }
  }

  private kickHostPeer(peerId: string, reason: "kicked"): void {
    this.authGuard?.banPeer(peerId);
    this.roomTokenEpoch += 1;
    this.rebuildHostInviteUrl();
    this.logger.info?.("Kicked peer and rotated token epoch", {
      peerId,
      reason,
      tokenEpoch: this.roomTokenEpoch,
    });

    const peer = this.hostPeers.get(peerId);
    if (peer) {
      this.sendEncryptedToPeer(peerId, {
        type: "ROOM_ENDED",
        reason,
        queueSnapshot: [],
      });
      peer.unsubMessage();
      peer.unsubClose();
      peer.unsubError();
      this.hostPeers.delete(peerId);
      if (peer.relayClient) {
        peer.relayClient.dropPeer(peerId, "Kicked by host");
      } else {
        peer.conn.close(1000, "Kicked by host");
      }
    }
  }

  private sendEncrypted(
    conn: TransportConnection,
    session: LinkSession,
    serialized: string,
    msgType: AppMessage["type"],
    logLabel: string,
    extraContext?: Record<string, unknown>,
  ): void {
    try {
      const frame = encryptFrame(session, serialized, this.logger);
      conn.send(frame);
    } catch (err) {
      this.logger.warn?.(logLabel, {
        ...extraContext,
        type: msgType,
        error: err instanceof Error ? err.message : String(err),
      });
      conn.close(1008, "Rekey required");
    }
  }

  private sendEncryptedToPeer(peerId: string, msg: AppMessage): void {
    const peer = this.hostPeers.get(peerId);
    if (!peer || !peer.conn.isOpen) return;
    this.sendEncrypted(
      peer.conn,
      peer.session,
      JSON.stringify(msg),
      msg.type,
      "Failed to encrypt/send message to peer",
      { peerId },
    );
  }

  private broadcastEncryptedToPeers(msg: AppMessage): void {
    const serialized = JSON.stringify(msg);
    for (const peer of this.hostPeers.values()) {
      if (!peer.conn.isOpen) continue;
      this.sendEncrypted(
        peer.conn,
        peer.session,
        serialized,
        msg.type,
        "Failed to broadcast encrypted message to peer",
        { peerId: peer.peerId },
      );
    }
  }

  private async executeGuestJoin(
    params: ActiveGuestJoinParams,
    displayName: string,
  ): Promise<ListenTogetherActionResult> {
    await this.teardownActiveSession({
      sendRoomEnded: false,
      unlockView: false,
    });

    this.endedState = null;
    this.pendingInvite = null;
    this.errorBanner = null;
    this.errorDetail = null;
    this.lastGuestJoinParams = params;
    this.connectingStage =
      params.kind === "passcode" ? "Checking passcode…" : "Connecting…";
    this.emitStateChanged();

    const controller = new AbortController();
    this.guestJoinAbort = controller;

    try {
      const guestKeypair = this.guestKeypair ?? generateEd25519Keypair();
      this.guestKeypair = guestKeypair;

      const result = await this.connectAndAuthenticateGuest(
        params,
        guestKeypair,
        displayName,
        controller.signal,
      );

      if (controller.signal.aborted) {
        result.connection.close(1000, "Join cancelled");
        return { ok: false, error: "Connection cancelled" };
      }

      this.guestJoinAbort = null;
      this.connectingStage = "Syncing playback…";
      this.emitStateChanged();

      this.activateGuestSession(
        result.connection,
        result.mode,
        result.auth.session,
        result.auth.earlyFrames,
      );
      this.logger.info?.("Joined Listen Together room as guest", {
        mode: result.mode,
        kind: params.kind,
      });
      return { ok: true };
    } catch (err) {
      this.guestJoinAbort = null;
      this.connectingStage = null;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeError = redactInviteUrl(redactLogUrl(rawMessage));
      if (controller.signal.aborted) {
        this.logger.info?.("Guest room join cancelled", { kind: params.kind });
        this.emitStateChanged();
        return { ok: false, error: "Connection cancelled" };
      }
      this.logger.warn?.("Guest room join failed", {
        kind: params.kind,
        error: safeError,
      });
      this.errorBanner = "Couldn't reach this room";
      this.errorDetail =
        params.kind === "passcode"
          ? "Check the room code or ask the host for a new invite link."
          : safeError;
      this.emitStateChanged();
      return { ok: false, error: rawMessage };
    }
  }

  private async connectAndAuthenticateGuest(
    params: ActiveGuestJoinParams,
    guestKeypair: Ed25519Keypair,
    displayName: string,
    signal: AbortSignal,
  ) {
    let directEndpoints: string[] = [];
    let tailcatTransport: TailcatWsTransport | null = null;
    let relayTransport: RelayWsTransport | null = null;

    if (params.kind === "url") {
      directEndpoints = params.envelope.ep ?? [];
      if (
        params.envelope.tc &&
        params.envelope.tcp &&
        (this.injectedDeps.createTailcatTransport || this.isTailcatAvailable())
      ) {
        const tcOpts: TailcatWsTransportOptions = {
          tcAddress: params.envelope.tc,
          remotePort: params.envelope.tcp,
          derpMapUrl: this.tailcatDerpMapUrl,
          logger: this.logger,
        };
        tailcatTransport = this.injectedDeps.createTailcatTransport
          ? this.injectedDeps.createTailcatTransport(tcOpts)
          : new TailcatWsTransport(tcOpts);
      }
      if (params.envelope.sig) {
        const relayOpts: RelayWsTransportOptions = {
          signalingUrl: params.envelope.sig,
          lookupId: params.envelope.r,
          allowPrivateLiteral: true,
          logger: this.logger,
          ...this.injectedDeps.relayTransportOptions,
        };
        relayTransport = this.injectedDeps.createRelayTransport
          ? this.injectedDeps.createRelayTransport(relayOpts)
          : new RelayWsTransport(relayOpts);
      }
    } else {
      const lanMatches = this.rawDiscoveredLanRooms
        .filter((r) => r.lookupId === params.lookupId)
        .map((r) => r.endpoint);
      directEndpoints = Array.from(
        new Set(
          params.lanEndpoint ? [params.lanEndpoint, ...lanMatches] : lanMatches,
        ),
      );
      if (this.signalingUrl) {
        const relayOpts: RelayWsTransportOptions = {
          signalingUrl: this.signalingUrl,
          lookupId: params.lookupId,
          allowPrivateLiteral: true,
          logger: this.logger,
          ...this.injectedDeps.relayTransportOptions,
        };
        relayTransport = this.injectedDeps.createRelayTransport
          ? this.injectedDeps.createRelayTransport(relayOpts)
          : new RelayWsTransport(relayOpts);
      }
      if (directEndpoints.length === 0 && !relayTransport) {
        throw new Error(
          "Room codes need same Wi-Fi, a friend's invite link, or a relay in Advanced.",
        );
      }
    }

    const transportManager = new TransportManager({ logger: this.logger });
    const directTransports = this.injectedDeps.createDirectWebSocket
      ? directEndpoints.map(
          (ep) =>
            new DirectWsTransport(ep, {
              timeoutMs: 3000,
              logger: this.logger,
              createWebSocket: this.injectedDeps.createDirectWebSocket,
            }),
        )
      : undefined;
    return transportManager.race<GuestAuthResult>({
      directEndpoints,
      directTransports,
      tailcatTransport,
      relayTransport,
      signal,
      authenticate: (conn, authSignal) =>
        this.authenticateGuestConnection(
          conn,
          params,
          guestKeypair,
          displayName,
          authSignal,
        ),
    });
  }

  private authenticateGuestConnection(
    conn: TransportConnection,
    params: ActiveGuestJoinParams,
    guestKeypair: Ed25519Keypair,
    displayName: string,
    signal: AbortSignal,
  ): Promise<GuestAuthResult> {
    return new Promise<GuestAuthResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Guest handshake aborted"));
        return;
      }

      const authSecret =
        params.kind === "url"
          ? Buffer.from(params.envelope.t, "base64url")
          : params.passcodeAuthKey;

      const handshake = createGuestHandshake({
        guestKeypair,
        expectedRoomId: params.kind === "url" ? params.envelope.r : undefined,
        expectedLookupId:
          params.kind === "passcode" ? params.lookupId : undefined,
        expectedHostPubKeyB64:
          params.kind === "url" ? params.envelope.k : undefined,
        authMode: params.kind === "url" ? "token" : "passcode",
        authSecret,
        tokenEpoch: params.kind === "url" ? params.envelope.te : undefined,
        logger: this.logger,
      });

      let stage: "await_host_hello" | "await_server_auth" | "done" =
        "await_host_hello";
      let settled = false;
      let session: LinkSession | null = null;
      const earlyFrames: Buffer[] = [];

      const timer = setTimeout(() => {
        this.logger.warn?.("Guest handshake timed out", {
          remoteLabel: redactLogUrl(conn.remoteLabel),
          stage,
        });
        fail(new Error("Handshake timed out"));
      }, HANDSHAKE_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        unsubMsg();
        unsubClose();
        unsubError();
      };

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        const safeErr = redactInviteUrl(
          redactLogUrl(err instanceof Error ? err.message : String(err)),
        );
        this.logger.warn?.("Guest handshake failed", {
          remoteLabel: redactLogUrl(conn.remoteLabel),
          stage,
          error: safeErr,
        });
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const onAbort = () => {
        fail(new Error("Guest handshake aborted"));
      };

      const unsubMsg = conn.onMessage((buf) => {
        if (stage === "done" && session) {
          earlyFrames.push(buf);
          return;
        }
        if (buf.length > MAX_HANDSHAKE_JSON_BYTES) {
          fail(new HandshakeError("MALFORMED", "Handshake frame too big"));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(buf.toString("utf8"));
        } catch {
          fail(new HandshakeError("MALFORMED", "Invalid handshake JSON"));
          return;
        }

        try {
          if (stage === "await_host_hello") {
            const clientAuth = handshake.receiveHostHello(parsed as HostHello);
            stage = "await_server_auth";
            conn.send(
              Buffer.from(
                JSON.stringify({ ...clientAuth, displayName }),
                "utf8",
              ),
            );
            return;
          }

          if (stage === "await_server_auth") {
            session = handshake.verifyServerAuth(parsed as ServerAuth);
            stage = "done";
            settled = true;
            // Keep collecting early encrypted frames until activateGuestSession attaches its listener.
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            unsubClose();
            unsubError();
            queueMicrotask(() => {
              unsubMsg();
            });
            resolve({ session, earlyFrames });
          }
        } catch (err) {
          fail(err);
        }
      });

      const unsubClose = conn.onClose((code, reason) => {
        fail(
          new Error(
            `Connection closed during handshake (${code}${reason ? `: ${reason}` : ""})`,
          ),
        );
      });

      const unsubError = conn.onError((err) => {
        fail(err);
      });

      signal.addEventListener("abort", onAbort, { once: true });

      try {
        const clientHello = handshake.createClientHello();
        conn.send(Buffer.from(JSON.stringify(clientHello), "utf8"));
      } catch (err) {
        fail(err);
      }
    });
  }

  private activateGuestSession(
    conn: TransportConnection,
    mode: TransportMode,
    session: LinkSession,
    earlyFrames: Buffer[],
  ): void {
    const wasInGraceWindow = this.guestGraceTimer !== null;
    const remainingGraceMs = this.guestGraceRemainingMs;
    this.cleanupGuestTransportOnly();

    this.sessionMode = "guest";
    this.guestConn = conn;
    this.guestTransportMode = mode;
    this.guestSession = session;
    this.guestReconnecting = false;
    this.clearGuestGraceTimers();

    if (wasInGraceWindow) {
      this.logger.info?.("Recovered connection to Host within grace window", {
        roomId: this.guestRoomId,
        mode,
        remainingGraceMs,
      });
    }

    if (!this.guestClockSync) {
      this.guestClockSync = new ClockSync(this.logger);
    } else {
      this.guestClockSync.reset();
    }
    if (!this.guestDriftController) {
      this.guestDriftController = new DriftController(this.logger);
    } else {
      this.guestDriftController.reset();
    }

    this.arbiter.setSessionState({
      active: true,
      isHost: false,
      listeningMode: this.listeningMode,
    });
    void this.applySessionLockToView(
      true,
      false,
      this.guestCurrentTrack?.videoId ?? null,
      this.listeningMode,
    );

    const unsubMsg = conn.onMessage((buf) => {
      this.handleGuestEncryptedFrame(buf);
    });
    const unsubClose = conn.onClose(() => {
      if (this.guestConn === conn) {
        this.handleGuestUnexpectedDisconnect();
      }
    });
    const unsubError = conn.onError((err) => {
      this.logger.warn?.("Guest transport error", { error: err.message });
    });
    this.guestConnUnsubs = [unsubMsg, unsubClose, unsubError];

    for (const frame of earlyFrames) {
      this.handleGuestEncryptedFrame(frame);
    }

    this.startGuestClockSync();
    this.emitStateChanged();
  }

  private handleGuestEncryptedFrame(frame: Buffer): void {
    if (this.sessionMode !== "guest" || !this.guestSession) return;

    let plaintext: Buffer;
    try {
      plaintext = decryptFrame(this.guestSession, frame, this.logger);
    } catch (err) {
      this.logger.warn?.("Guest decryptFrame failed", {
        byteLength: frame.length,
        error: err instanceof Error ? err.message : String(err),
      });
      this.guestConn?.close(1008, "Decryption failed");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString("utf8"));
    } catch {
      this.logger.warn?.("Guest received non-JSON decrypted message");
      return;
    }

    const msg = decodeAppMessage(parsed, this.logger);
    if (!msg) return;

    switch (msg.type) {
      case "PONG": {
        const sentAt = this.pendingPings.get(msg.pingId);
        if (sentAt !== undefined) {
          this.pendingPings.delete(msg.pingId);
          this.guestClockSync?.recordSample(
            msg.t0,
            msg.t1,
            msg.t2,
            this.nowMs(),
          );
        }
        return;
      }

      case "ROOM_SNAPSHOT": {
        this.connectingStage = null;
        this.guestRoomId = msg.roomId;
        this.guestSettings = msg.settings;
        this.guestMembers = msg.members;
        this.guestCurrentTrack = msg.currentTrack;
        this.guestAnchor = msg.anchor;
        this.guestQueue = msg.queue;
        this.guestHistory = msg.history ?? [];
        this.guestSkipVotes = msg.skipVotes ?? [];
        this.guestAutoplayNext = msg.autoplayNext;
        this.guestLastKnownQueueSnapshot = msg.currentTrack
          ? [msg.currentTrack, ...msg.queue]
          : [...msg.queue];
        this.handleEpochChange("ROOM_SNAPSHOT", msg.epoch);
        void this.applyAnchorToLocalView(msg.anchor);
        this.recordRecentRoom();
        this.emitStateChanged();
        return;
      }

      case "SYNC_ANCHOR": {
        this.guestAnchor = msg.anchor;
        this.handleEpochChange("SYNC_ANCHOR", msg.epoch);
        void this.applyAnchorToLocalView(msg.anchor);
        void this.applySessionLockToView(
          true,
          false,
          this.guestCurrentTrack?.videoId ?? null,
          this.listeningMode,
        );
        this.emitStateChanged();
        return;
      }

      case "QUEUE_UPDATED": {
        this.guestCurrentTrack = msg.currentTrack;
        this.guestQueue = msg.queue;
        if (msg.history !== undefined) {
          this.guestHistory = msg.history;
        }
        if (msg.skipVotes !== undefined) {
          this.guestSkipVotes = msg.skipVotes;
        }
        this.guestAutoplayNext = msg.autoplayNext;
        this.guestLastKnownQueueSnapshot = msg.currentTrack
          ? [msg.currentTrack, ...msg.queue]
          : [...msg.queue];
        this.emitStateChanged();
        return;
      }

      case "MEMBERS_UPDATED": {
        const prevRole = this.getLocalRole();
        this.guestMembers = msg.members;
        const nextRole = this.getLocalRole();
        if (prevRole !== nextRole) {
          void this.applySessionLockToView(
            true,
            false,
            this.guestCurrentTrack?.videoId ?? null,
            this.listeningMode,
          );
          if (nextRole === "listener") {
            this.showTransientNotice(
              "You are now a Listener — only Host/DJs can queue songs",
            );
          } else if (nextRole === "dj") {
            this.showTransientNotice("You are now a DJ — you can add songs");
          }
        }
        this.emitStateChanged();
        return;
      }

      case "SETTINGS_UPDATED": {
        this.guestSettings = msg.settings;
        this.emitStateChanged();
        return;
      }

      case "ACTION_REJECTED": {
        this.applyActionRejectedFeedback(msg.reason, msg.retryAfterMs);
        this.emitStateChanged();
        return;
      }

      case "ROOM_ENDED": {
        const hostName =
          this.guestMembers.find((m) => m.role === "admin")?.displayName ??
          null;
        const snapshot =
          msg.queueSnapshot.length > 0
            ? msg.queueSnapshot
            : this.guestLastKnownQueueSnapshot;
        void this.transitionToEndedState({
          reason: msg.reason,
          hostName,
          queueSnapshot: snapshot,
        });
        return;
      }

      case "HOST_MIGRATION_PREPARE": {
        const oldConn = this.guestConn;
        const oldSession = this.guestSession;
        // Detach oldConn before createRoom() calls teardownActiveSession so it stays open to send HOST_MIGRATION_READY
        this.guestConn = null;
        this.guestSession = null;
        for (const unsub of this.guestConnUnsubs) unsub();
        this.guestConnUnsubs = [];
        void this.createRoom({
          displayName: this.displayName,
          initialQueue: msg.queueSnapshot,
          initialPositionSec: msg.initialPositionSec,
          initialSettings: msg.settings,
          ownerPubKey: msg.ownerPubKey,
        }).then((res) => {
          if (oldConn && oldSession) {
            try {
              if (res.ok && this.roomInviteUrl) {
                const payload = Buffer.from(
                  JSON.stringify({
                    type: "HOST_MIGRATION_READY",
                    newHostPeerId: this.hostKeypair?.publicKeyB64 ?? "",
                    newInviteUrl: this.roomInviteUrl,
                  }),
                  "utf8",
                );
                oldConn.send(encryptFrame(oldSession, payload, this.logger));
              }
            } catch {
              // Ignore if old host already disconnected
            } finally {
              oldConn.close(1000, "Migrated to host");
            }
          }
        });
        return;
      }

      case "HOST_MIGRATED": {
        this.logger.info?.("Following HOST_MIGRATED to new host", {
          newHostPeerId: msg.newHostPeerId,
          reason: msg.reason,
        });
        void this.joinByUrl(msg.newInviteUrl, {
          displayName: this.displayName,
          trustRelayHost: true,
        });
        return;
      }
    }
  }

  private startGuestClockSync(): void {
    this.stopGuestClockSync();
    for (let i = 0; i < CLOCK_BURST_COUNT; i++) {
      const t = setTimeout(() => {
        this.sendGuestPing();
      }, i * CLOCK_BURST_INTERVAL_MS);
      this.clockBurstTimers.push(t);
    }
    this.clockSteadyTimer = setInterval(() => {
      this.sendGuestPing();
    }, CLOCK_STEADY_INTERVAL_MS);
  }

  private stopGuestClockSync(): void {
    for (const t of this.clockBurstTimers) {
      clearTimeout(t);
    }
    this.clockBurstTimers = [];
    if (this.clockSteadyTimer) {
      clearInterval(this.clockSteadyTimer);
      this.clockSteadyTimer = null;
    }
    this.pendingPings.clear();
  }

  private sendGuestPing(): void {
    if (this.sessionMode !== "guest" || !this.guestConn?.isOpen) return;
    const pingId = crypto.randomUUID().slice(0, 12);
    const t0 = this.nowMs();
    this.pendingPings.set(pingId, t0);
    if (this.pendingPings.size > 32) {
      const firstKey = this.pendingPings.keys().next().value;
      if (firstKey !== undefined) this.pendingPings.delete(firstKey);
    }
    this.sendGuestAppMessage({
      type: "PING",
      pingId,
      t0,
    });
  }

  private handleEpochChange(
    messageType: "ROOM_SNAPSHOT" | "SYNC_ANCHOR",
    nextEpoch: number,
  ): void {
    const prevEpoch = this.guestEpoch;
    this.guestEpoch = nextEpoch;
    if (prevEpoch !== null && nextEpoch !== prevEpoch) {
      this.logger.info?.(
        "Guest observed room epoch change; resetting ClockSync and DriftController",
        {
          messageType,
          prevEpoch,
          epoch: nextEpoch,
          roomId: this.guestRoomId,
        },
      );
      this.guestClockSync?.reset();
      this.guestDriftController?.reset();
      this.startGuestClockSync();
    }
  }

  private sendGuestAppMessage(msg: AppMessage): void {
    if (
      this.sessionMode !== "guest" ||
      !this.guestConn?.isOpen ||
      !this.guestSession
    ) {
      return;
    }
    this.sendEncrypted(
      this.guestConn,
      this.guestSession,
      JSON.stringify(msg),
      msg.type,
      "Failed to encrypt/send guest message",
    );
  }

  private handleGuestUnexpectedDisconnect(): void {
    if (this.sessionMode !== "guest" || this.terminated || this.endedState) {
      return;
    }
    this.cleanupGuestTransportOnly();
    this.guestReconnecting = true;

    if (!this.guestGraceTimer) {
      const deadline = this.nowMs() + HOST_GRACE_WINDOW_MS;
      this.guestGraceDeadlineMs = deadline;
      this.guestGraceRemainingMs = HOST_GRACE_WINDOW_MS;

      this.logger.warn?.(
        "Guest lost connection to Host; starting 20s Host grace window",
        {
          roomId: this.guestRoomId,
          graceWindowMs: HOST_GRACE_WINDOW_MS,
          deadlineMs: deadline,
        },
      );

      this.guestGraceTimer = setTimeout(() => {
        this.logger.warn?.("Host grace window expired; ending guest session", {
          roomId: this.guestRoomId,
          graceWindowMs: HOST_GRACE_WINDOW_MS,
        });
        const hostName =
          this.guestMembers.find((m) => m.role === "admin")?.displayName ??
          null;
        void this.transitionToEndedState({
          reason: "timeout",
          hostName,
          queueSnapshot: this.guestLastKnownQueueSnapshot,
        });
      }, HOST_GRACE_WINDOW_MS);

      this.guestGraceCountdownTimer = setInterval(() => {
        if (this.guestGraceDeadlineMs === null) return;
        this.guestGraceRemainingMs = Math.max(
          0,
          Math.ceil(this.guestGraceDeadlineMs - this.nowMs()),
        );
        this.emitStateChanged();
      }, 1_000);
    } else {
      this.logger.debug?.(
        "Guest disconnected again during active Host grace window",
        {
          roomId: this.guestRoomId,
          remainingMs: this.guestGraceRemainingMs,
        },
      );
    }

    this.emitStateChanged();
    this.triggerGuestReconnectAttempt();
  }

  private triggerGuestReconnectAttempt(): void {
    if (
      this.sessionMode !== "guest" ||
      !this.lastGuestJoinParams ||
      !this.guestKeypair ||
      this.guestReconnectAbort ||
      this.terminated
    ) {
      return;
    }
    const params = this.lastGuestJoinParams;
    const keypair = this.guestKeypair;
    const controller = new AbortController();
    this.guestReconnectAbort = controller;

    this.logger.info?.("Attempting guest reconnect during Host grace window", {
      roomId: this.guestRoomId,
      kind: params.kind,
    });

    void this.connectAndAuthenticateGuest(
      params,
      keypair,
      sanitizeDisplayName(this.displayName),
      controller.signal,
    )
      .then((result) => {
        if (this.guestReconnectAbort !== controller) {
          result.connection.close(1000, "Stale reconnect");
          return;
        }
        this.guestReconnectAbort = null;
        if (
          this.sessionMode !== "guest" ||
          this.endedState ||
          this.terminated
        ) {
          result.connection.close(1000, "Session ended");
          return;
        }
        this.activateGuestSession(
          result.connection,
          result.mode,
          result.auth.session,
          result.auth.earlyFrames,
        );
      })
      .catch((err) => {
        if (this.guestReconnectAbort !== controller) return;
        this.guestReconnectAbort = null;
        this.logger.warn?.(
          "Guest reconnect attempt failed; scheduling retry if grace window remains",
          {
            roomId: this.guestRoomId,
            error: redactInviteUrl(
              redactLogUrl(err instanceof Error ? err.message : String(err)),
            ),
          },
        );
        if (
          this.sessionMode === "guest" &&
          this.guestGraceTimer !== null &&
          !this.terminated
        ) {
          if (this.guestReconnectRetryTimer) {
            clearTimeout(this.guestReconnectRetryTimer);
          }
          this.guestReconnectRetryTimer = setTimeout(() => {
            this.guestReconnectRetryTimer = null;
            if (
              this.sessionMode === "guest" &&
              this.guestGraceTimer !== null &&
              !this.guestConn?.isOpen &&
              !this.terminated
            ) {
              this.triggerGuestReconnectAttempt();
            }
          }, 1_500);
        }
      });
  }

  private clearGuestGraceTimers(): void {
    if (this.guestGraceTimer) {
      clearTimeout(this.guestGraceTimer);
      this.guestGraceTimer = null;
    }
    if (this.guestGraceCountdownTimer) {
      clearInterval(this.guestGraceCountdownTimer);
      this.guestGraceCountdownTimer = null;
    }
    if (this.guestReconnectRetryTimer) {
      clearTimeout(this.guestReconnectRetryTimer);
      this.guestReconnectRetryTimer = null;
    }
    this.guestGraceDeadlineMs = null;
    this.guestGraceRemainingMs = null;
    this.guestReconnectAbort?.abort();
    this.guestReconnectAbort = null;
  }

  private async transitionToEndedState(
    ended: ListenTogetherEndedUIState,
  ): Promise<void> {
    this.logger.info?.("Listen Together room ended", {
      reason: ended.reason,
      roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
      queueSnapshotCount: ended.queueSnapshot.length,
    });
    await this.teardownActiveSession({
      sendRoomEnded: false,
      unlockView: true,
    });
    this.endedState = ended;
    this.connectingStage = null;
    this.emitStateChanged();
  }

  private async applyAnchorToLocalView(anchor: PlaybackAnchor): Promise<void> {
    if (this.sessionMode === "none" || this.listeningMode === "local") return;

    this.clearPendingPlayTimer();
    const isHost = this.sessionMode === "host";
    const isNewSeq = this.lastAppliedSeq !== anchor.seq;

    if (isNewSeq) {
      this.lastAppliedSeq = anchor.seq;
      this.guestDriftController?.reset();
      this.minorityUnavailable = false;
      this.degradedSync = false;

      if (anchor.videoId) {
        const startPosSec = this.projectCurrentRoomPosSec(anchor);
        const pausedForBarrier =
          anchor.desiredState === "LOADING_BARRIER" ||
          anchor.pausedForAd ||
          anchor.desiredState === "PAUSED_BY_USER";
        await this.applySessionLockToView(true, isHost, anchor.videoId);
        await this.invokeViewLoadExactVideo({
          videoId: anchor.videoId,
          startPosSec,
          pausedForBarrier,
        });
        return;
      }

      await this.applySessionLockToView(true, isHost, null);
      await this.invokeViewSyncPlayback({ action: "pause", posSec: 0 });
      return;
    }

    if (this.localInAd) return;

    if (
      anchor.pausedForAd ||
      anchor.desiredState === "PAUSED_BY_USER" ||
      anchor.desiredState === "IDLE"
    ) {
      await this.invokeViewSyncPlayback({
        action: "pause",
        posSec: anchor.anchorPosSec,
      });
      return;
    }

    if (anchor.desiredState === "PLAYING") {
      const hostNowMs =
        this.sessionMode === "guest" && this.guestClockSync
          ? this.guestClockSync.projectHostNow(this.nowMs())
          : this.nowMs();
      const waitToPlayMs = anchor.anchorHostTimeMs - hostNowMs;

      if (waitToPlayMs > 5) {
        await this.invokeViewSyncPlayback({
          action: "pause",
          posSec: anchor.anchorPosSec,
        });
        this.pendingPlayTimer = setTimeout(() => {
          this.pendingPlayTimer = null;
          if (this.sessionMode !== "none" && !this.localInAd) {
            void this.invokeViewSyncPlayback({
              action: "play",
              posSec: anchor.anchorPosSec,
            });
          }
        }, waitToPlayMs);
      } else {
        await this.invokeViewSyncPlayback({
          action: "play",
          posSec: this.projectCurrentRoomPosSec(anchor),
        });
      }
    }
  }

  private projectCurrentRoomPosSec(anchor: PlaybackAnchor): number {
    const hostNowMs =
      this.sessionMode === "guest" && this.guestClockSync
        ? this.guestClockSync.projectHostNow(this.nowMs())
        : this.nowMs();
    if (this.guestDriftController) {
      return this.guestDriftController.projectTargetPosSec(anchor, hostNowMs)
        .posSec;
    }
    if (anchor.desiredState === "PLAYING" && !anchor.pausedForAd) {
      if (hostNowMs < anchor.anchorHostTimeMs) {
        return Math.max(0, anchor.anchorPosSec);
      }
      const elapsed = (hostNowMs - anchor.anchorHostTimeMs) / 1000;
      const projected = Math.max(0, anchor.anchorPosSec + elapsed);
      return anchor.durationSec > 0
        ? Math.min(anchor.durationSec, projected)
        : projected;
    }
    return Math.max(0, anchor.anchorPosSec);
  }

  private async ensureProtectedApiPortReady(): Promise<boolean> {
    if (
      !this.ytmViewManager.isInitialized() ||
      this.ytmViewManager.status !== YTMViewStatus.Ready
    ) {
      this.logger.debug?.(
        "ProtectedAPI port unavailable: YTMView not initialized or not Ready",
        {
          isInitialized: this.ytmViewManager.isInitialized(),
          status: this.ytmViewManager.status,
        },
      );
      return false;
    }
    if (!this.listenTogetherApi.isPortBound) {
      await this.listenTogetherApi.waitForPort(5_000);
    }
    return this.listenTogetherApi.isPortBound;
  }

  private async applySessionLockToView(
    locked: boolean,
    isHost: boolean,
    currentRoomVideoId: string | null,
    listeningMode: "room" | "local" = "room",
  ): Promise<void> {
    const canAddSongs =
      locked && (isHost || this.getLocalRole() === "dj");
    const next = {
      locked,
      isHost,
      canAddSongs,
      videoId: currentRoomVideoId,
      listeningMode,
    };
    if (
      this.lastAppliedSessionLock &&
      this.lastAppliedSessionLock.locked === next.locked &&
      this.lastAppliedSessionLock.isHost === next.isHost &&
      this.lastAppliedSessionLock.canAddSongs === next.canAddSongs &&
      this.lastAppliedSessionLock.videoId === next.videoId &&
      this.lastAppliedSessionLock.listeningMode === next.listeningMode
    ) {
      return;
    }
    try {
      if (!(await this.ensureProtectedApiPortReady())) return;
      this.lastAppliedSessionLock = next;
      await this.listenTogetherApi.invokeMessage("setSessionLock", {
        locked,
        isHost,
        canAddSongs,
        currentRoomVideoId,
        listeningMode,
      });
    } catch (err) {
      this.logger.debug?.(
        "applySessionLockToView failed while view loading or reloading",
        {
          locked,
          isHost,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  private async invokeViewLoadExactVideo(params: {
    videoId: string;
    startPosSec: number;
    pausedForBarrier: boolean;
  }): Promise<void> {
    try {
      if (!(await this.ensureProtectedApiPortReady())) return;
      await this.listenTogetherApi.invokeMessage("loadExactVideo", params);
    } catch (err) {
      this.logger.warn?.("Failed to invoke loadExactVideo", {
        videoId: params.videoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async invokeViewSyncPlayback(params: {
    action: "play" | "pause" | "seek";
    posSec?: number;
  }): Promise<void> {
    try {
      if (!(await this.ensureProtectedApiPortReady())) return;
      await this.listenTogetherApi.invokeMessage("syncPlayback", params);
    } catch (err) {
      this.logger.warn?.("Failed to invoke syncPlayback", {
        action: params.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async resumeBlockedAudio(): Promise<ListenTogetherActionResult> {
    try {
      if (!(await this.ensureProtectedApiPortReady())) {
        this.logger.warn?.("resumeBlockedAudio failed: YTMView is not ready");
        return { ok: false, error: "YouTube Music view is not ready" };
      }
      const [res] = (await this.listenTogetherApi.invokeMessage(
        "resumeBlockedAudio",
      )) as [{ ok: true } | { ok: false; error: string }];
      if (res?.ok) {
        this.audioBlocked = false;
        this.logger.info?.("Resumed blocked audio via user action", {
          sessionMode: this.sessionMode,
          roomId: this.roomState?.roomId ?? this.guestRoomId ?? null,
        });
        const anchor = this.getCurrentAnchor();
        if (
          anchor &&
          anchor.desiredState === "PLAYING" &&
          !anchor.pausedForAd
        ) {
          await this.invokeViewSyncPlayback({
            action: "play",
            posSec: this.projectCurrentRoomPosSec(anchor),
          });
        }
        this.emitStateChanged();
        return { ok: true };
      }
      this.logger.warn?.("resumeBlockedAudio returned failure", {
        error: res?.error ?? "Audio still blocked",
      });
      return { ok: false, error: res?.error ?? "Audio still blocked" };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to enable audio";
      this.logger.warn?.("resumeBlockedAudio threw error", { error: message });
      return {
        ok: false,
        error: message,
      };
    }
  }

  private cleanupGuestTransportOnly(): void {
    this.stopGuestClockSync();
    for (const unsub of this.guestConnUnsubs) {
      unsub();
    }
    this.guestConnUnsubs = [];
    if (this.guestConn) {
      const conn = this.guestConn;
      this.guestConn = null;
      conn.close(1000, "Session closing");
    }
    this.guestSession = null;
  }

  private async teardownActiveSession(options: {
    sendRoomEnded: boolean;
    unlockView: boolean;
  }): Promise<void> {
    this.clearPendingPlayTimer();
    this.clearClickedCandidate();
    this.clearNoticeBanner();
    this.clearRateLimit();

    if (this.hostRelayReconnectTimer) {
      clearTimeout(this.hostRelayReconnectTimer);
      this.hostRelayReconnectTimer = null;
    }
    if (this.hostDurationTickTimer) {
      clearInterval(this.hostDurationTickTimer);
      this.hostDurationTickTimer = null;
    }
    if (this.loadingBarrierTimer) {
      clearTimeout(this.loadingBarrierTimer);
      this.loadingBarrierTimer = null;
    }
    for (const timer of this.adStuckTimers.values()) {
      clearTimeout(timer);
    }
    this.adStuckTimers.clear();

    if (this.sessionMode === "host") {
      this.savePersistentQueue();
      this.logger.info?.("Tearing down Host session", {
        roomId: this.roomState?.roomId ?? null,
        sendRoomEnded: options.sendRoomEnded,
        unlockView: options.unlockView,
        peerCount: this.hostPeers.size,
      });
      if (options.sendRoomEnded && this.roomState) {
        const snapshot = this.roomState.currentTrack
          ? [
              this.roomState.currentTrack,
              ...materializeQueue(this.roomState.scheduler),
            ]
          : materializeQueue(this.roomState.scheduler);
        this.broadcastEncryptedToPeers({
          type: "ROOM_ENDED",
          reason: "host-left",
          queueSnapshot: snapshot,
        });
      }

      for (const peer of this.hostPeers.values()) {
        peer.unsubMessage();
        peer.unsubClose();
        peer.unsubError();
        peer.conn.close(1000, "Host left");
      }
      this.hostPeers.clear();

      for (const relay of this.relayClients) {
        relay.close();
      }
      this.relayClients.clear();
      this.primaryRelayConnected = false;

      if (this.tailcatHostSidecar) {
        const sidecar = this.tailcatHostSidecar;
        this.tailcatHostSidecar = null;
        await sidecar.stop().catch(() => {});
      }

      if (this.directWsHost) {
        const direct = this.directWsHost;
        this.directWsHost = null;
        await direct.stop();
      }

      this.roomState = null;
      this.hostKeypair = null;
      this.roomSalt = null;
      this.roomInviteToken = null;
      this.roomPasscode = null;
      this.roomShortCode = null;
      this.roomShortInviteUrl = null;
      this.roomLookupId = null;
      this.roomPasscodeAuthKey = null;
      this.roomDirectEndpoints = [];
      this.roomTailcatAddress = null;
      this.roomTailcatRemotePort = null;
      this.roomInviteUrl = null;
      this.authGuard = null;
      this.roomHistoryTracks = [];
      this.lastDjVideoId = null;
      this.autoplayFetchInFlightKey = null;
      this.dismissedAutoplayVideoIds.clear();
    }

    if (this.sessionMode === "guest") {
      this.logger.info?.("Tearing down Guest session", {
        roomId: this.guestRoomId ?? null,
        unlockView: options.unlockView,
      });
      this.clearGuestGraceTimers();
      this.cleanupGuestTransportOnly();
      this.guestClockSync = null;
      this.guestDriftController = null;
      this.guestEpoch = null;
      this.guestRoomId = null;
      this.guestSettings = null;
      this.guestMembers = [];
      this.guestCurrentTrack = null;
      this.guestAnchor = null;
      this.guestQueue = [];
      this.guestHistory = [];
      this.guestSkipVotes = [];
      this.guestAutoplayNext = null;
      this.guestLastKnownQueueSnapshot = [];
      this.guestReconnecting = false;
    }

    this.sessionMode = "none";
    this.listeningMode = "room";
    this.localTrack = null;
    this.localPlaylist = null;
    this.localInAd = false;
    this.lastAppliedSeq = null;
    this.adPostRollReloadedSeqs.clear();
    this.audioBlocked = false;
    this.minorityUnavailable = false;
    this.degradedSync = false;

    this.arbiter.setSessionState({
      active: false,
      isHost: false,
      listeningMode: "room",
    });
    if (options.unlockView) {
      await this.applySessionLockToView(false, false, null, "room");
      await this.invokeViewSyncPlayback({ action: "pause" });
    }
  }

  private setClickedCandidate(meta: QueueTrackMeta): void {
    this.clearClickedCandidate();
    this.clickedCandidate = meta;
    this.clickedCandidateTimer = setTimeout(() => {
      this.clickedCandidateTimer = null;
      this.clickedCandidate = null;
      this.emitStateChanged();
    }, CLICKED_CANDIDATE_TTL_MS);
    this.emitStateChanged();
  }

  private clearClickedCandidate(): void {
    if (this.clickedCandidateTimer) {
      clearTimeout(this.clickedCandidateTimer);
      this.clickedCandidateTimer = null;
    }
    if (this.clickedCandidate !== null) {
      this.clickedCandidate = null;
      this.emitStateChanged();
    }
  }

  private showTransientNotice(message: string): void {
    if (this.noticeBannerTimer) {
      clearTimeout(this.noticeBannerTimer);
    }
    this.noticeBanner = message;
    this.noticeBannerTimer = setTimeout(() => {
      this.noticeBannerTimer = null;
      this.noticeBanner = null;
      this.emitStateChanged();
    }, NOTICE_BANNER_TTL_MS);
    this.emitStateChanged();
  }

  private clearNoticeBanner(): void {
    if (this.noticeBannerTimer) {
      clearTimeout(this.noticeBannerTimer);
      this.noticeBannerTimer = null;
    }
    if (this.noticeBanner !== null) {
      this.noticeBanner = null;
      this.emitStateChanged();
    }
  }

  private applyActionRejectedFeedback(
    reason: "RATE_LIMITED" | "MAX_QUEUE_REACHED" | "NOT_DJ" | "INVALID_TRACK",
    retryAfterMs?: number,
  ): void {
    this.logger.info?.("Listen Together action rejected", {
      reason,
      retryAfterMs: retryAfterMs ?? null,
      sessionMode: this.sessionMode,
    });
    const preset =
      this.roomState?.settings.rateLimitPreset ??
      this.guestSettings?.rateLimitPreset ??
      "off";
    const mapped = mapActionRejectedMessage(reason, preset, retryAfterMs);
    this.clearRateLimit();
    this.rateLimitReason = mapped.reasonText;
    this.rateLimitRemainingSec = mapped.remainingSec;

    if (mapped.remainingSec > 0) {
      this.rateLimitTimer = setInterval(() => {
        if (this.rateLimitRemainingSec <= 1) {
          this.clearRateLimit();
          this.emitStateChanged();
          return;
        }
        this.rateLimitRemainingSec -= 1;
        this.rateLimitReason = `Wait ${this.rateLimitRemainingSec}s`;
        this.emitStateChanged();
      }, 1_000);
    } else {
      this.rateLimitClearTimer = setTimeout(() => {
        this.rateLimitClearTimer = null;
        if (this.rateLimitReason === mapped.reasonText) {
          this.clearRateLimit();
          this.emitStateChanged();
        }
      }, NOTICE_BANNER_TTL_MS);
    }

    this.showTransientNotice(mapped.notice);
  }

  private clearRateLimit(): void {
    if (this.rateLimitTimer) {
      clearInterval(this.rateLimitTimer);
      this.rateLimitTimer = null;
    }
    if (this.rateLimitClearTimer) {
      clearTimeout(this.rateLimitClearTimer);
      this.rateLimitClearTimer = null;
    }
    this.rateLimitRemainingSec = 0;
    this.rateLimitReason = null;
  }

  private clearPendingPlayTimer(): void {
    if (this.pendingPlayTimer) {
      clearTimeout(this.pendingPlayTimer);
      this.pendingPlayTimer = null;
    }
  }

  private clearUiTimers(): void {
    this.clearClickedCandidate();
    this.clearNoticeBanner();
    this.clearRateLimit();
    this.clearPendingPlayTimer();
  }

  private getSelfPeerId(): string {
    if (this.sessionMode === "host" && this.roomState) {
      return this.roomState.hostPeerId;
    }
    return this.guestKeypair?.publicKeyB64 ?? "";
  }

  private getLocalMember(): RoomMember | null {
    const selfId = this.getSelfPeerId();
    if (!selfId) return null;
    if (this.sessionMode === "host" && this.roomState) {
      return this.roomState.members[selfId] ?? null;
    }
    if (this.sessionMode === "guest") {
      return this.guestMembers.find((m) => m.peerId === selfId) ?? null;
    }
    return null;
  }

  private getLocalRole(): Role {
    if (this.sessionMode === "host") return "admin";
    return (
      this.getLocalMember()?.role ?? this.guestSettings?.defaultJoinRole ?? "dj"
    );
  }

  private getCurrentTrack(): QueueTrack | null {
    if (this.sessionMode === "host") {
      return this.roomState?.currentTrack ?? null;
    }
    if (this.sessionMode === "guest") {
      return this.guestCurrentTrack;
    }
    return null;
  }

  private getCurrentAnchor(): PlaybackAnchor | null {
    if (this.sessionMode === "host" && this.roomState) {
      return buildPlaybackAnchor(this.roomState);
    }
    if (this.sessionMode === "guest") {
      return this.guestAnchor;
    }
    return null;
  }

  private computeSyncStatus(
    anchor: PlaybackAnchor | null,
  ): ListenTogetherSyncStatus {
    if (this.sessionMode === "guest" && this.guestGraceTimer !== null) {
      return "host-disconnected";
    }
    if (this.sessionMode === "guest" && this.guestReconnecting) {
      return "reconnecting";
    }
    if (anchor?.pausedForAd || this.localInAd) {
      return "paused-for-ad";
    }
    if (anchor?.desiredState === "LOADING_BARRIER") {
      return "starting";
    }
    const localStatus = this.getLocalMember()?.status;
    if (
      this.degradedSync ||
      localStatus === "catching-up" ||
      localStatus === "buffering"
    ) {
      return "syncing";
    }
    return "synced";
  }

  private buildActiveRoomUIState(): ListenTogetherActiveRoomUIState | null {
    const capturedAtMs = Date.now();
    const sharedBase = {
      isFavorite: this.isCurrentRoomFavorited(),
      persistentRoomEnabled: this.persistentRoomEnabled,
      lanDiscoveryEnabled: this.lanDiscoveryEnabled,
      degradedSync: this.degradedSync,
      audioBlocked: this.audioBlocked,
      minorityUnavailable: this.minorityUnavailable,
      clickedCandidate: this.clickedCandidate,
      noticeBanner: this.noticeBanner,
      rateLimitRemainingSec: this.rateLimitRemainingSec,
      rateLimitReason: this.rateLimitReason,
      listeningMode: this.listeningMode,
      remotePositionCapturedAtMs: capturedAtMs,
      localTrack: this.localTrack ? { ...this.localTrack } : null,
      localPlaylist: this.localPlaylist ? { ...this.localPlaylist } : null,
    };

    const clampRemotePos = (rawPos: number, durationSec: number): number =>
      durationSec > 0
        ? Math.max(0, Math.min(durationSec, rawPos))
        : Math.max(0, rawPos);

    if (this.sessionMode === "host" && this.roomState) {
      const anchor = buildPlaybackAnchor(this.roomState);
      const durationSec = this.roomState.currentTrack?.durationSec ?? 0;
      const remotePositionSec = clampRemotePos(
        projectLivePosSec(this.roomState, this.nowMs()),
        durationSec,
      );
      return {
        ...sharedBase,
        roomId: this.roomState.roomId,
        passcode: this.roomPasscode,
        shortCode: this.roomShortCode,
        shortInviteUrl: this.roomShortInviteUrl,
        inviteUrl: this.roomInviteUrl,
        role: "admin",
        isHost: true,
        selfPeerId: this.roomState.hostPeerId,
        connectionKind: this.primaryRelayConnected
          ? "relay"
          : this.roomTailcatAddress
            ? "tailcat"
            : "direct",
        settings: { ...this.roomState.settings },
        members: Object.values(this.roomState.members),
        currentTrack: this.roomState.currentTrack,
        anchor,
        queue: materializeQueue(this.roomState.scheduler),
        history: [...this.roomState.history],
        autoplayNext: peekAutoplayNext(this.roomState.scheduler),
        skipVotes: [...this.roomState.skipVotes],
        skipVotesRequired: computeSkipVotesRequired(
          this.roomState.settings.voteSkipMode,
          Object.keys(this.roomState.members).length,
        ),
        syncStatus: this.computeSyncStatus(anchor),
        hostGraceRemainingMs: null,
        isLocalNetworkOnly:
          (this.signalingUrl === null || !this.primaryRelayConnected) &&
          !this.roomTailcatAddress,
        remotePositionSec,
        remotePositionAdvancing:
          anchor.desiredState === "PLAYING" && !anchor.pausedForAd,
      };
    }

    if (
      this.sessionMode === "guest" &&
      this.guestRoomId &&
      this.guestSettings
    ) {
      const anchor = this.guestAnchor;
      const durationSec = this.guestCurrentTrack?.durationSec ?? 0;
      const hostNowMs = this.guestClockSync
        ? this.guestClockSync.projectHostNow(this.nowMs())
        : null;
      const rawPos = anchor
        ? anchor.desiredState === "PLAYING" &&
          !anchor.pausedForAd &&
          hostNowMs !== null
          ? anchor.anchorPosSec + Math.max(0, (hostNowMs - anchor.anchorHostTimeMs) / 1000)
          : anchor.anchorPosSec
        : 0;
      return {
        ...sharedBase,
        roomId: this.guestRoomId,
        passcode: null,
        shortCode: null,
        shortInviteUrl: null,
        inviteUrl: null,
        role: this.getLocalRole(),
        isHost: false,
        selfPeerId: this.getSelfPeerId(),
        connectionKind: this.guestTransportMode,
        settings: { ...this.guestSettings },
        members: [...this.guestMembers],
        currentTrack: this.guestCurrentTrack,
        anchor,
        queue: [...this.guestQueue],
        history: [...this.guestHistory],
        autoplayNext: this.guestAutoplayNext,
        skipVotes: [...this.guestSkipVotes],
        skipVotesRequired: computeSkipVotesRequired(
          this.guestSettings.voteSkipMode,
          this.guestMembers.length,
        ),
        syncStatus: this.computeSyncStatus(anchor),
        hostGraceRemainingMs: this.guestGraceRemainingMs,
        isLocalNetworkOnly: this.guestTransportMode === "direct",
        remotePositionSec: clampRemotePos(rawPos, durationSec),
        remotePositionAdvancing: Boolean(
          anchor && anchor.desiredState === "PLAYING" && !anchor.pausedForAd,
        ),
      };
    }

    return null;
  }
}

export { extractVideoIdFromInput };
