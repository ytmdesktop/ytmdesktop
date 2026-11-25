import "./ws-env";
import crypto, { type KeyObject } from "node:crypto";
import dns from "node:dns";
import type { ClientRequestArgs } from "node:http";
import net from "node:net";
import WebSocket, { type RawData } from "ws";
import {
  noopLogger,
  redactLogUrl,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import { isAllowedSignalingUrl } from "~shared/listentogether/protocol";
import { signEd25519 } from "../crypto";
import {
  parseIpv4Octets,
  parseRelayControlMessage,
  type ITransport,
  type RelayControlMessage,
  type TransportConnection,
} from "./types";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type DnsLookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<dns.LookupAddress[]>;

export type ResolvedRelayTarget = {
  url: URL;
  addresses: dns.LookupAddress[];
};

const defaultDnsLookup: DnsLookupFn = (hostname, options) =>
  dns.promises.lookup(hostname, options);

function decodeStrictBase64(b64: string): Buffer | null {
  if (
    typeof b64 !== "string" ||
    b64.length === 0 ||
    b64.length % 4 !== 0 ||
    !BASE64_RE.test(b64)
  ) {
    return null;
  }
  return Buffer.from(b64, "base64");
}

function isDisallowedDnsIpv4([o0, o1]: [
  number,
  number,
  number,
  number,
]): boolean {
  if (o0 === 0) return true; // 0.0.0.0/8 unspecified
  if (o0 === 10) return true; // 10.0.0.0/8 private
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
  if (o0 === 127) return true; // 127.0.0.0/8 loopback
  if (o0 === 169 && o1 === 254) return true; // 169.254.0.0/16 link-local / metadata
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true; // 172.16.0.0/12 private
  if (o0 === 192 && o1 === 168) return true; // 192.168.0.0/16 private
  if (o0 >= 224) return true; // multicast / reserved
  return false;
}

function expandIpv6Words(ip: string): number[] | null {
  const clean = ip.split("%")[0];
  const halves = clean.split("::");
  if (halves.length > 2) return null;

  const parsePart = (part: string, isTail: boolean): number[] | null => {
    if (part === "") return [];
    const tokens = part.split(":");
    const words: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.includes(".")) {
        if (!isTail || i !== tokens.length - 1) return null;
        const v4 = parseIpv4Octets(token);
        if (!v4) return null;
        words.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return null;
        words.push(parseInt(token, 16));
      }
    }
    return words;
  };

  if (halves.length === 1) {
    const words = parsePart(halves[0], true);
    return words && words.length === 8 ? words : null;
  }

  const head = parsePart(halves[0], false);
  const tail = parsePart(halves[1], true);
  if (!head || !tail) return null;
  const missing = 8 - (head.length + tail.length);
  if (missing < 1) return null;
  return [...head, ...Array.from<number>({ length: missing }).fill(0), ...tail];
}

function isDisallowedDnsIp(address: string): boolean {
  const v4 = parseIpv4Octets(address);
  if (v4) {
    return isDisallowedDnsIpv4(v4);
  }
  const words = expandIpv6Words(address);
  if (!words) return true;
  if (words.every((w) => w === 0)) return true; // ::
  if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true; // ::1
  if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((words[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  const zeroPrefix =
    words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0;
  if (
    zeroPrefix &&
    ((words[4] === 0 && (words[5] === 0xffff || words[5] === 0)) ||
      (words[4] === 0xffff && words[5] === 0))
  ) {
    const embedded: [number, number, number, number] = [
      (words[6] >> 8) & 0xff,
      words[6] & 0xff,
      (words[7] >> 8) & 0xff,
      words[7] & 0xff,
    ];
    return isDisallowedDnsIpv4(embedded);
  }
  if (
    words[0] === 0x0064 &&
    words[1] === 0xff9b &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0
  ) {
    return isDisallowedDnsIpv4([
      (words[6] >> 8) & 0xff,
      words[6] & 0xff,
      (words[7] >> 8) & 0xff,
      words[7] & 0xff,
    ]);
  }
  if (words[0] === 0x2002) {
    return isDisallowedDnsIpv4([
      (words[1] >> 8) & 0xff,
      words[1] & 0xff,
      (words[2] >> 8) & 0xff,
      words[2] & 0xff,
    ]);
  }
  return false;
}

/**
 * Validates a signaling URL against SSRF and DNS rebinding attacks.
 * DNS-resolved hostnames are blocked from resolving to loopback, link-local, metadata, or private ranges.
 */
export async function resolveAndValidateRelayUrl(
  urlStr: string,
  allowPrivateLiteral = false,
  lookupFn: DnsLookupFn = defaultDnsLookup,
  logger: ListenTogetherLogger = noopLogger,
): Promise<ResolvedRelayTarget> {
  if (!isAllowedSignalingUrl(urlStr, allowPrivateLiteral, logger)) {
    throw new Error(`Disallowed signaling URL: ${redactLogUrl(urlStr)}`);
  }

  const parsed = new URL(urlStr);
  if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  }

  const bareHost =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  const ipFamily = net.isIP(bareHost);
  if (ipFamily === 4 || ipFamily === 6) {
    return {
      url: parsed,
      addresses: [{ address: bareHost, family: ipFamily }],
    };
  }

  let resolved: dns.LookupAddress[];
  try {
    resolved = await lookupFn(bareHost, { all: true });
  } catch (err) {
    logger.warn?.("Relay DNS lookup failed", {
      host: bareHost,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  if (!resolved || resolved.length === 0) {
    logger.warn?.("Relay DNS lookup returned no addresses", { host: bareHost });
    throw new Error(`Relay DNS lookup returned no addresses for ${bareHost}`);
  }

  for (const entry of resolved) {
    if (isDisallowedDnsIp(entry.address)) {
      logger.warn?.("Blocked relay DNS rebinding address", {
        host: bareHost,
        address: entry.address,
      });
      throw new Error(
        `Relay DNS resolved to disallowed IP address for ${bareHost}`,
      );
    }
  }

  logger.debug?.("Validated relay target DNS resolution", {
    host: bareHost,
    addressCount: resolved.length,
  });

  return {
    url: parsed,
    addresses: resolved,
  };
}

function createPinnedLookup(
  addresses: dns.LookupAddress[],
): NonNullable<ClientRequestArgs["lookup"]> {
  return ((_hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    if (typeof options === "object" && options !== null && options.all) {
      (
        cb as (
          err: NodeJS.ErrnoException | null,
          addresses: dns.LookupAddress[],
        ) => void
      )(null, addresses);
      return;
    }
    const first = addresses[0];
    (
      cb as (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void
    )(null, first.address, first.family);
  }) as NonNullable<ClientRequestArgs["lookup"]>;
}

function startHeartbeat(
  ws: WebSocket,
  intervalMs: number,
  logger: ListenTogetherLogger,
  role: "guest" | "host",
): () => void {
  if (intervalMs <= 0) {
    return () => {};
  }
  let isAlive = true;
  const onPong = () => {
    isAlive = true;
  };
  ws.on("pong", onPong);

  const timer = setInterval(() => {
    if (!isAlive) {
      logger.warn?.("Relay WebSocket missed ping heartbeat, terminating", {
        role,
        intervalMs,
      });
      ws.terminate();
      return;
    }
    isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, intervalMs);

  return () => {
    clearInterval(timer);
    ws.removeListener("pong", onPong);
  };
}

function connectRelayWebSocket(params: {
  target: ResolvedRelayTarget;
  signalingUrl: string;
  timeoutMs: number;
  rejectUnauthorized?: boolean;
  createWebSocket?: WebSocketFactory;
  signal?: AbortSignal;
  logger: ListenTogetherLogger;
  role: "guest" | "host";
  onOpenSocket?: (ws: WebSocket) => void;
}): Promise<WebSocket> {
  const { target, timeoutMs, logger, role } = params;
  const safeUrl = redactLogUrl(params.signalingUrl);

  return new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const makeWs =
      params.createWebSocket ?? ((url, opts) => new WebSocket(url, opts));
    const socket = makeWs(target.url, {
      followRedirects: false,
      maxRedirects: 0,
      handshakeTimeout: timeoutMs,
      maxPayload: DEFAULT_MAX_PAYLOAD_BYTES,
      skipUTF8Validation: true,
      rejectUnauthorized: params.rejectUnauthorized,
      lookup: createPinnedLookup(target.addresses),
    });

    const cleanup = () => {
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.on("error", () => {});
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      reject(err);
    };

    const onAbort = () => {
      logger.debug?.("Relay WebSocket connection aborted", {
        role,
        url: safeUrl,
      });
      fail(new Error("Relay WebSocket connection aborted"));
    };

    const timer = setTimeout(() => {
      logger.warn?.("Relay WebSocket handshake timed out", {
        role,
        url: safeUrl,
        timeoutMs,
      });
      fail(new Error(`Relay WebSocket timeout connecting to ${safeUrl}`));
    }, timeoutMs);

    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      params.onOpenSocket?.(socket);
      resolve(socket);
    };

    const onError = (err: Error) => {
      if (/Unexpected server response: 30\d/.test(err.message)) {
        logger.warn?.(
          "Blocked HTTP redirect during Relay WebSocket handshake",
          {
            role,
            url: safeUrl,
            error: err.message,
          },
        );
      } else {
        logger.warn?.("Relay WebSocket handshake error", {
          role,
          url: safeUrl,
          code: (err as NodeJS.ErrnoException).code,
          error: err.message,
        });
      }
      fail(err);
    };

    const onClose = (code: number) => {
      logger.warn?.("Relay WebSocket closed before open", {
        role,
        url: safeUrl,
        code,
      });
      fail(new Error(`Relay WebSocket closed before open (${code})`));
    };

    params.signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/**
 * Builds the UTF-8 challenge buffer signed by Ed25519 for relay `HOST_CREATE` and `HOST_RESUME`.
 */
export function buildRelayChallengePayload(challenge: string): Buffer {
  return Buffer.from(challenge, "utf8");
}

export type WebSocketFactory = (
  url: URL,
  options: WebSocket.ClientOptions & ClientRequestArgs,
) => WebSocket;

export type RelayWsTransportOptions = {
  signalingUrl: string;
  lookupId: string;
  allowPrivateLiteral?: boolean;
  lookupFn?: DnsLookupFn;
  createWebSocket?: WebSocketFactory;
  timeoutMs?: number;
  heartbeatIntervalMs?: number;
  rejectUnauthorized?: boolean;
  logger?: ListenTogetherLogger;
};

/**
 * Guest-side Relay WebSocket transport implementing `ITransport` with SSRF/DNS-rebinding checks,
 * disabled HTTP redirects, and a 20s ping heartbeat.
 */
export class RelayWsTransport implements ITransport {
  public readonly mode = "relay" as const;
  private readonly options: RelayWsTransportOptions;
  private readonly logger: ListenTogetherLogger;
  private activeController: AbortController | null = null;
  private activeConn: TransportConnection | null = null;

  constructor(options: RelayWsTransportOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
  }

  public async connect(signal?: AbortSignal): Promise<TransportConnection> {
    if (signal?.aborted) {
      throw new Error("Relay WebSocket connection aborted");
    }

    const controller = new AbortController();
    this.activeController = controller;
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const target = await resolveAndValidateRelayUrl(
        this.options.signalingUrl,
        this.options.allowPrivateLiteral ?? false,
        this.options.lookupFn ?? defaultDnsLookup,
        this.logger,
      );

      if (controller.signal.aborted) {
        throw new Error("Relay WebSocket connection aborted");
      }

      const timeoutMs = this.options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      const heartbeatMs =
        this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

      const messageHandlers = new Set<(data: Buffer) => void>();
      const closeHandlers = new Set<(code: number, reason: string) => void>();
      const errorHandlers = new Set<(error: Error) => void>();
      let stopHeartbeat: () => void = () => {};
      let openedSocket: WebSocket | undefined;
      let joinSettled = false;
      let resolveJoin!: () => void;
      let rejectJoin!: (err: Error) => void;
      const joinAckPromise = new Promise<void>((resolve, reject) => {
        resolveJoin = resolve;
        rejectJoin = reject;
      });
      // Prevent unhandled rejection if connectRelayWebSocket fails before joinAckPromise is awaited
      joinAckPromise.catch(() => {});

      let joinTimer: NodeJS.Timeout | null = null;
      const cleanupJoinWait = () => {
        if (joinTimer) {
          clearTimeout(joinTimer);
          joinTimer = null;
        }
        controller.signal.removeEventListener("abort", onJoinAbort);
      };
      const failJoin = (err: Error, wsToClose?: WebSocket) => {
        if (joinSettled) return;
        joinSettled = true;
        cleanupJoinWait();
        stopHeartbeat();
        const targetWs = wsToClose ?? openedSocket;
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.close(1008, "Join failed");
        }
        rejectJoin(err);
      };
      const onJoinAbort = () => {
        failJoin(new Error("Relay WebSocket connection aborted"));
      };

      const ws = await connectRelayWebSocket({
        target,
        signalingUrl: this.options.signalingUrl,
        timeoutMs,
        rejectUnauthorized: this.options.rejectUnauthorized,
        createWebSocket: this.options.createWebSocket,
        signal: controller.signal,
        logger: this.logger,
        role: "guest",
        onOpenSocket: (openedWs) => {
          openedSocket = openedWs;
          stopHeartbeat = startHeartbeat(
            openedWs,
            heartbeatMs,
            this.logger,
            "guest",
          );
          controller.signal.addEventListener("abort", onJoinAbort, {
            once: true,
          });
          if (timeoutMs > 0) {
            joinTimer = setTimeout(() => {
              failJoin(
                new Error(`Relay GUEST_JOIN timed out after ${timeoutMs} ms`),
                openedWs,
              );
            }, timeoutMs);
          }

          openedWs.on("message", (raw: RawData) => {
            const msg = parseRelayControlMessage(
              raw,
              this.logger,
              "RelayWsTransport received invalid JSON frame",
            );
            if (!msg) return;

            if (msg.type === "HOST_CHALLENGE") {
              return;
            }
            if (msg.type === "GUEST_JOIN") {
              if (!joinSettled) {
                joinSettled = true;
                cleanupJoinWait();
                resolveJoin();
              }
              return;
            }
            if (msg.type === "RELAY_PEER_ADMITTED") {
              return;
            }
            if (msg.type === "RELAY_FRAME") {
              const payload = decodeStrictBase64(msg.payloadB64);
              if (!payload) {
                this.logger.warn?.(
                  "RelayWsTransport received malformed base64 frame",
                );
                return;
              }
              for (const handler of messageHandlers) {
                handler(payload);
              }
            } else if (msg.type === "RELAY_DROP_PEER") {
              this.logger.info?.("Relay dropped peer", { reason: msg.reason });
              openedWs.close(1000, msg.reason ?? "Dropped by host");
            } else if (msg.type === "RELAY_ERROR") {
              this.logger.warn?.("RelayWsTransport received RELAY_ERROR", {
                code: msg.code,
                message: msg.message,
              });
              const err = new Error(
                `Relay error (${msg.code}): ${msg.message}`,
              );
              if (!joinSettled) {
                failJoin(err, openedWs);
                return;
              }
              for (const handler of errorHandlers) {
                handler(err);
              }
              openedWs.close(1008, msg.code);
            }
          });

          openedWs.on("close", (code: number, reason: Buffer) => {
            stopHeartbeat();
            const reasonStr = reason.toString("utf8");
            if (!joinSettled) {
              failJoin(
                new Error(
                  `Relay WebSocket closed before GUEST_JOIN ack (${code}${reasonStr ? `: ${reasonStr}` : ""})`,
                ),
              );
              return;
            }
            this.logger.info?.("RelayWsTransport disconnected", {
              lookupId: this.options.lookupId,
              code,
              reason: reasonStr,
            });
            for (const handler of closeHandlers) {
              handler(code, reasonStr);
            }
          });

          openedWs.on("error", (err: Error) => {
            this.logger.warn?.("RelayWsTransport socket error", {
              lookupId: this.options.lookupId,
              error: err.message,
            });
            if (!joinSettled) {
              failJoin(err, openedWs);
              return;
            }
            for (const handler of errorHandlers) {
              handler(err);
            }
          });
        },
      });

      ws.send(
        JSON.stringify({
          type: "GUEST_JOIN",
          lookupId: this.options.lookupId,
        } satisfies RelayControlMessage),
      );
      await joinAckPromise;
      this.logger.info?.("RelayWsTransport connected and joined room", {
        lookupId: this.options.lookupId,
        url: redactLogUrl(this.options.signalingUrl),
      });

      const conn: TransportConnection = {
        id: `relay-${crypto.randomUUID()}`,
        mode: "relay",
        remoteLabel: redactLogUrl(this.options.signalingUrl),
        get isOpen() {
          return ws.readyState === WebSocket.OPEN;
        },
        send(data: Uint8Array | Buffer) {
          if (ws.readyState !== WebSocket.OPEN) return;
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          ws.send(
            JSON.stringify({
              type: "RELAY_FRAME",
              targetPeerId: "host",
              payloadB64: buf.toString("base64"),
            } satisfies RelayControlMessage),
          );
        },
        close(code?: number, reason?: string) {
          if (
            ws.readyState === WebSocket.CLOSING ||
            ws.readyState === WebSocket.CLOSED
          ) {
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

      this.activeConn = conn;
      return conn;
    } finally {
      signal?.removeEventListener("abort", onExternalAbort);
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  public close(): void {
    this.activeController?.abort();
    this.activeConn?.close();
  }
}

export type RelayHostClientOptions = {
  signalingUrl: string;
  lookupId: string;
  hostPubKeyB64: string;
  hostPrivKey: KeyObject;
  allowPrivateLiteral?: boolean;
  lookupFn?: DnsLookupFn;
  createWebSocket?: WebSocketFactory;
  timeoutMs?: number;
  heartbeatIntervalMs?: number;
  rejectUnauthorized?: boolean;
  logger?: ListenTogetherLogger;
};

type VirtualPeerRecord = {
  conn: TransportConnection;
  isOpen: boolean;
  emitMessage: (buf: Buffer) => void;
  emitClose: (code: number, reason: string) => void;
};

/**
 * Host-side Relay WebSocket client handling `HOST_CREATE` / `HOST_RESUME` challenge signing
 * and `RELAY_FRAME` multiplexing per `relayPeerId`.
 */
export class RelayHostClient {
  private readonly options: RelayHostClientOptions;
  private readonly logger: ListenTogetherLogger;
  private readonly peers = new Map<string, VirtualPeerRecord>();
  private readonly peerHandlers = new Set<
    (conn: TransportConnection) => void
  >();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly closeHandlers = new Set<
    (code: number, reason: string) => void
  >();

  private ws: WebSocket | null = null;
  private stopHeartbeat: (() => void) | null = null;
  private pendingAuth: {
    mode: "create" | "resume";
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(options: RelayHostClientOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
  }

  public onPeerConnection(
    handler: (conn: TransportConnection) => void,
  ): () => void {
    this.peerHandlers.add(handler);
    return () => this.peerHandlers.delete(handler);
  }

  public onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  public onClose(handler: (code: number, reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  public async connect(
    mode: "create" | "resume" = "create",
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.ws) {
      throw new Error("RelayHostClient already connected");
    }
    if (signal?.aborted) {
      throw new Error("RelayHostClient connection aborted");
    }

    const target = await resolveAndValidateRelayUrl(
      this.options.signalingUrl,
      this.options.allowPrivateLiteral ?? false,
      this.options.lookupFn ?? defaultDnsLookup,
      this.logger,
    );

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    const heartbeatMs =
      this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

    let settled = false;
    let authTimer: NodeJS.Timeout | null = null;
    let resolveAuth!: () => void;
    let rejectAuth!: (err: Error) => void;
    const authPromise = new Promise<void>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });
    authPromise.catch(() => {});

    const cleanupAuthWait = () => {
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      signal?.removeEventListener("abort", onAuthAbort);
      this.pendingAuth = null;
    };

    const failAuth = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanupAuthWait();
      this.stopHeartbeat?.();
      this.stopHeartbeat = null;
      const ws = this.ws;
      this.ws = null;
      if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING)
      ) {
        ws.close(1008, "Host auth failed");
      }
      rejectAuth(err);
    };

    const onAuthAbort = () => {
      failAuth(new Error("RelayHostClient connection aborted"));
    };

    this.pendingAuth = {
      mode,
      resolve: () => {
        if (settled) return;
        settled = true;
        cleanupAuthWait();
        resolveAuth();
      },
      reject: failAuth,
    };

    try {
      await connectRelayWebSocket({
        target,
        signalingUrl: this.options.signalingUrl,
        timeoutMs,
        rejectUnauthorized: this.options.rejectUnauthorized,
        createWebSocket: this.options.createWebSocket,
        signal,
        logger: this.logger,
        role: "host",
        onOpenSocket: (openedWs) => {
          this.ws = openedWs;
          this.stopHeartbeat = startHeartbeat(
            openedWs,
            heartbeatMs,
            this.logger,
            "host",
          );

          signal?.addEventListener("abort", onAuthAbort, { once: true });
          if (timeoutMs > 0) {
            authTimer = setTimeout(() => {
              failAuth(
                new Error(
                  `RelayHostClient registration timed out after ${timeoutMs} ms`,
                ),
              );
            }, timeoutMs);
          }

          openedWs.on("message", (raw: RawData) =>
            this.handleRelayMessage(raw),
          );
          openedWs.on("error", (err: Error) => {
            this.logger.warn?.("RelayHostClient socket error", {
              lookupId: this.options.lookupId,
              error: err.message,
            });
            if (!settled) {
              failAuth(err);
              return;
            }
            for (const handler of this.errorHandlers) {
              handler(err);
            }
          });
          openedWs.on("close", (code: number, reason: Buffer) => {
            this.stopHeartbeat?.();
            this.stopHeartbeat = null;
            this.ws = null;
            const reasonStr = reason.toString("utf8");
            if (!settled) {
              failAuth(
                new Error(
                  `RelayHostClient closed before admission (${code}${reasonStr ? `: ${reasonStr}` : ""})`,
                ),
              );
              return;
            }
            this.logger.info?.("RelayHostClient disconnected", {
              lookupId: this.options.lookupId,
              code,
              reason: reasonStr,
            });
            for (const [peerId, record] of this.peers.entries()) {
              record.isOpen = false;
              record.emitClose(code, reasonStr);
              this.peers.delete(peerId);
            }
            for (const handler of this.closeHandlers) {
              handler(code, reasonStr);
            }
          });
        },
      });
    } catch (err) {
      cleanupAuthWait();
      throw err;
    }

    await authPromise;
    this.logger.info?.("RelayHostClient connected", {
      mode,
      lookupId: this.options.lookupId,
      url: redactLogUrl(this.options.signalingUrl),
    });
  }

  public admitPeer(relayPeerId: string): void {
    this.logger.info?.("RelayHostClient admitting peer", {
      lookupId: this.options.lookupId,
      relayPeerId,
    });
    this.sendControl({
      type: "RELAY_PEER_ADMITTED",
      relayPeerId,
    });
  }

  public dropPeer(relayPeerId: string, reason?: string): void {
    this.logger.info?.("RelayHostClient dropping peer", {
      lookupId: this.options.lookupId,
      relayPeerId,
      reason,
    });
    this.sendControl({
      type: "RELAY_DROP_PEER",
      relayPeerId,
      reason,
    });
    const record = this.peers.get(relayPeerId);
    if (record) {
      record.isOpen = false;
      this.peers.delete(relayPeerId);
      record.emitClose(1000, reason ?? "Dropped by host");
    }
  }

  public sendFrame(targetPeerId: string, data: Uint8Array | Buffer): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.sendControl({
      type: "RELAY_FRAME",
      targetPeerId,
      payloadB64: buf.toString("base64"),
    });
  }

  public close(): void {
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(1000, "Host closing");
      }
    }
    for (const [peerId, record] of this.peers.entries()) {
      record.isOpen = false;
      this.peers.delete(peerId);
      record.emitClose(1000, "Host closing");
    }
  }

  private sendControl(msg: RelayControlMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private getOrCreateVirtualPeer(relayPeerId: string): VirtualPeerRecord {
    const existing = this.peers.get(relayPeerId);
    if (existing) return existing;

    const messageHandlers = new Set<(data: Buffer) => void>();
    const closeHandlers = new Set<(code: number, reason: string) => void>();

    const record: VirtualPeerRecord = {
      isOpen: true,
      emitMessage(buf: Buffer) {
        for (const handler of messageHandlers) {
          handler(buf);
        }
      },
      emitClose(code: number, reason: string) {
        for (const handler of closeHandlers) {
          handler(code, reason);
        }
      },
      conn: {
        id: relayPeerId,
        mode: "relay",
        remoteLabel: `relay:${relayPeerId}`,
        get isOpen() {
          return record.isOpen;
        },
        send: (data: Uint8Array | Buffer) => {
          if (!record.isOpen) return;
          this.sendFrame(relayPeerId, data);
        },
        close: (_code?: number, reason?: string) => {
          if (!record.isOpen) return;
          this.dropPeer(relayPeerId, reason);
        },
        onMessage(handler) {
          messageHandlers.add(handler);
          return () => messageHandlers.delete(handler);
        },
        onClose(handler) {
          closeHandlers.add(handler);
          return () => closeHandlers.delete(handler);
        },
        onError() {
          return () => {};
        },
      },
    };

    this.peers.set(relayPeerId, record);
    for (const handler of this.peerHandlers) {
      handler(record.conn);
    }
    return record;
  }

  private handleRelayMessage(raw: RawData): void {
    const msg = parseRelayControlMessage(
      raw,
      this.logger,
      "RelayHostClient received invalid JSON frame",
    );
    if (!msg) return;

    if (msg.type === "HOST_CHALLENGE") {
      if (!this.pendingAuth) {
        return;
      }
      const sig = signEd25519(
        buildRelayChallengePayload(msg.challenge),
        this.options.hostPrivKey,
      ).toString("base64url");
      if (this.pendingAuth.mode === "create") {
        this.logger.debug?.(
          "RelayHostClient received HOST_CHALLENGE and sent signed HOST_CREATE",
          { lookupId: this.options.lookupId },
        );
        this.sendControl({
          type: "HOST_CREATE",
          lookupId: this.options.lookupId,
          hostPubKey: this.options.hostPubKeyB64,
          sig,
        });
      } else {
        this.logger.debug?.(
          "RelayHostClient received HOST_CHALLENGE and sent signed HOST_RESUME",
          { lookupId: this.options.lookupId },
        );
        this.sendControl({
          type: "HOST_RESUME",
          lookupId: this.options.lookupId,
          hostPubKey: this.options.hostPubKeyB64,
          challengeSig: sig,
        });
      }
    } else if (msg.type === "RELAY_PEER_ADMITTED") {
      if (msg.relayPeerId === "host") {
        this.pendingAuth?.resolve();
      }
    } else if (msg.type === "GUEST_JOIN") {
      if (msg.relayPeerId) {
        this.getOrCreateVirtualPeer(msg.relayPeerId);
      }
    } else if (msg.type === "RELAY_FRAME") {
      if (!msg.fromPeerId) {
        this.logger.warn?.("RelayHostClient received RELAY_FRAME without fromPeerId");
        return;
      }
      const payload = decodeStrictBase64(msg.payloadB64);
      if (!payload) {
        this.logger.warn?.("RelayHostClient received malformed base64 frame");
        return;
      }
      const peer = this.getOrCreateVirtualPeer(msg.fromPeerId);
      peer.emitMessage(payload);
    } else if (msg.type === "RELAY_DROP_PEER") {
      this.logger.info?.("RelayHostClient peer dropped by relay", {
        lookupId: this.options.lookupId,
        relayPeerId: msg.relayPeerId,
        reason: msg.reason,
      });
      const peer = this.peers.get(msg.relayPeerId);
      if (peer) {
        peer.isOpen = false;
        this.peers.delete(msg.relayPeerId);
        peer.emitClose(1000, msg.reason ?? "Peer disconnected");
      }
    } else if (msg.type === "RELAY_ERROR") {
      this.logger.warn?.("RelayHostClient received RELAY_ERROR", {
        lookupId: this.options.lookupId,
        code: msg.code,
        message: msg.message,
      });
      const err = new Error(`Relay error (${msg.code}): ${msg.message}`);
      if (this.pendingAuth) {
        this.pendingAuth.reject(err);
        return;
      }
      for (const handler of this.errorHandlers) {
        handler(err);
      }
    }
  }
}
