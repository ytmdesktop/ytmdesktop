import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  noopLogger,
  redactInviteUrl,
  redactLogUrl,
  type ListenTogetherLogger,
} from "./logger";

export const VideoIdSchema = Type.String({ pattern: "^[A-Za-z0-9_-]{11}$" });

export const ThumbnailUrlSchema = Type.Union([
  Type.Null(),
  Type.String({
    maxLength: 512,
    pattern:
      "^https://(i\\d*\\.ytimg\\.com|lh\\d+\\.googleusercontent\\.com|yt\\d+\\.(ggpht|googleusercontent)\\.com)/",
  }),
]);

export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: 32 });

export const RoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("dj"),
  Type.Literal("listener"),
]);
export type Role = Static<typeof RoleSchema>;

export const QueueModeSchema = Type.Union([
  Type.Literal("fair-rr"),
  Type.Literal("fifo"),
]);
export type QueueMode = Static<typeof QueueModeSchema>;

export const AdSyncModeSchema = Type.Union([
  Type.Literal("pause-for-all"),
  Type.Literal("stay-live"),
]);
export type AdSyncMode = Static<typeof AdSyncModeSchema>;

export const AutoplayModeSchema = Type.Union([
  Type.Literal("shared"),
  Type.Literal("history"),
  Type.Literal("off"),
]);
export type AutoplayMode = Static<typeof AutoplayModeSchema>;

export const RateLimitPresetSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("strict"),
]);
export type RateLimitPreset = Static<typeof RateLimitPresetSchema>;

export const VoteSkipModeSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("majority"),
  Type.Literal("two-thirds"),
  Type.Literal("unanimous"),
]);
export type VoteSkipMode = Static<typeof VoteSkipModeSchema>;

export function computeSkipVotesRequired(
  mode: VoteSkipMode,
  memberCount: number,
): number {
  const count = Math.max(1, Math.trunc(memberCount));
  switch (mode) {
    case "off":
      return 0;
    case "majority":
      return Math.floor(count / 2) + 1;
    case "two-thirds":
      return Math.ceil((count * 2) / 3);
    case "unanimous":
      return count;
  }
}

export const QueueTrackMetaSchema = Type.Object({
  videoId: VideoIdSchema,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  author: Type.String({ maxLength: 120 }),
  durationSec: Type.Integer({ minimum: 1 }),
  thumbnailUrl: ThumbnailUrlSchema,
});
export type QueueTrackMeta = Static<typeof QueueTrackMetaSchema>;

export const QueueTrackSchema = Type.Object({
  entryId: Type.String({ minLength: 1, maxLength: 128 }),
  videoId: VideoIdSchema,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  author: Type.String({ maxLength: 120 }),
  durationSec: Type.Integer({ minimum: 1 }),
  thumbnailUrl: ThumbnailUrlSchema,
  addedBy: Type.String({ minLength: 1, maxLength: 128 }),
  addedByName: DisplayNameSchema,
  addedAtMs: Type.Number({ minimum: 0 }),
  source: Type.Union([Type.Literal("dj"), Type.Literal("autoplay")]),
  pinned: Type.Boolean(),
});
export type QueueTrack = Static<typeof QueueTrackSchema>;

export const DesiredPlaybackStateSchema = Type.Union([
  Type.Literal("IDLE"),
  Type.Literal("LOADING_BARRIER"),
  Type.Literal("PLAYING"),
  Type.Literal("PAUSED_BY_USER"),
]);
export type DesiredPlaybackState = Static<typeof DesiredPlaybackStateSchema>;

export const WaitingOnAdSchema = Type.Object({
  peerId: Type.String({ minLength: 1, maxLength: 128 }),
  displayName: DisplayNameSchema,
});

export const PlaybackAnchorSchema = Type.Object({
  seq: Type.Integer({ minimum: 0 }),
  videoId: Type.Union([VideoIdSchema, Type.Literal("")]),
  durationSec: Type.Integer({ minimum: 0 }),
  desiredState: DesiredPlaybackStateSchema,
  pausedForAd: Type.Boolean(),
  waitingOnAds: Type.Array(WaitingOnAdSchema, { maxItems: 16 }),
  anchorPosSec: Type.Number({ minimum: 0 }),
  anchorHostTimeMs: Type.Number({ minimum: 0 }),
});
export type PlaybackAnchor = Static<typeof PlaybackAnchorSchema>;

export const DefaultJoinRoleSchema = Type.Union([
  Type.Literal("dj"),
  Type.Literal("listener"),
]);

export const RoomSettingsSchema = Type.Object({
  roomName: Type.Optional(Type.String({ maxLength: 64 })),
  adSyncMode: AdSyncModeSchema,
  queueMode: QueueModeSchema,
  defaultJoinRole: DefaultJoinRoleSchema,
  rateLimitPreset: RateLimitPresetSchema,
  autoplayMode: AutoplayModeSchema,
  voteSkipMode: VoteSkipModeSchema,
});
export type RoomSettings = Static<typeof RoomSettingsSchema>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  adSyncMode: "pause-for-all",
  queueMode: "fair-rr",
  defaultJoinRole: "dj",
  rateLimitPreset: "off",
  autoplayMode: "shared",
  voteSkipMode: "majority",
};

export const MemberStatusSchema = Type.Union([
  Type.Literal("synced"),
  Type.Literal("buffering"),
  Type.Literal("in-ad"),
  Type.Literal("unavailable"),
  Type.Literal("catching-up"),
]);
export type MemberStatus = Static<typeof MemberStatusSchema>;

export const MemberTransportSchema = Type.Union([
  Type.Literal("direct"),
  Type.Literal("tailcat"),
  Type.Literal("relay"),
]);

export const RoomMemberSchema = Type.Object({
  peerId: Type.String({ minLength: 1, maxLength: 128 }),
  clientSlug: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  displayName: DisplayNameSchema,
  role: RoleSchema,
  status: MemberStatusSchema,
  transport: MemberTransportSchema,
  listeningMode: Type.Optional(
    Type.Union([Type.Literal("room"), Type.Literal("local")]),
  ),
});
export type RoomMember = Static<typeof RoomMemberSchema>;

export const ActionRejectedReasonSchema = Type.Union([
  Type.Literal("RATE_LIMITED"),
  Type.Literal("MAX_QUEUE_REACHED"),
  Type.Literal("NOT_DJ"),
  Type.Literal("INVALID_TRACK"),
]);
export type ActionRejectedReason = Static<typeof ActionRejectedReasonSchema>;

export const AppMessageSchema = Type.Union([
  Type.Object({
    type: Type.Literal("PING"),
    pingId: Type.String({ minLength: 1, maxLength: 64 }),
    t0: Type.Number({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("PONG"),
    pingId: Type.String({ minLength: 1, maxLength: 64 }),
    t0: Type.Number({ minimum: 0 }),
    t1: Type.Number({ minimum: 0 }),
    t2: Type.Number({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("ROOM_SNAPSHOT"),
    epoch: Type.Integer({ minimum: 0 }),
    roomId: Type.String({ minLength: 1, maxLength: 64 }),
    settings: RoomSettingsSchema,
    members: Type.Array(RoomMemberSchema, { maxItems: 16 }),
    currentTrack: Type.Union([QueueTrackSchema, Type.Null()]),
    anchor: PlaybackAnchorSchema,
    queue: Type.Array(QueueTrackSchema, { maxItems: 500 }),
    autoplayNext: Type.Union([QueueTrackSchema, Type.Null()]),
    history: Type.Optional(Type.Array(QueueTrackSchema, { maxItems: 50 })),
    skipVotes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 16,
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal("SYNC_ANCHOR"),
    epoch: Type.Integer({ minimum: 0 }),
    anchor: PlaybackAnchorSchema,
  }),
  Type.Object({
    type: Type.Literal("QUEUE_UPDATED"),
    epoch: Type.Integer({ minimum: 0 }),
    currentTrack: Type.Union([QueueTrackSchema, Type.Null()]),
    queue: Type.Array(QueueTrackSchema, { maxItems: 500 }),
    autoplayNext: Type.Union([QueueTrackSchema, Type.Null()]),
    history: Type.Optional(Type.Array(QueueTrackSchema, { maxItems: 50 })),
    skipVotes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 16,
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal("MEMBERS_UPDATED"),
    epoch: Type.Integer({ minimum: 0 }),
    members: Type.Array(RoomMemberSchema, { maxItems: 16 }),
  }),
  Type.Object({
    type: Type.Literal("SETTINGS_UPDATED"),
    epoch: Type.Integer({ minimum: 0 }),
    settings: RoomSettingsSchema,
  }),
  Type.Object({
    type: Type.Literal("ROOM_ENDED"),
    reason: Type.Union([
      Type.Literal("host-left"),
      Type.Literal("kicked"),
      Type.Literal("timeout"),
    ]),
    queueSnapshot: Type.Array(QueueTrackSchema, { maxItems: 500 }),
  }),
  Type.Object({
    type: Type.Literal("TRACK_READY"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("TRACK_ENDED"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("TRACK_UNAVAILABLE"),
    seq: Type.Integer({ minimum: 0 }),
    errorCode: Type.Union([
      Type.Integer(),
      Type.String({ minLength: 1, maxLength: 64 }),
    ]),
  }),
  Type.Object({
    type: Type.Literal("AD_STARTED"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("AD_ENDED"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("QUEUE_ADD"),
    videoId: VideoIdSchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    author: Type.String({ maxLength: 120 }),
    durationSec: Type.Integer({ minimum: 1 }),
    thumbnailUrl: ThumbnailUrlSchema,
  }),
  Type.Object({
    type: Type.Literal("QUEUE_REMOVE"),
    entryId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    type: Type.Literal("QUEUE_PIN_NEXT"),
    entryId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    type: Type.Literal("QUEUE_UNPIN"),
    entryId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    type: Type.Literal("QUEUE_REORDER"),
    entryId: Type.String({ minLength: 1, maxLength: 128 }),
    targetIndex: Type.Integer({ minimum: 0, maximum: 500 }),
  }),
  Type.Object({
    type: Type.Literal("HOST_JUMP_TRACK"),
    target: Type.Union([Type.Literal("queue"), Type.Literal("history")]),
    entryId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    type: Type.Literal("VOTE_SKIP"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("SET_LISTENING_MODE"),
    listeningMode: Type.Union([Type.Literal("room"), Type.Literal("local")]),
  }),
  Type.Object({
    type: Type.Literal("AUTOPLAY_CANDIDATES"),
    seedVideoId: VideoIdSchema,
    candidates: Type.Array(QueueTrackMetaSchema, { maxItems: 5 }),
  }),
  Type.Object({
    type: Type.Literal("HOST_TRANSPORT"),
    action: Type.Union([
      Type.Literal("play"),
      Type.Literal("pause"),
      Type.Literal("skip"),
      Type.Literal("seek"),
    ]),
    seekPosSec: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  Type.Object({
    type: Type.Literal("HOST_FORCE_RESUME_FROM_AD"),
    seq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    type: Type.Literal("HOST_MODERATION"),
    targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    action: Type.Union([
      Type.Literal("make-dj"),
      Type.Literal("make-listener"),
      Type.Literal("demote-clear"),
      Type.Literal("kick"),
    ]),
  }),
  Type.Object({
    type: Type.Literal("HOST_UPDATE_SETTINGS"),
    settings: Type.Partial(RoomSettingsSchema),
  }),
  Type.Object({
    type: Type.Literal("ACTION_REJECTED"),
    reason: ActionRejectedReasonSchema,
    retryAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  Type.Object({
    type: Type.Literal("HOST_MIGRATION_PREPARE"),
    targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    ownerPubKey: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.Union([
      Type.Literal("promoted"),
      Type.Literal("host-left"),
      Type.Literal("host-reclaimed"),
    ]),
    settings: RoomSettingsSchema,
    queueSnapshot: Type.Array(QueueTrackSchema, { maxItems: 500 }),
    initialPositionSec: Type.Optional(Type.Number({ minimum: 0 })),
    history: Type.Optional(Type.Array(QueueTrackSchema, { maxItems: 50 })),
  }),
  Type.Object({
    type: Type.Literal("HOST_MIGRATION_READY"),
    newHostPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    newInviteUrl: Type.String({ minLength: 1, maxLength: 4096 }),
  }),
  Type.Object({
    type: Type.Literal("HOST_MIGRATED"),
    newHostPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    newInviteUrl: Type.String({ minLength: 1, maxLength: 4096 }),
    reason: Type.Union([
      Type.Literal("promoted"),
      Type.Literal("host-left"),
      Type.Literal("host-reclaimed"),
    ]),
  }),
  Type.Object({
    type: Type.Literal("FRIEND_REQUEST"),
    targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    fromPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    fromDisplayName: DisplayNameSchema,
    fromTcAddress: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    fromTcPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  }),
  Type.Object({
    type: Type.Literal("FRIEND_ACCEPT"),
    targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    fromPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    fromDisplayName: DisplayNameSchema,
    fromTcAddress: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    fromTcPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  }),
  Type.Object({
    type: Type.Literal("FRIEND_REMOVE"),
    targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
    fromPeerId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
]);
export type AppMessage = Static<typeof AppMessageSchema>;

export const InviteEnvelopeSchema = Type.Object({
  r: Type.String({ minLength: 1, maxLength: 64 }),
  k: Type.String({ minLength: 1, maxLength: 128 }),
  t: Type.String({ minLength: 1, maxLength: 128 }),
  ep: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 6 }),
  ),
  tc: Type.Optional(
    Type.String({
      minLength: 16,
      maxLength: 512,
      pattern: "^tc[A-Za-z0-9_-]+$",
    }),
  ),
  tcp: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  sig: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  exp: Type.Optional(Type.Integer({ minimum: 0 })),
  te: Type.Integer({ minimum: 0, maximum: 4294967295 }),
  s: Type.String({ minLength: 1, maxLength: 256 }),
});
export type InviteEnvelope = Static<typeof InviteEnvelopeSchema>;

const INVITE_URL_PREFIX = "ytmd://listen/v1/";
const INVITE_URL_COMPACT_PREFIX = "ytmd://l/";
const INVITE_V2_VERSION = 0x02;
const LOWERCASE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CROCKFORD_PASSCODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

function collectValidationErrors(
  schema: TSchema,
  value: unknown,
  limit = 5,
): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  for (const err of Value.Errors(schema, value)) {
    errors.push({ path: err.path, message: err.message });
    if (errors.length >= limit) break;
  }
  return errors;
}

export function decodeAppMessage(
  raw: unknown,
  logger: ListenTogetherLogger = noopLogger,
): AppMessage | null {
  if (!Value.Check(AppMessageSchema, raw)) {
    const rawType =
      typeof raw === "object" &&
      raw !== null &&
      "type" in raw &&
      typeof (raw as { type?: unknown }).type === "string"
        ? (raw as { type: string }).type.slice(0, 64)
        : undefined;
    logger.warn?.("Rejected invalid AppMessage", {
      rawKind: raw === null ? "null" : typeof raw,
      messageType: rawType,
      errors: collectValidationErrors(AppMessageSchema, raw),
    });
    return null;
  }
  return raw;
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64UrlBytes(b64u: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(b64u) || b64u.length % 4 === 1) {
    return null;
  }
  const padded = b64u
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(b64u.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeBase64UrlUtf8(b64u: string): string | null {
  const bytes = decodeBase64UrlBytes(b64u);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseStrictIpv4Octets(
  host: string,
): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const raw = match[i];
    if (raw.length > 1 && raw.startsWith("0")) return null;
    const val = Number(raw);
    if (!Number.isInteger(val) || val < 0 || val > 255) return null;
    octets.push(val);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isAlwaysBlockedIpv4([o0, o1]: [
  number,
  number,
  number,
  number,
]): boolean {
  if (o0 === 0) return true; // 0.0.0.0/8 unspecified
  if (o0 === 127) return true; // 127.0.0.0/8 loopback
  if (o0 === 169 && o1 === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (o0 >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

function isPrivateOrCgnatIpv4([o0, o1]: [
  number,
  number,
  number,
  number,
]): boolean {
  if (o0 === 10) return true; // 10.0.0.0/8
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true; // 172.16.0.0/12
  if (o0 === 192 && o1 === 168) return true; // 192.168.0.0/16
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
  return false;
}

function parseIpv6Words(host: string): number[] | null {
  if (!host || host.includes("%") || /\s/.test(host)) return null;
  const doubleColonParts = host.split("::");
  if (doubleColonParts.length > 2) return null;

  const parseSegment = (segment: string, isTail: boolean): number[] | null => {
    if (segment === "") return [];
    const tokens = segment.split(":");
    const words: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.includes(".")) {
        if (!isTail || i !== tokens.length - 1) return null;
        const ipv4 = parseStrictIpv4Octets(token);
        if (!ipv4) return null;
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return null;
        words.push(parseInt(token, 16));
      }
    }
    return words;
  };

  if (doubleColonParts.length === 1) {
    const words = parseSegment(doubleColonParts[0], true);
    return words && words.length === 8 ? words : null;
  }

  const head = parseSegment(doubleColonParts[0], false);
  const tail = parseSegment(doubleColonParts[1], true);
  if (!head || !tail) return null;
  const missing = 8 - (head.length + tail.length);
  if (missing < 1) return null;
  return [...head, ...Array.from<number>({ length: missing }).fill(0), ...tail];
}

function extractEmbeddedIpv4FromIpv6(
  words: number[],
): [number, number, number, number] | null {
  const words0to3Zero =
    words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0;
  if (
    words0to3Zero &&
    words[4] === 0 &&
    (words[5] === 0xffff ||
      (words[5] === 0 && (words[6] !== 0 || words[7] > 1)))
  ) {
    return [
      (words[6] >> 8) & 0xff,
      words[6] & 0xff,
      (words[7] >> 8) & 0xff,
      words[7] & 0xff,
    ];
  }
  if (words0to3Zero && words[4] === 0xffff && words[5] === 0) {
    return [
      (words[6] >> 8) & 0xff,
      words[6] & 0xff,
      (words[7] >> 8) & 0xff,
      words[7] & 0xff,
    ];
  }
  if (
    words[0] === 0x0064 &&
    words[1] === 0xff9b &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0
  ) {
    return [
      (words[6] >> 8) & 0xff,
      words[6] & 0xff,
      (words[7] >> 8) & 0xff,
      words[7] & 0xff,
    ];
  }
  if (words[0] === 0x2002) {
    return [
      (words[1] >> 8) & 0xff,
      words[1] & 0xff,
      (words[2] >> 8) & 0xff,
      words[2] & 0xff,
    ];
  }
  return null;
}

function isAlwaysBlockedIpv6(words: number[]): boolean {
  const allZero = words.every((w) => w === 0);
  if (allZero) return true; // ::
  const isLoopback = words.slice(0, 7).every((w) => w === 0) && words[7] === 1;
  if (isLoopback) return true; // ::1
  if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((words[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(words);
  if (embeddedIpv4 && isAlwaysBlockedIpv4(embeddedIpv4)) return true;

  return false;
}

function isPrivateIpv6(words: number[]): boolean {
  if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(words);
  if (embeddedIpv4 && isPrivateOrCgnatIpv4(embeddedIpv4)) return true;
  return false;
}

function parseStrictPort(portStr: string): number | null {
  if (!/^\d{1,5}$/.test(portStr) || portStr.startsWith("0")) return null;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return port;
}

/**
 * Validates direct P2P endpoints strictly as `IPv4:port` or `[IPv6]:port` with ports 1024..65535,
 * rejecting loopback, unspecified, link-local/metadata, and multicast addresses.
 */
export function isValidDirectEndpoint(
  ep: string,
  logger: ListenTogetherLogger = noopLogger,
): boolean {
  if (!ep || ep.length > 64) {
    logger.warn?.("Rejected direct endpoint", {
      reason: "INVALID_LENGTH",
      length: ep ? ep.length : 0,
    });
    return false;
  }

  if (ep.startsWith("[")) {
    const closeIdx = ep.indexOf("]:");
    if (closeIdx <= 1) {
      logger.warn?.("Rejected direct endpoint", {
        reason: "MALFORMED_IPV6_ENDPOINT",
        endpoint: ep,
      });
      return false;
    }
    const host = ep.slice(1, closeIdx);
    const portStr = ep.slice(closeIdx + 2);
    if (parseStrictPort(portStr) === null) {
      logger.warn?.("Rejected direct endpoint", {
        reason: "INVALID_PORT",
        endpoint: ep,
      });
      return false;
    }
    const words = parseIpv6Words(host);
    if (!words) {
      logger.warn?.("Rejected direct endpoint", {
        reason: "INVALID_IPV6",
        endpoint: ep,
      });
      return false;
    }
    if (isAlwaysBlockedIpv6(words)) {
      logger.warn?.("Rejected direct endpoint", {
        reason: "SSRF_BLOCKED_IPV6",
        endpoint: ep,
      });
      return false;
    }
    return true;
  }

  const colonIdx = ep.lastIndexOf(":");
  if (colonIdx <= 0) {
    logger.warn?.("Rejected direct endpoint", {
      reason: "MALFORMED_IPV4_ENDPOINT",
      endpoint: ep,
    });
    return false;
  }
  const host = ep.slice(0, colonIdx);
  const portStr = ep.slice(colonIdx + 1);
  if (parseStrictPort(portStr) === null) {
    logger.warn?.("Rejected direct endpoint", {
      reason: "INVALID_PORT",
      endpoint: ep,
    });
    return false;
  }
  const octets = parseStrictIpv4Octets(host);
  if (!octets) {
    logger.warn?.("Rejected direct endpoint", {
      reason: "INVALID_IPV4",
      endpoint: ep,
    });
    return false;
  }
  if (isAlwaysBlockedIpv4(octets)) {
    logger.warn?.("Rejected direct endpoint", {
      reason: "SSRF_BLOCKED_IPV4",
      endpoint: ep,
    });
    return false;
  }
  return true;
}

/**
 * Validates signaling server URLs against SSRF constraints (`wss:`/`https:` only, no credentials,
 * never loopback/link-local/metadata; private/Tailscale literals require `allowPrivateLiteral = true`).
 */
export function isAllowedSignalingUrl(
  url: string,
  allowPrivateLiteral = false,
  logger: ListenTogetherLogger = noopLogger,
): boolean {
  const safeUrl = redactLogUrl(url).slice(0, 256);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn?.("Rejected signaling URL", {
      reason: "INVALID_URL",
      url: safeUrl,
    });
    return false;
  }

  if (parsed.protocol !== "wss:" && parsed.protocol !== "https:") {
    logger.warn?.("Rejected signaling URL", {
      reason: "DISALLOWED_PROTOCOL",
      protocol: parsed.protocol,
      url: safeUrl,
    });
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    logger.warn?.("Rejected signaling URL", {
      reason: "CREDENTIALS_NOT_ALLOWED",
      url: safeUrl,
    });
    return false;
  }

  const rawHost = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (!rawHost) {
    logger.warn?.("Rejected signaling URL", {
      reason: "EMPTY_HOST",
      url: safeUrl,
    });
    return false;
  }

  if (
    rawHost === "localhost" ||
    rawHost.endsWith(".localhost") ||
    rawHost === "metadata.google.internal"
  ) {
    logger.warn?.("Rejected signaling URL", {
      reason: "SSRF_BLOCKED_HOST",
      host: rawHost,
      url: safeUrl,
    });
    return false;
  }

function isAllowedIpv6Literal(
  ipv6: string,
  allowPrivateLiteral: boolean,
  safeUrl: string,
  logger: ListenTogetherLogger,
): boolean {
  const words = parseIpv6Words(ipv6);
  if (!words) {
    logger.warn?.("Rejected signaling URL", {
      reason: "INVALID_IPV6",
      url: safeUrl,
    });
    return false;
  }
  if (isAlwaysBlockedIpv6(words)) {
    logger.warn?.("Rejected signaling URL", {
      reason: "SSRF_BLOCKED_IP",
      url: safeUrl,
    });
    return false;
  }
  if (!allowPrivateLiteral && isPrivateIpv6(words)) {
    logger.warn?.("Rejected signaling URL", {
      reason: "SSRF_PRIVATE_IP_DISALLOWED",
      url: safeUrl,
    });
    return false;
  }
  return true;
}

  if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
    return isAllowedIpv6Literal(
      rawHost.slice(1, -1),
      allowPrivateLiteral,
      safeUrl,
      logger,
    );
  }

  const ipv4 = parseStrictIpv4Octets(rawHost);
  if (ipv4) {
    if (isAlwaysBlockedIpv4(ipv4)) {
      logger.warn?.("Rejected signaling URL", {
        reason: "SSRF_BLOCKED_IP",
        url: safeUrl,
      });
      return false;
    }
    if (!allowPrivateLiteral && isPrivateOrCgnatIpv4(ipv4)) {
      logger.warn?.("Rejected signaling URL", {
        reason: "SSRF_PRIVATE_IP_DISALLOWED",
        url: safeUrl,
      });
      return false;
    }
    return true;
  }

  if (rawHost.includes(":")) {
    return isAllowedIpv6Literal(rawHost, allowPrivateLiteral, safeUrl, logger);
  }

  return true;
}

export function normalizePasscode(
  raw: string,
  logger: ListenTogetherLogger = noopLogger,
): string | null {
  const normalized = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (!CROCKFORD_PASSCODE_RE.test(normalized)) {
    logger.debug?.("Rejected invalid passcode format", {
      length: raw.length,
    });
    return null;
  }
  return normalized;
}

function pushVarint(out: number[], value: number): void {
  let n = Math.floor(value);
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n & 0x7f);
}

function readVarint(
  bytes: Uint8Array,
  state: { offset: number },
): number | null {
  let result = 0;
  let multiplier = 1;
  for (let i = 0; i < 8; i++) {
    if (state.offset >= bytes.length) return null;
    const byte = bytes[state.offset++];
    result += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(result)) return null;
    if ((byte & 0x80) === 0) {
      return result;
    }
    multiplier *= 128;
  }
  return null;
}

function pushLengthPrefixedBytes(out: number[], data: Uint8Array): void {
  pushVarint(out, data.length);
  for (let i = 0; i < data.length; i++) {
    out.push(data[i]);
  }
}

function readLengthPrefixedBytes(
  bytes: Uint8Array,
  state: { offset: number },
  maxLen = 2048,
): Uint8Array | null {
  const len = readVarint(bytes, state);
  if (len === null || len < 0 || len > maxLen) return null;
  if (state.offset + len > bytes.length) return null;
  const slice = bytes.subarray(state.offset, state.offset + len);
  state.offset += len;
  return slice;
}

function tryDecodeCanonicalBase64Url(value: string): Uint8Array | null {
  const bytes = decodeBase64UrlBytes(value);
  if (!bytes) return null;
  return encodeBase64UrlBytes(bytes) === value ? bytes : null;
}

function packInviteEnvelopeV2(envelope: InviteEnvelope): Uint8Array {
  const encoder = new TextEncoder();
  const body: number[] = [];
  let flags = 0;

  // r
  if (LOWERCASE_UUID_RE.test(envelope.r)) {
    flags |= 1 << 0;
    const hex = envelope.r.replace(/-/g, "");
    for (let i = 0; i < 32; i += 2) {
      body.push(parseInt(hex.slice(i, i + 2), 16));
    }
  } else {
    pushLengthPrefixedBytes(body, encoder.encode(envelope.r));
  }

  // k
  const kRaw = tryDecodeCanonicalBase64Url(envelope.k);
  if (kRaw) {
    flags |= 1 << 1;
    pushLengthPrefixedBytes(body, kRaw);
  } else {
    pushLengthPrefixedBytes(body, encoder.encode(envelope.k));
  }

  // t
  const tRaw = tryDecodeCanonicalBase64Url(envelope.t);
  if (tRaw) {
    flags |= 1 << 2;
    pushLengthPrefixedBytes(body, tRaw);
  } else {
    pushLengthPrefixedBytes(body, encoder.encode(envelope.t));
  }

  // te
  pushVarint(body, envelope.te);

  // s
  const sRaw = tryDecodeCanonicalBase64Url(envelope.s);
  if (sRaw) {
    flags |= 1 << 3;
    pushLengthPrefixedBytes(body, sRaw);
  } else {
    pushLengthPrefixedBytes(body, encoder.encode(envelope.s));
  }

  // ep
  if (envelope.ep !== undefined) {
    flags |= 1 << 4;
    body.push(envelope.ep.length & 0xff);
    for (const ep of envelope.ep) {
      const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/.exec(ep);
      const ipv4 = m ? parseStrictIpv4Octets(m[1]) : null;
      const port = m ? Number(m[2]) : 0;
      if (ipv4 && port >= 1 && port <= 65535) {
        body.push(0x04, ipv4[0], ipv4[1], ipv4[2], ipv4[3], port >> 8, port & 0xff);
      } else {
        body.push(0x00);
        pushLengthPrefixedBytes(body, encoder.encode(ep));
      }
    }
  }

  // tc
  if (envelope.tc !== undefined) {
    flags |= 1 << 5;
    const stripped = envelope.tc.slice(2);
    const tcRaw = tryDecodeCanonicalBase64Url(stripped);
    if (tcRaw) {
      flags |= 1 << 6;
      pushLengthPrefixedBytes(body, tcRaw);
    } else {
      pushLengthPrefixedBytes(body, encoder.encode(envelope.tc));
    }
  }

  // tcp
  if (envelope.tcp !== undefined) {
    flags |= 1 << 7;
    body.push((envelope.tcp >> 8) & 0xff, envelope.tcp & 0xff);
  }

  // sig
  if (envelope.sig !== undefined) {
    flags |= 1 << 8;
    pushLengthPrefixedBytes(body, encoder.encode(envelope.sig));
  }

  // exp
  if (envelope.exp !== undefined) {
    flags |= 1 << 9;
    pushVarint(body, envelope.exp);
  }

  const out = new Uint8Array(3 + body.length);
  out[0] = INVITE_V2_VERSION;
  out[1] = (flags >> 8) & 0xff;
  out[2] = flags & 0xff;
  out.set(body, 3);
  return out;
}

function unpackInviteEnvelopeV2(bytes: Uint8Array): InviteEnvelope | null {
  if (bytes.length < 3 || bytes[0] !== INVITE_V2_VERSION) {
    return null;
  }
  const flags = (bytes[1] << 8) | bytes[2];
  if ((flags & ~0x03ff) !== 0) {
    return null;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const state = { offset: 3 };

  try {
    let r: string;
    if (flags & (1 << 0)) {
      if (state.offset + 16 > bytes.length) return null;
      const hex: string[] = [];
      for (let i = 0; i < 16; i++) {
        hex.push(bytes[state.offset++].toString(16).padStart(2, "0"));
      }
      const joined = hex.join("");
      r = `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
    } else {
      const rBytes = readLengthPrefixedBytes(bytes, state, 128);
      if (!rBytes) return null;
      r = decoder.decode(rBytes);
    }

    const kBytes = readLengthPrefixedBytes(bytes, state, 256);
    if (!kBytes) return null;
    const k = flags & (1 << 1) ? encodeBase64UrlBytes(kBytes) : decoder.decode(kBytes);

    const tBytes = readLengthPrefixedBytes(bytes, state, 256);
    if (!tBytes) return null;
    const t = flags & (1 << 2) ? encodeBase64UrlBytes(tBytes) : decoder.decode(tBytes);

    const te = readVarint(bytes, state);
    if (te === null) return null;

    const sBytes = readLengthPrefixedBytes(bytes, state, 512);
    if (!sBytes) return null;
    const s = flags & (1 << 3) ? encodeBase64UrlBytes(sBytes) : decoder.decode(sBytes);

    const envelope: InviteEnvelope = { r, k, t, te, s };

    if (flags & (1 << 4)) {
      if (state.offset >= bytes.length) return null;
      const count = bytes[state.offset++];
      if (count > 6) return null;
      const ep: string[] = [];
      for (let i = 0; i < count; i++) {
        if (state.offset >= bytes.length) return null;
        const kind = bytes[state.offset++];
        if (kind === 0x04) {
          if (state.offset + 6 > bytes.length) return null;
          const o0 = bytes[state.offset++];
          const o1 = bytes[state.offset++];
          const o2 = bytes[state.offset++];
          const o3 = bytes[state.offset++];
          const port = (bytes[state.offset++] << 8) | bytes[state.offset++];
          ep.push(`${o0}.${o1}.${o2}.${o3}:${port}`);
        } else if (kind === 0x00) {
          const epBytes = readLengthPrefixedBytes(bytes, state, 128);
          if (!epBytes) return null;
          ep.push(decoder.decode(epBytes));
        } else {
          return null;
        }
      }
      envelope.ep = ep;
    }

    if (flags & (1 << 5)) {
      const tcBytes = readLengthPrefixedBytes(bytes, state, 512);
      if (!tcBytes) return null;
      envelope.tc =
        flags & (1 << 6)
          ? `tc${encodeBase64UrlBytes(tcBytes)}`
          : decoder.decode(tcBytes);
    } else if (flags & (1 << 6)) {
      return null;
    }

    if (flags & (1 << 7)) {
      if (state.offset + 2 > bytes.length) return null;
      envelope.tcp = (bytes[state.offset++] << 8) | bytes[state.offset++];
    }

    if (flags & (1 << 8)) {
      const sigBytes = readLengthPrefixedBytes(bytes, state, 512);
      if (!sigBytes) return null;
      envelope.sig = decoder.decode(sigBytes);
    }

    if (flags & (1 << 9)) {
      const exp = readVarint(bytes, state);
      if (exp === null) return null;
      envelope.exp = exp;
    }

    if (state.offset !== bytes.length) {
      return null;
    }

    return envelope;
  } catch {
    return null;
  }
}

function validateInviteEndpointsAndSignaling(
  envelope: Pick<InviteEnvelope, "r" | "ep" | "sig">,
  logger: ListenTogetherLogger,
  safeUrl?: string,
): string | null {
  if (envelope.ep) {
    if (envelope.ep.length > 6) {
      if (safeUrl !== undefined) {
        logger.warn?.("Rejected invite URL", {
          reason: "TOO_MANY_DIRECT_ENDPOINTS",
          roomId: envelope.r,
          count: envelope.ep.length,
          url: safeUrl,
        });
      } else {
        logger.warn?.("Rejected invite envelope: too many direct endpoints", {
          roomId: envelope.r,
          count: envelope.ep.length,
        });
      }
      return "Invalid direct endpoint in invite envelope";
    }
    if (envelope.ep.some((ep) => !isValidDirectEndpoint(ep, logger))) {
      if (safeUrl !== undefined) {
        logger.warn?.("Rejected invite URL", {
          reason: "INVALID_DIRECT_ENDPOINT",
          roomId: envelope.r,
          url: safeUrl,
        });
      }
      return "Invalid direct endpoint in invite envelope";
    }
  }
  if (
    envelope.sig !== undefined &&
    !isAllowedSignalingUrl(envelope.sig, true, logger)
  ) {
    if (safeUrl !== undefined) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_SIGNALING_URL",
        roomId: envelope.r,
        url: safeUrl,
      });
    }
    return "Invalid signaling URL in invite envelope";
  }
  return null;
}

export function encodeInviteUrl(
  envelope: InviteEnvelope,
  logger: ListenTogetherLogger = noopLogger,
): string {
  if (!Value.Check(InviteEnvelopeSchema, envelope)) {
    logger.warn?.("Rejected invalid invite envelope during encode", {
      errors: collectValidationErrors(InviteEnvelopeSchema, envelope),
    });
    throw new Error("Invalid invite envelope");
  }
  const validationError = validateInviteEndpointsAndSignaling(envelope, logger);
  if (validationError) {
    throw new Error(validationError);
  }
  return INVITE_URL_COMPACT_PREFIX + encodeBase64UrlBytes(packInviteEnvelopeV2(envelope));
}

export function parseInviteUrl(
  rawUrl: string,
  logger: ListenTogetherLogger = noopLogger,
): InviteEnvelope | null {
  const safeUrl =
    typeof rawUrl === "string" ? redactInviteUrl(rawUrl).slice(0, 256) : "";
  if (typeof rawUrl !== "string") {
    logger.warn?.("Rejected invite URL", {
      reason: "INVALID_PREFIX",
      url: safeUrl,
    });
    return null;
  }

  let parsed: unknown;
  if (rawUrl.startsWith(INVITE_URL_COMPACT_PREFIX)) {
    const encoded = rawUrl.slice(INVITE_URL_COMPACT_PREFIX.length);
    if (!encoded || encoded.length > 4096) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_LENGTH",
        length: encoded.length,
        url: safeUrl,
      });
      return null;
    }
    const rawBytes = decodeBase64UrlBytes(encoded);
    if (rawBytes === null) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_BASE64URL",
        url: safeUrl,
      });
      return null;
    }
    parsed = unpackInviteEnvelopeV2(rawBytes);
    if (parsed === null) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_COMPACT_PAYLOAD",
        url: safeUrl,
      });
      return null;
    }
  } else if (rawUrl.startsWith(INVITE_URL_PREFIX)) {
    const encoded = rawUrl.slice(INVITE_URL_PREFIX.length);
    if (!encoded || encoded.length > 4096) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_LENGTH",
        length: encoded.length,
        url: safeUrl,
      });
      return null;
    }
    const json = decodeBase64UrlUtf8(encoded);
    if (json === null) {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_BASE64URL",
        url: safeUrl,
      });
      return null;
    }
    try {
      parsed = JSON.parse(json);
    } catch {
      logger.warn?.("Rejected invite URL", {
        reason: "INVALID_JSON",
        url: safeUrl,
      });
      return null;
    }
  } else {
    logger.warn?.("Rejected invite URL", {
      reason: "INVALID_PREFIX",
      url: safeUrl,
    });
    return null;
  }
  if (!Value.Check(InviteEnvelopeSchema, parsed)) {
    logger.warn?.("Rejected invite URL", {
      reason: "SCHEMA_VALIDATION_FAILED",
      url: safeUrl,
      errors: collectValidationErrors(InviteEnvelopeSchema, parsed),
    });
    return null;
  }
  if (validateInviteEndpointsAndSignaling(parsed, logger, safeUrl)) {
    return null;
  }
  return parsed;
}
