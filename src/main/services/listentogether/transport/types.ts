import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import WebSocket, { type RawData } from "ws";
import {
  noopLogger,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";

export function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data as Uint8Array);
}

export function parseIpv4Octets(
  ip: string,
): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const val = Number(part);
    if (!Number.isInteger(val) || val < 0 || val > 255) return null;
    nums.push(val);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

export function createTransportConnection(
  ws: WebSocket,
  options: {
    id: string;
    mode: TransportMode;
    remoteLabel: string;
    onClose?: () => void;
  },
): { conn: TransportConnection; emitError: (error: Error) => void } {
  const messageHandlers = new Set<(data: Buffer) => void>();
  const closeHandlers = new Set<(code: number, reason: string) => void>();
  const errorHandlers = new Set<(error: Error) => void>();

  const emitError = (err: Error) => {
    for (const handler of errorHandlers) {
      handler(err);
    }
  };

  ws.on("message", (data: RawData) => {
    const buf = rawDataToBuffer(data);
    for (const handler of messageHandlers) {
      handler(buf);
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    options.onClose?.();
    const reasonStr = reason.toString("utf8");
    for (const handler of closeHandlers) {
      handler(code, reasonStr);
    }
  });

  ws.on("error", emitError);

  const conn: TransportConnection = {
    id: options.id,
    mode: options.mode,
    remoteLabel: options.remoteLabel,
    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    send(data: Uint8Array | Buffer) {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(data);
    },
    close(code?: number, reason?: string) {
      options.onClose?.();
      if (
        ws.readyState === WebSocket.CLOSING ||
        ws.readyState === WebSocket.CLOSED
      ) {
        return;
      }
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
        return;
      }
      ws.close(code, reason);
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
  };

  return { conn, emitError };
}

export type TransportMode = "direct" | "tailcat" | "relay";

export type DiscoveredLanRoom = {
  lookupId: string;
  host: string;
  port: number;
  label: string;
  endpoint: string;
  lastSeenMs: number;
};

export interface TransportConnection {
  readonly id: string;
  readonly mode: TransportMode;
  readonly remoteLabel: string;
  readonly isOpen: boolean;
  send(data: Uint8Array | Buffer): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: Buffer) => void): () => void;
  onClose(handler: (code: number, reason: string) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
}

export interface ITransport {
  readonly mode: TransportMode;
  connect(signal?: AbortSignal): Promise<TransportConnection>;
  close(): void;
}

export const RelayHostCreateSchema = Type.Object({
  type: Type.Literal("HOST_CREATE"),
  lookupId: Type.String({ minLength: 1, maxLength: 128 }),
  hostPubKey: Type.String({ minLength: 1, maxLength: 1024 }),
  sig: Type.String({ minLength: 1, maxLength: 1024 }),
});
export type RelayHostCreate = Static<typeof RelayHostCreateSchema>;

export const RelayHostResumeSchema = Type.Object({
  type: Type.Literal("HOST_RESUME"),
  lookupId: Type.String({ minLength: 1, maxLength: 128 }),
  hostPubKey: Type.String({ minLength: 1, maxLength: 1024 }),
  challengeSig: Type.String({ minLength: 1, maxLength: 1024 }),
});
export type RelayHostResume = Static<typeof RelayHostResumeSchema>;

export const RelayHostChallengeSchema = Type.Object({
  type: Type.Literal("HOST_CHALLENGE"),
  challenge: Type.String({ minLength: 1, maxLength: 256 }),
});
export type RelayHostChallenge = Static<typeof RelayHostChallengeSchema>;

export const RelayGuestJoinSchema = Type.Object({
  type: Type.Literal("GUEST_JOIN"),
  lookupId: Type.String({ minLength: 1, maxLength: 128 }),
  relayPeerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type RelayGuestJoin = Static<typeof RelayGuestJoinSchema>;

export const RelayPeerAdmittedSchema = Type.Object({
  type: Type.Literal("RELAY_PEER_ADMITTED"),
  relayPeerId: Type.String({ minLength: 1, maxLength: 128 }),
});
export type RelayPeerAdmitted = Static<typeof RelayPeerAdmittedSchema>;

export const RelayDropPeerSchema = Type.Object({
  type: Type.Literal("RELAY_DROP_PEER"),
  relayPeerId: Type.String({ minLength: 1, maxLength: 128 }),
  reason: Type.Optional(Type.String({ maxLength: 128 })),
});
export type RelayDropPeer = Static<typeof RelayDropPeerSchema>;

export const RelayFrameSchema = Type.Object({
  type: Type.Literal("RELAY_FRAME"),
  targetPeerId: Type.String({ minLength: 1, maxLength: 128 }),
  payloadB64: Type.String({ minLength: 1, maxLength: 1048576 }),
  fromPeerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type RelayFrame = Static<typeof RelayFrameSchema>;

export const RelayErrorSchema = Type.Object({
  type: Type.Literal("RELAY_ERROR"),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  message: Type.String({ maxLength: 256 }),
});
export type RelayError = Static<typeof RelayErrorSchema>;

export const RelayControlMessageSchema = Type.Union([
  RelayHostCreateSchema,
  RelayHostResumeSchema,
  RelayHostChallengeSchema,
  RelayGuestJoinSchema,
  RelayPeerAdmittedSchema,
  RelayDropPeerSchema,
  RelayFrameSchema,
  RelayErrorSchema,
]);
export type RelayControlMessage = Static<typeof RelayControlMessageSchema>;

export function decodeRelayControlMessage(
  raw: unknown,
  logger: ListenTogetherLogger = noopLogger,
): RelayControlMessage | null {
  if (!Value.Check(RelayControlMessageSchema, raw)) {
    logger.warn?.("Rejected invalid RelayControlMessage", {
      rawType:
        typeof raw === "object" &&
        raw !== null &&
        "type" in raw &&
        typeof (raw as { type?: unknown }).type === "string"
          ? (raw as { type: string }).type
          : undefined,
    });
    return null;
  }
  return raw;
}

export function parseRelayControlMessage(
  raw: RawData,
  logger: ListenTogetherLogger = noopLogger,
  invalidJsonMessage = "Received invalid JSON relay frame",
): RelayControlMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDataToBuffer(raw).toString("utf8"));
  } catch {
    logger.warn?.(invalidJsonMessage);
    return null;
  }
  return decodeRelayControlMessage(parsed, logger);
}
