import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import {
  BlindRelayCore,
  IpRateLimiter,
  type BlindRelayOptions,
  type RelayLogger,
  type RelaySocket,
} from "./relay-core.js";

export interface RelayServerOptions extends BlindRelayOptions {
  port?: number;
  host?: string;
  trustProxy?: boolean;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  maxPayloadBytes?: number;
  logLevel?: string;
  logStream?: NodeJS.WritableStream;
  nowMs?: () => number;
}

export interface RelayServerInstance {
  fastify: FastifyInstance;
  relay: BlindRelayCore;
  start(): Promise<string>;
  close(): Promise<void>;
  getUrl(): string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_RATE_LIMIT_MAX = 5;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

export function parseTrustProxyEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const rawXff = req.headers["x-forwarded-for"];
    const xff = Array.isArray(rawXff) ? rawXff[0] : rawXff;
    if (typeof xff === "string" && xff.trim().length > 0) {
      const firstHop = xff.split(",")[0]?.trim();
      if (firstHop) {
        return firstHop;
      }
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function wrapWebSocket(ws: WebSocket): RelaySocket {
  return {
    get isOpen(): boolean {
      return ws.readyState === WebSocket.OPEN;
    },
    send(data: string): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    close(code?: number, reason?: string): void {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(code, reason);
      }
    },
    terminate(): void {
      ws.terminate();
    },
    ping(): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    },
  };
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  statusText: string,
  extraHeaders = "",
): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n${extraHeaders}\r\n`,
  );
  socket.destroy();
}

export async function createRelayServer(
  options: RelayServerOptions = {},
): Promise<RelayServerInstance> {
  const trustProxy =
    options.trustProxy ?? parseTrustProxyEnv(process.env.TRUST_PROXY);
  const port = options.port ?? parseEnvNumber(process.env.PORT, DEFAULT_PORT);
  const host = options.host ?? process.env.HOST ?? DEFAULT_HOST;
  const rateLimitMax =
    options.rateLimitMax ??
    parseEnvNumber(process.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const rateLimitWindowMs =
    options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxPayload = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;

  const fastify = Fastify({
    trustProxy,
    logController: new LogController({
      disableRequestLogging: true,
    }),
    logger: {
      level: options.logLevel ?? process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers", "req.remoteAddress", "req.remotePort", "req.ip"],
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  });

  const relayLogger: RelayLogger = options.logger ?? {
    debug: (meta, msg) => fastify.log.debug(meta, msg),
    info: (meta, msg) => fastify.log.info(meta, msg),
    warn: (meta, msg) => fastify.log.warn(meta, msg),
    error: (meta, msg) => fastify.log.error(meta, msg),
  };

  const relay = new BlindRelayCore({
    ...options,
    logger: relayLogger,
  });

  const upgradeRateLimiter = new IpRateLimiter(
    rateLimitMax,
    rateLimitWindowMs,
    options.nowMs,
  );

  await fastify.register(rateLimit, {
    global: true,
    max: rateLimitMax,
    timeWindow: rateLimitWindowMs,
    keyGenerator: (req) => req.ip,
  });

  fastify.get("/health", { config: { rateLimit: false } }, async () => {
    return {
      status: "ok",
      rooms: relay.getRoomCount(),
      uptimeSec: Math.floor(process.uptime()),
    };
  });

  fastify.post("/invites", async (req, reply) => {
    const body = (req.body ?? {}) as { inviteUrl?: unknown };
    const inviteUrl =
      typeof body.inviteUrl === "string" ? body.inviteUrl.trim() : "";
    if (
      !inviteUrl ||
      inviteUrl.length > 2048 ||
      !inviteUrl.startsWith("ytmd://listen/")
    ) {
      return reply.code(400).send({ error: "Invalid inviteUrl" });
    }
    const { code, expiresAtMs } = relay.createShortInvite(inviteUrl);
    return {
      code,
      shortUrl: `ytmd://join/${code}`,
      expiresAtMs,
    };
  });

  fastify.get("/invites/:code", async (req, reply) => {
    const params = req.params as { code?: string };
    const inviteUrl = relay.resolveShortInvite(params.code ?? "");
    if (!inviteUrl) {
      return reply.code(404).send({ error: "Invite code not found or expired" });
    }
    return { inviteUrl };
  });

  fastify.get("/", async (_req, reply) => {
    return reply.code(426).send({ error: "Upgrade Required" });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload,
  });

  wss.on("connection", (ws) => {
    const relaySocket = wrapWebSocket(ws);
    relay.handleConnection(relaySocket);

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        relayLogger.warn(
          { event: "binary_frame_rejected" },
          "Rejected binary WebSocket frame",
        );
        relaySocket.send(
          JSON.stringify({
            type: "RELAY_ERROR",
            code: "BINARY_UNSUPPORTED",
            message: "Expected UTF-8 JSON text frame",
          }),
        );
        return;
      }
      const raw =
        typeof data === "string"
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data as ArrayBuffer).toString("utf8");
      relay.handleMessage(relaySocket, raw);
    });

    ws.on("pong", () => {
      relay.handlePong(relaySocket);
    });

    ws.on("close", () => {
      relay.handleClose(relaySocket);
    });

    ws.on("error", (err) => {
      relayLogger.warn(
        { event: "ws_socket_error", error: err.message },
        "WebSocket client socket error",
      );
      relay.handleClose(relaySocket);
    });
  });

  fastify.server.on("upgrade", (req, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      relayLogger.warn(
        { event: "upgrade_rejected", statusCode: 400 },
        "Rejected WebSocket upgrade with malformed URL",
      );
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (pathname !== "/" && pathname !== "/ws") {
      relayLogger.warn(
        { event: "upgrade_rejected", statusCode: 404, pathname },
        "Rejected WebSocket upgrade for unknown path",
      );
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const clientIp = extractClientIp(req, trustProxy);
    if (!upgradeRateLimiter.consume(clientIp)) {
      relayLogger.warn(
        {
          event: "rate_limited",
          rateLimitMax,
          rateLimitWindowMs,
        },
        "Upgrade rate limit reached",
      );
      rejectUpgrade(socket, 429, "Too Many Requests", "Retry-After: 60\r\n");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  fastify.addHook("onClose", async () => {
    relay.dispose();
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  });

  const getUrl = (): string => {
    const addr = fastify.server.address();
    if (!addr || typeof addr === "string") {
      return `ws://${host}:${port}`;
    }
    const boundHost = addr.address === "::" ? "127.0.0.1" : addr.address;
    return `ws://${boundHost}:${addr.port}`;
  };

  return {
    fastify,
    relay,
    async start(): Promise<string> {
      await fastify.listen({ port, host });
      return getUrl();
    },
    async close(): Promise<void> {
      await fastify.close();
    },
    getUrl,
  };
}

async function main(): Promise<void> {
  const server = await createRelayServer();
  const address = await server.start();
  server.fastify.log.info(
    { event: "relay_started", address },
    "Listen Together blind relay listening",
  );

  const shutdown = async (): Promise<void> => {
    server.fastify.log.info(
      { event: "relay_stopping" },
      "Shutting down blind relay",
    );
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error("Failed to start listen relay", err);
    process.exit(1);
  });
}
