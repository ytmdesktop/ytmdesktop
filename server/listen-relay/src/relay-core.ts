import {
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const NonEmptyIdSchema = Type.String({ minLength: 1, maxLength: 128 });
const KeyOrSigSchema = Type.String({ minLength: 1, maxLength: 1024 });

export const HostCreateSchema = Type.Object({
  type: Type.Literal("HOST_CREATE"),
  lookupId: NonEmptyIdSchema,
  hostPubKey: KeyOrSigSchema,
  sig: KeyOrSigSchema,
});

export const HostResumeSchema = Type.Object({
  type: Type.Literal("HOST_RESUME"),
  lookupId: NonEmptyIdSchema,
  hostPubKey: KeyOrSigSchema,
  challengeSig: KeyOrSigSchema,
});

export const HostChallengeSchema = Type.Object({
  type: Type.Literal("HOST_CHALLENGE"),
  challenge: Type.String({ minLength: 1, maxLength: 256 }),
});

export const GuestJoinSchema = Type.Object({
  type: Type.Literal("GUEST_JOIN"),
  lookupId: NonEmptyIdSchema,
  relayPeerId: Type.Optional(NonEmptyIdSchema),
});

export const RelayPeerAdmittedSchema = Type.Object({
  type: Type.Literal("RELAY_PEER_ADMITTED"),
  relayPeerId: NonEmptyIdSchema,
});

export const RelayDropPeerSchema = Type.Object({
  type: Type.Literal("RELAY_DROP_PEER"),
  relayPeerId: NonEmptyIdSchema,
  reason: Type.Optional(Type.String({ maxLength: 128 })),
});

export const RelayFrameSchema = Type.Object({
  type: Type.Literal("RELAY_FRAME"),
  targetPeerId: NonEmptyIdSchema,
  payloadB64: Type.String({ minLength: 1, maxLength: 262144 }),
  fromPeerId: Type.Optional(NonEmptyIdSchema),
});

export const RelayErrorSchema = Type.Object({
  type: Type.Literal("RELAY_ERROR"),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  message: Type.String({ minLength: 1, maxLength: 256 }),
});

export const InboundRelayMessageSchema = Type.Union([
  HostCreateSchema,
  HostResumeSchema,
  GuestJoinSchema,
  RelayPeerAdmittedSchema,
  RelayDropPeerSchema,
  RelayFrameSchema,
]);

export const OutboundRelayMessageSchema = Type.Union([
  HostChallengeSchema,
  GuestJoinSchema,
  RelayPeerAdmittedSchema,
  RelayFrameSchema,
  RelayErrorSchema,
]);

export type HostCreateMessage = Static<typeof HostCreateSchema>;
export type HostResumeMessage = Static<typeof HostResumeSchema>;
export type HostChallengeMessage = Static<typeof HostChallengeSchema>;
export type GuestJoinMessage = Static<typeof GuestJoinSchema>;
export type RelayPeerAdmittedMessage = Static<typeof RelayPeerAdmittedSchema>;
export type RelayDropPeerMessage = Static<typeof RelayDropPeerSchema>;
export type RelayFrameMessage = Static<typeof RelayFrameSchema>;
export type RelayErrorMessage = Static<typeof RelayErrorSchema>;
export type InboundRelayMessage = Static<typeof InboundRelayMessageSchema>;
export type OutboundRelayMessage = Static<typeof OutboundRelayMessageSchema>;

export interface RelaySocket {
  readonly isOpen: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}

export interface RelayLogger {
  debug?(meta: Record<string, unknown>, msg: string): void;
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  error?(meta: Record<string, unknown>, msg: string): void;
}

export interface BlindRelayOptions {
  maxPeersPerRoom?: number;
  maxPendingPerRoom?: number;
  pendingTtlMs?: number;
  heartbeatIntervalMs?: number;
  hostGraceMs?: number;
  idleRoomTtlMs?: number;
  logger?: RelayLogger;
  nowMs?: () => number;
}

export interface RoomStats {
  admittedCount: number;
  pendingCount: number;
  hostConnected: boolean;
}

type SocketRole =
  | { kind: "unbound" }
  | { kind: "host"; lookupId: string }
  | { kind: "pending_guest"; lookupId: string; relayPeerId: string }
  | { kind: "admitted_guest"; lookupId: string; relayPeerId: string };

interface SocketState {
  socket: RelaySocket;
  challenge: string;
  challengeUsed: boolean;
  isAlive: boolean;
  role: SocketRole;
  pendingTimer: ReturnType<typeof setTimeout> | null;
}

interface PeerRecord {
  relayPeerId: string;
  socket: RelaySocket;
}

interface RoomState {
  lookupId: string;
  hostPubKeyDer: Buffer;
  hostSocket: RelaySocket | null;
  admittedPeers: Map<string, PeerRecord>;
  pendingPeers: Map<string, PeerRecord>;
  hostGraceTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64_FLEX_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

const DEFAULT_MAX_PEERS_PER_ROOM = 8;
const DEFAULT_MAX_PENDING_PER_ROOM = 64;
const DEFAULT_PENDING_TTL_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
const DEFAULT_HOST_GRACE_MS = 20_000;
const DEFAULT_IDLE_ROOM_TTL_MS = 10 * 60 * 1000;

const NOOP_LOGGER: RelayLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function decodeBase64Flex(input: string): Buffer | null {
  const trimmed = input.trim();
  if (!trimmed || !BASE64_FLEX_RE.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const buf = Buffer.from(padded, "base64");
  return buf.length > 0 ? buf : null;
}

/**
 * Parses an Ed25519 public key from PEM, 44-byte SPKI DER, or raw 32-byte
 * base64/base64url encoding and returns the KeyObject plus canonical SPKI DER.
 */
export function parseEd25519PublicKey(
  encoded: string,
): { key: KeyObject; spkiDer: Buffer } | null {
  try {
    if (encoded.startsWith("-----BEGIN ")) {
      const key = createPublicKey(encoded);
      if (key.asymmetricKeyType !== "ed25519") {
        return null;
      }
      const spkiDer = key.export({ format: "der", type: "spki" });
      return { key, spkiDer };
    }

    const raw = decodeBase64Flex(encoded);
    if (!raw) {
      return null;
    }

    let der: Buffer;
    if (raw.length === 32) {
      der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    } else if (raw.length === 44) {
      der = raw;
    } else {
      return null;
    }

    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") {
      return null;
    }
    const spkiDer = key.export({ format: "der", type: "spki" });
    return { key, spkiDer };
  } catch {
    return null;
  }
}

/**
 * Verifies a 64-byte Ed25519 signature over the UTF-8 challenge string.
 */
export function verifyEd25519Challenge(
  key: KeyObject,
  challenge: string,
  sigEncoded: string,
): boolean {
  const sigBytes = decodeBase64Flex(sigEncoded);
  if (!sigBytes || sigBytes.length !== 64) {
    return false;
  }
  try {
    return verify(null, Buffer.from(challenge, "utf8"), key, sigBytes);
  } catch {
    return false;
  }
}

interface RateBucket {
  count: number;
  resetAtMs: number;
}

/**
 * Fixed-window per-key rate limiter used for WebSocket upgrade throttling.
 */
export class IpRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(
    maxRequests: number,
    windowMs: number,
    now: () => number = Date.now,
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.now = now;
  }

  consume(key: string): boolean {
    const currentMs = this.now();
    const existing = this.buckets.get(key);

    if (!existing || currentMs >= existing.resetAtMs) {
      this.pruneExpired(currentMs);
      this.buckets.set(key, { count: 1, resetAtMs: currentMs + this.windowMs });
      return true;
    }

    if (existing.count >= this.maxRequests) {
      return false;
    }

    existing.count += 1;
    return true;
  }

  private pruneExpired(currentMs: number): void {
    if (this.buckets.size < 1000) {
      return;
    }
    for (const [k, bucket] of this.buckets) {
      if (currentMs >= bucket.resetAtMs) {
        this.buckets.delete(k);
      }
    }
  }
}

/**
 * Pure room, challenge, slot, heartbeat, and blind frame forwarding engine.
 */
export class BlindRelayCore {
  private readonly maxPeersPerRoom: number;
  private readonly maxPendingPerRoom: number;
  private readonly pendingTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly hostGraceMs: number;
  private readonly idleRoomTtlMs: number;
  private readonly logger: RelayLogger;
  private readonly nowMs: () => number;

  private readonly rooms = new Map<string, RoomState>();
  private readonly sockets = new Map<RelaySocket, SocketState>();
  private readonly shortInvites = new Map<
    string,
    { inviteUrl: string; expiresAtMs: number }
  >();
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;

  constructor(options: BlindRelayOptions = {}) {
    this.maxPeersPerRoom =
      options.maxPeersPerRoom ?? DEFAULT_MAX_PEERS_PER_ROOM;
    this.maxPendingPerRoom =
      options.maxPendingPerRoom ?? DEFAULT_MAX_PENDING_PER_ROOM;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.hostGraceMs = options.hostGraceMs ?? DEFAULT_HOST_GRACE_MS;
    this.idleRoomTtlMs = options.idleRoomTtlMs ?? DEFAULT_IDLE_ROOM_TTL_MS;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.nowMs = options.nowMs ?? Date.now;

    this.heartbeatTimer = setInterval(
      () => this.runHeartbeatSweep(),
      this.heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref?.();
  }

  handleConnection(socket: RelaySocket): string {
    const challenge = randomBytes(32).toString("base64url");
    const state: SocketState = {
      socket,
      challenge,
      challengeUsed: false,
      isAlive: true,
      role: { kind: "unbound" },
      pendingTimer: null,
    };
    this.sockets.set(socket, state);
    this.armPendingTimer(state, "Unauthenticated connection expired", 4003);
    this.sendOutbound(socket, { type: "HOST_CHALLENGE", challenge });
    return challenge;
  }

  handleMessage(socket: RelaySocket, raw: string): void {
    const state = this.sockets.get(socket);
    if (!state) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(
        {
          event: "invalid_message",
          code: "INVALID_JSON",
          role: state.role.kind,
        },
        "Rejected malformed JSON message",
      );
      this.sendError(socket, "INVALID_JSON", "Malformed JSON message");
      return;
    }

    if (!Value.Check(InboundRelayMessageSchema, parsed)) {
      this.logger.warn(
        {
          event: "invalid_message",
          code: "INVALID_MESSAGE",
          role: state.role.kind,
        },
        "Rejected inbound relay message failing schema check",
      );
      this.sendError(socket, "INVALID_MESSAGE", "Message failed schema check");
      return;
    }

    switch (parsed.type) {
      case "HOST_CREATE":
        this.handleHostCreate(state, parsed);
        break;
      case "HOST_RESUME":
        this.handleHostResume(state, parsed);
        break;
      case "GUEST_JOIN":
        this.handleGuestJoin(state, parsed);
        break;
      case "RELAY_PEER_ADMITTED":
        this.handlePeerAdmitted(state, parsed);
        break;
      case "RELAY_DROP_PEER":
        this.handleDropPeer(state, parsed);
        break;
      case "RELAY_FRAME":
        this.handleRelayFrame(state, parsed);
        break;
    }
  }

  handlePong(socket: RelaySocket): void {
    const state = this.sockets.get(socket);
    if (!state) {
      return;
    }
    state.isAlive = true;

    if (state.role.kind === "host") {
      const room = this.rooms.get(state.role.lookupId);
      if (room && room.hostSocket === socket) {
        this.resetIdleTimer(room);
      }
    }
  }

  handleClose(socket: RelaySocket): void {
    const state = this.sockets.get(socket);
    if (!state) {
      return;
    }

    this.clearPendingTimer(state);
    this.sockets.delete(socket);

    if (state.role.kind === "unbound") {
      return;
    }

    const room = this.rooms.get(state.role.lookupId);
    if (!room) {
      return;
    }

    if (state.role.kind === "host") {
      if (room.hostSocket === socket) {
        room.hostSocket = null;
        this.clearIdleTimer(room);
        this.logger.info(
          { event: "host_grace_started", lookupId: room.lookupId },
          "Host disconnected; starting grace window",
        );
        room.hostGraceTimer = setTimeout(() => {
          this.destroyRoom(room, "HOST_TIMEOUT", "Host grace window expired");
        }, this.hostGraceMs);
        room.hostGraceTimer.unref?.();
      }
      return;
    }

    const { relayPeerId } = state.role;
    const removedPending = room.pendingPeers.delete(relayPeerId);
    const removedAdmitted = room.admittedPeers.delete(relayPeerId);
    if (removedPending || removedAdmitted) {
      this.logger.info(
        { event: "peer_disconnected", lookupId: room.lookupId, relayPeerId },
        "Peer disconnected",
      );
    }
  }

  runHeartbeatSweep(): void {
    for (const [socket, state] of this.sockets) {
      if (!state.isAlive) {
        const meta: Record<string, unknown> = { event: "heartbeat_timeout" };
        if (state.role.kind !== "unbound") {
          meta.lookupId = state.role.lookupId;
        }
        if (
          state.role.kind === "pending_guest" ||
          state.role.kind === "admitted_guest"
        ) {
          meta.relayPeerId = state.role.relayPeerId;
        }
        this.logger.warn(meta, "Reaping unresponsive socket");
        this.handleClose(socket);
        socket.terminate();
        continue;
      }

      state.isAlive = false;
      socket.ping();
    }
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getRoomStats(lookupId: string): RoomStats | null {
    const room = this.rooms.get(lookupId);
    if (!room) {
      return null;
    }
    return {
      admittedCount: room.admittedPeers.size,
      pendingCount: room.pendingPeers.size,
      hostConnected: room.hostSocket !== null,
    };
  }

  dispose(): void {
    clearInterval(this.heartbeatTimer);

    for (const room of this.rooms.values()) {
      this.clearHostGraceTimer(room);
      this.clearIdleTimer(room);
    }
    this.rooms.clear();

    for (const [socket, state] of this.sockets) {
      this.clearPendingTimer(state);
      if (socket.isOpen) {
        socket.close(1001, "Relay shutting down");
      }
    }
    this.sockets.clear();
    this.shortInvites.clear();
  }

  private consumeUnboundChallenge(
    state: SocketState,
    lookupId: string,
    actionLabel: string,
  ): boolean {
    if (state.role.kind !== "unbound") {
      this.logger.warn(
        { event: "auth_failed", lookupId, code: "ALREADY_BOUND" },
        `${actionLabel} rejected; socket already bound`,
      );
      this.sendError(state.socket, "ALREADY_BOUND", "Socket already bound");
      return false;
    }

    if (state.challengeUsed) {
      this.logger.warn(
        {
          event: "auth_failed",
          lookupId,
          code: "CHALLENGE_USED",
        },
        `${actionLabel} rejected; challenge already consumed`,
      );
      this.sendErrorAndClose(
        state.socket,
        "CHALLENGE_USED",
        "Challenge already consumed",
        4001,
      );
      return false;
    }

    state.challengeUsed = true;
    return true;
  }

  private handleHostCreate(state: SocketState, msg: HostCreateMessage): void {
    if (!this.consumeUnboundChallenge(state, msg.lookupId, "Host create")) {
      return;
    }

    if (this.rooms.has(msg.lookupId)) {
      this.logger.warn(
        { event: "auth_failed", lookupId: msg.lookupId, code: "ROOM_EXISTS" },
        "Room creation rejected; lookupId already active",
      );
      this.sendErrorAndClose(
        state.socket,
        "ROOM_EXISTS",
        "Room already exists",
        4009,
      );
      return;
    }

    const parsedKey = parseEd25519PublicKey(msg.hostPubKey);
    if (
      !parsedKey ||
      !verifyEd25519Challenge(parsedKey.key, state.challenge, msg.sig)
    ) {
      this.logger.warn(
        {
          event: "auth_failed",
          lookupId: msg.lookupId,
          code: "INVALID_SIGNATURE",
        },
        "Host create signature verification failed",
      );
      this.sendErrorAndClose(
        state.socket,
        "INVALID_SIGNATURE",
        "Invalid Ed25519 signature",
        4001,
      );
      return;
    }

    this.clearPendingTimer(state);
    state.role = { kind: "host", lookupId: msg.lookupId };

    const room: RoomState = {
      lookupId: msg.lookupId,
      hostPubKeyDer: parsedKey.spkiDer,
      hostSocket: state.socket,
      admittedPeers: new Map(),
      pendingPeers: new Map(),
      hostGraceTimer: null,
      idleTimer: null,
    };
    this.rooms.set(msg.lookupId, room);
    this.resetIdleTimer(room);

    this.logger.info(
      { event: "room_created", lookupId: msg.lookupId },
      "Room created",
    );
    this.sendOutbound(state.socket, {
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: "host",
    });
  }

  private handleHostResume(state: SocketState, msg: HostResumeMessage): void {
    if (!this.consumeUnboundChallenge(state, msg.lookupId, "Host resume")) {
      return;
    }

    const room = this.rooms.get(msg.lookupId);
    if (!room) {
      this.logger.warn(
        {
          event: "auth_failed",
          lookupId: msg.lookupId,
          code: "ROOM_NOT_FOUND",
        },
        "Host resume rejected; room not found",
      );
      this.sendErrorAndClose(
        state.socket,
        "ROOM_NOT_FOUND",
        "Room does not exist",
        4004,
      );
      return;
    }

    const parsedKey = parseEd25519PublicKey(msg.hostPubKey);
    if (
      !parsedKey ||
      parsedKey.spkiDer.length !== room.hostPubKeyDer.length ||
      !timingSafeEqual(parsedKey.spkiDer, room.hostPubKeyDer)
    ) {
      this.logger.warn(
        { event: "auth_failed", lookupId: msg.lookupId, code: "FORBIDDEN" },
        "Host resume public key mismatch",
      );
      this.sendErrorAndClose(
        state.socket,
        "FORBIDDEN",
        "Public key does not match room host",
        4003,
      );
      return;
    }

    if (
      !verifyEd25519Challenge(parsedKey.key, state.challenge, msg.challengeSig)
    ) {
      this.logger.warn(
        {
          event: "auth_failed",
          lookupId: msg.lookupId,
          code: "INVALID_SIGNATURE",
        },
        "Host resume signature verification failed",
      );
      this.sendErrorAndClose(
        state.socket,
        "INVALID_SIGNATURE",
        "Invalid Ed25519 challenge signature",
        4001,
      );
      return;
    }

    this.clearPendingTimer(state);
    this.clearHostGraceTimer(room);

    if (room.hostSocket && room.hostSocket !== state.socket) {
      const previousHost = room.hostSocket;
      room.hostSocket = null;
      const prevState = this.sockets.get(previousHost);
      if (prevState) {
        this.clearPendingTimer(prevState);
        this.sockets.delete(previousHost);
      }
      this.logger.info(
        { event: "host_replaced", lookupId: msg.lookupId },
        "Replacing previous host socket on resume",
      );
      previousHost.close(4000, "Replaced by HOST_RESUME");
    }

    room.hostSocket = state.socket;
    state.role = { kind: "host", lookupId: msg.lookupId };
    this.resetIdleTimer(room);

    this.logger.info(
      { event: "room_resumed", lookupId: msg.lookupId },
      "Host resumed room",
    );
    this.sendOutbound(state.socket, {
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: "host",
    });
  }

  private handleGuestJoin(state: SocketState, msg: GuestJoinMessage): void {
    if (state.role.kind !== "unbound") {
      this.logger.warn(
        {
          event: "guest_join_rejected",
          lookupId: msg.lookupId,
          code: "ALREADY_BOUND",
        },
        "Guest join rejected; socket already bound",
      );
      this.sendError(state.socket, "ALREADY_BOUND", "Socket already bound");
      return;
    }

    const room = this.rooms.get(msg.lookupId);
    if (!room) {
      this.logger.warn(
        {
          event: "guest_join_rejected",
          lookupId: msg.lookupId,
          code: "ROOM_NOT_FOUND",
        },
        "Guest join rejected; room not found",
      );
      this.sendErrorAndClose(
        state.socket,
        "ROOM_NOT_FOUND",
        "Room does not exist",
        4004,
      );
      return;
    }

    if (!room.hostSocket || !room.hostSocket.isOpen) {
      this.logger.warn(
        {
          event: "guest_join_rejected",
          lookupId: room.lookupId,
          code: "HOST_OFFLINE",
        },
        "Guest join rejected; host offline",
      );
      this.sendErrorAndClose(
        state.socket,
        "HOST_OFFLINE",
        "Room host is currently offline",
        4002,
      );
      return;
    }

    if (1 + room.admittedPeers.size >= this.maxPeersPerRoom) {
      this.logger.warn(
        {
          event: "room_full",
          lookupId: room.lookupId,
          admittedCount: room.admittedPeers.size,
          maxPeersPerRoom: this.maxPeersPerRoom,
        },
        "Rejected guest join: room at maximum peer capacity",
      );
      this.sendErrorAndClose(
        state.socket,
        "ROOM_FULL",
        "Room has reached maximum capacity",
        4008,
      );
      return;
    }

    if (room.pendingPeers.size >= this.maxPendingPerRoom) {
      this.logger.warn(
        {
          event: "too_many_pending",
          lookupId: room.lookupId,
          pendingCount: room.pendingPeers.size,
          maxPendingPerRoom: this.maxPendingPerRoom,
        },
        "Rejected guest join: pending queue at capacity",
      );
      this.sendErrorAndClose(
        state.socket,
        "TOO_MANY_PENDING",
        "Too many pending connections",
        4008,
      );
      return;
    }

    const relayPeerId = `peer-${randomUUID()}`;
    state.role = {
      kind: "pending_guest",
      lookupId: msg.lookupId,
      relayPeerId,
    };
    room.pendingPeers.set(relayPeerId, { relayPeerId, socket: state.socket });
    this.armPendingTimer(state, "Pending authentication expired", 4003);

    this.logger.info(
      { event: "peer_pending", lookupId: room.lookupId, relayPeerId },
      "Guest joined as pending peer",
    );

    const notification: GuestJoinMessage = {
      type: "GUEST_JOIN",
      lookupId: room.lookupId,
      relayPeerId,
    };
    this.sendOutbound(state.socket, notification);
    this.sendOutbound(room.hostSocket, notification);
  }

  private handlePeerAdmitted(
    state: SocketState,
    msg: RelayPeerAdmittedMessage,
  ): void {
    if (state.role.kind !== "host") {
      this.logger.warn(
        { event: "forbidden_admit", relayPeerId: msg.relayPeerId },
        "Rejected RELAY_PEER_ADMITTED from non-host socket",
      );
      this.sendError(state.socket, "FORBIDDEN", "Only host can admit peers");
      return;
    }

    const room = this.rooms.get(state.role.lookupId);
    if (!room || room.hostSocket !== state.socket) {
      return;
    }
    this.resetIdleTimer(room);

    if (room.admittedPeers.has(msg.relayPeerId)) {
      return;
    }

    const pending = room.pendingPeers.get(msg.relayPeerId);
    if (!pending) {
      this.logger.warn(
        {
          event: "peer_not_found",
          lookupId: room.lookupId,
          relayPeerId: msg.relayPeerId,
        },
        "Cannot admit peer; pending peer not found",
      );
      this.sendError(state.socket, "PEER_NOT_FOUND", "Pending peer not found");
      return;
    }

    if (1 + room.admittedPeers.size >= this.maxPeersPerRoom) {
      this.logger.warn(
        {
          event: "room_full",
          lookupId: room.lookupId,
          relayPeerId: msg.relayPeerId,
          admittedCount: room.admittedPeers.size,
          maxPeersPerRoom: this.maxPeersPerRoom,
        },
        "Rejected peer admission: room at maximum peer capacity",
      );
      room.pendingPeers.delete(msg.relayPeerId);
      const pendingState = this.sockets.get(pending.socket);
      if (pendingState) {
        this.clearPendingTimer(pendingState);
        this.sockets.delete(pending.socket);
      }
      this.sendError(
        state.socket,
        "ROOM_FULL",
        "Room has reached maximum capacity",
      );
      this.sendErrorAndClose(
        pending.socket,
        "ROOM_FULL",
        "Room has reached maximum capacity",
        4008,
      );
      return;
    }

    room.pendingPeers.delete(msg.relayPeerId);
    room.admittedPeers.set(msg.relayPeerId, pending);

    const peerState = this.sockets.get(pending.socket);
    if (peerState) {
      this.clearPendingTimer(peerState);
      peerState.role = {
        kind: "admitted_guest",
        lookupId: room.lookupId,
        relayPeerId: msg.relayPeerId,
      };
    }

    this.logger.info(
      {
        event: "peer_admitted",
        lookupId: room.lookupId,
        relayPeerId: msg.relayPeerId,
      },
      "Peer admitted by host",
    );
    this.sendOutbound(pending.socket, {
      type: "RELAY_PEER_ADMITTED",
      relayPeerId: msg.relayPeerId,
    });
  }

  private handleDropPeer(state: SocketState, msg: RelayDropPeerMessage): void {
    if (state.role.kind !== "host") {
      this.logger.warn(
        { event: "forbidden_drop_peer", relayPeerId: msg.relayPeerId },
        "Rejected RELAY_DROP_PEER from non-host socket",
      );
      this.sendError(state.socket, "FORBIDDEN", "Only host can drop peers");
      return;
    }

    const room = this.rooms.get(state.role.lookupId);
    if (!room || room.hostSocket !== state.socket) {
      return;
    }
    this.resetIdleTimer(room);

    const peer =
      room.admittedPeers.get(msg.relayPeerId) ??
      room.pendingPeers.get(msg.relayPeerId);
    if (!peer) {
      this.logger.debug?.(
        {
          event: "drop_peer_ignored",
          lookupId: room.lookupId,
          relayPeerId: msg.relayPeerId,
        },
        "Ignored RELAY_DROP_PEER for unknown peer",
      );
      return;
    }

    room.admittedPeers.delete(msg.relayPeerId);
    room.pendingPeers.delete(msg.relayPeerId);

    const peerState = this.sockets.get(peer.socket);
    if (peerState) {
      this.clearPendingTimer(peerState);
      this.sockets.delete(peer.socket);
    }

    this.logger.info(
      {
        event: "peer_dropped",
        lookupId: room.lookupId,
        relayPeerId: msg.relayPeerId,
      },
      "Peer dropped by host",
    );
    this.sendErrorAndClose(
      peer.socket,
      "DROPPED_BY_HOST",
      "Dropped by host",
      4005,
    );
  }

  private handleRelayFrame(state: SocketState, msg: RelayFrameMessage): void {
    if (state.role.kind === "unbound") {
      this.sendError(
        state.socket,
        "UNAUTHENTICATED",
        "Must join or create a room first",
      );
      return;
    }

    const room = this.rooms.get(state.role.lookupId);
    if (!room) {
      return;
    }

    if (state.role.kind === "host") {
      if (room.hostSocket !== state.socket) {
        return;
      }
      this.resetIdleTimer(room);

      const target =
        room.admittedPeers.get(msg.targetPeerId) ??
        room.pendingPeers.get(msg.targetPeerId);
      if (!target || !target.socket.isOpen) {
        this.sendError(
          state.socket,
          "PEER_NOT_FOUND",
          "Target peer not connected",
        );
        return;
      }

      this.sendOutbound(target.socket, {
        type: "RELAY_FRAME",
        targetPeerId: msg.targetPeerId,
        fromPeerId: "host",
        payloadB64: msg.payloadB64,
      });
      return;
    }

    if (!room.hostSocket || !room.hostSocket.isOpen) {
      this.sendError(
        state.socket,
        "HOST_OFFLINE",
        "Host temporarily disconnected",
      );
      return;
    }

    // Pending guests may only message the host to complete E2EE admission.
    if (state.role.kind === "pending_guest" && msg.targetPeerId !== "host") {
      this.sendError(
        state.socket,
        "FORBIDDEN",
        "Pending peers can only send frames to host",
      );
      return;
    }

    if (msg.targetPeerId === "host") {
      this.sendOutbound(room.hostSocket, {
        type: "RELAY_FRAME",
        targetPeerId: "host",
        fromPeerId: state.role.relayPeerId,
        payloadB64: msg.payloadB64,
      });
      return;
    }

    const target = room.admittedPeers.get(msg.targetPeerId);
    if (!target || !target.socket.isOpen) {
      this.sendError(
        state.socket,
        "PEER_NOT_FOUND",
        "Target peer not connected",
      );
      return;
    }

    this.sendOutbound(target.socket, {
      type: "RELAY_FRAME",
      targetPeerId: msg.targetPeerId,
      fromPeerId: state.role.relayPeerId,
      payloadB64: msg.payloadB64,
    });
  }

  private armPendingTimer(
    state: SocketState,
    reason: string,
    closeCode: number,
  ): void {
    this.clearPendingTimer(state);
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = null;
      if (
        state.role.kind !== "unbound" &&
        state.role.kind !== "pending_guest"
      ) {
        return;
      }
      const meta: Record<string, unknown> = {
        event: "pending_expired",
        role: state.role.kind,
        pendingTtlMs: this.pendingTtlMs,
      };
      if (state.role.kind === "pending_guest") {
        meta.lookupId = state.role.lookupId;
        meta.relayPeerId = state.role.relayPeerId;
        const room = this.rooms.get(state.role.lookupId);
        room?.pendingPeers.delete(state.role.relayPeerId);
      }
      this.logger.info(meta, "Pending socket expired");
      this.sockets.delete(state.socket);
      this.sendErrorAndClose(
        state.socket,
        "PENDING_TIMEOUT",
        reason,
        closeCode,
      );
    }, this.pendingTtlMs);
    state.pendingTimer.unref?.();
  }

  private clearPendingTimer(state: SocketState): void {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  private resetIdleTimer(room: RoomState): void {
    this.clearIdleTimer(room);
    room.idleTimer = setTimeout(() => {
      this.destroyRoom(
        room,
        "ROOM_IDLE_EXPIRED",
        "Room expired due to inactivity",
      );
    }, this.idleRoomTtlMs);
    room.idleTimer.unref?.();
  }

  private clearIdleTimer(room: RoomState): void {
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
  }

  private clearHostGraceTimer(room: RoomState): void {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
  }

  private destroyRoom(room: RoomState, code: string, message: string): void {
    if (!this.rooms.has(room.lookupId)) {
      return;
    }
    this.rooms.delete(room.lookupId);
    this.clearHostGraceTimer(room);
    this.clearIdleTimer(room);

    this.logger.info(
      {
        event: "room_expired",
        lookupId: room.lookupId,
        code,
        admittedCount: room.admittedPeers.size,
        pendingCount: room.pendingPeers.size,
      },
      "Room destroyed",
    );

    if (room.hostSocket) {
      const hostSocket = room.hostSocket;
      room.hostSocket = null;
      const hostState = this.sockets.get(hostSocket);
      if (hostState) {
        this.clearPendingTimer(hostState);
        this.sockets.delete(hostSocket);
      }
      this.sendErrorAndClose(hostSocket, code, message, 4002);
    }

    for (const peer of [
      ...room.pendingPeers.values(),
      ...room.admittedPeers.values(),
    ]) {
      const peerState = this.sockets.get(peer.socket);
      if (peerState) {
        this.clearPendingTimer(peerState);
        this.sockets.delete(peer.socket);
      }
      this.sendErrorAndClose(peer.socket, code, message, 4002);
    }
    room.pendingPeers.clear();
    room.admittedPeers.clear();
  }

  private sendOutbound(socket: RelaySocket, msg: OutboundRelayMessage): void {
    if (!socket.isOpen) {
      return;
    }
    socket.send(JSON.stringify(msg));
  }

  private sendError(socket: RelaySocket, code: string, message: string): void {
    this.sendOutbound(socket, { type: "RELAY_ERROR", code, message });
  }

  private sendErrorAndClose(
    socket: RelaySocket,
    code: string,
    message: string,
    wsCloseCode: number,
  ): void {
    if (!socket.isOpen) {
      return;
    }
    this.sendError(socket, code, message);
    socket.close(wsCloseCode, code);
  }

  public createShortInvite(
    inviteUrl: string,
    nowMs = this.nowMs(),
  ): {
    code: string;
    expiresAtMs: number;
  } {
    for (const [k, v] of this.shortInvites) {
      if (v.expiresAtMs <= nowMs) {
        this.shortInvites.delete(k);
      }
    }
    if (this.shortInvites.size >= 10_000) {
      const oldestKey = this.shortInvites.keys().next().value;
      if (oldestKey) this.shortInvites.delete(oldestKey);
    }
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let raw = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = randomBytes(8);
      raw = "";
      for (let i = 0; i < 8; i++) {
        raw += alphabet[bytes[i]! % alphabet.length];
      }
      if (!this.shortInvites.has(raw)) break;
    }
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    const expiresAtMs = nowMs + 24 * 60 * 60 * 1000;
    this.shortInvites.set(raw, { inviteUrl, expiresAtMs });
    return { code, expiresAtMs };
  }

  public resolveShortInvite(
    rawCode: string,
    nowMs = this.nowMs(),
  ): string | null {
    const normalized = rawCode.replace(/[\s-]+/g, "").toUpperCase();
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(normalized)) {
      return null;
    }
    const entry = this.shortInvites.get(normalized);
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs) {
      this.shortInvites.delete(normalized);
      return null;
    }
    return entry.inviteUrl;
  }
}
