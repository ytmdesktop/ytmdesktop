import "./ws-env";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import mDNS from "multicast-dns";
import WebSocket, { WebSocketServer } from "ws";
import {
  noopLogger,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import { isValidDirectEndpoint } from "~shared/listentogether/protocol";
import {
  createTransportConnection,
  parseIpv4Octets,
  type DiscoveredLanRoom,
  type ITransport,
  type TransportConnection,
} from "./types";

const SERVICE_TYPE = "_ytmd-listen._tcp.local";
const DNS_SD_ENUM = "_services._dns-sd._udp.local";
const MAX_DIRECT_ENDPOINTS = 6;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const EXCLUDED_IFACE_RE = /^(docker|veth|br-|virbr|vmnet|vEthernet)/i;

export type MdnsFactory = () => mDNS.MulticastDNS;
export type NetworkInterfacesFn = () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
export type DirectWebSocketFactory = (
  url: string,
  options: WebSocket.ClientOptions,
) => WebSocket;

function isBlockedLocalIpv4([o0, o1]: [
  number,
  number,
  number,
  number,
]): boolean {
  if (o0 === 0 || o0 === 127) return true;
  if (o0 === 169 && o1 === 254) return true;
  if (o0 >= 224) return true;
  return false;
}

function isTailscaleIpv4([o0, o1]: [number, number, number, number]): boolean {
  return o0 === 100 && o1 >= 64 && o1 <= 127;
}

function isLanPrivateIpv4([o0, o1]: [number, number, number, number]): boolean {
  if (o0 === 10) return true;
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
  if (o0 === 192 && o1 === 168) return true;
  return false;
}

/**
 * Collects filtered local IPv4 addresses (LAN + Tailscale `100.64.0.0/10`),
 * excluding virtual/bridge/link-local adapters.
 */
export function collectFilteredLocalIpv4s(
  networkInterfacesFn: NetworkInterfacesFn = os.networkInterfaces,
  _logger: ListenTogetherLogger = noopLogger,
): string[] {
  const interfaces = networkInterfacesFn();
  const lan: string[] = [];
  const tailscale: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();

  for (const [deviceName, addrs] of Object.entries(interfaces)) {
    if (!addrs) {
      continue;
    }
    if (EXCLUDED_IFACE_RE.test(deviceName)) {
      continue;
    }
    for (const alias of addrs) {
      if (alias.internal || alias.family !== "IPv4") {
        continue;
      }
      const octets = parseIpv4Octets(alias.address);
      if (!octets || isBlockedLocalIpv4(octets)) {
        continue;
      }
      if (seen.has(alias.address)) {
        continue;
      }
      seen.add(alias.address);
      if (isTailscaleIpv4(octets)) {
        tailscale.push(alias.address);
      } else if (isLanPrivateIpv4(octets)) {
        lan.push(alias.address);
      } else {
        other.push(alias.address);
      }
    }
  }

  return [...lan, ...tailscale, ...other];
}

/**
 * Builds up to 6 validated `IPv4:port` candidate endpoints from local network interfaces.
 */
export function collectDirectCandidateEndpoints(
  port: number,
  networkInterfacesFn: NetworkInterfacesFn = os.networkInterfaces,
  logger: ListenTogetherLogger = noopLogger,
): string[] {
  const ips = collectFilteredLocalIpv4s(networkInterfacesFn, logger);
  const endpoints: string[] = [];
  for (const ip of ips) {
    const ep = `${ip}:${port}`;
    if (isValidDirectEndpoint(ep, logger)) {
      endpoints.push(ep);
      if (endpoints.length >= MAX_DIRECT_ENDPOINTS) {
        if (ips.length > MAX_DIRECT_ENDPOINTS) {
          logger.debug?.("Truncated direct candidate endpoints at limit", {
            maxEndpoints: MAX_DIRECT_ENDPOINTS,
            totalIps: ips.length,
          });
        }
        break;
      }
    }
  }
  return endpoints;
}

function wrapDirectWebSocket(
  ws: WebSocket,
  id: string,
  remoteLabel: string,
): TransportConnection {
  return createTransportConnection(ws, { id, mode: "direct", remoteLabel }).conn;
}

/**
 * Connects to a validated `IPv4:port` or `[IPv6]:port` direct WebSocket endpoint.
 */
export function connectDirectWs(
  endpoint: string,
  timeoutMs = 3000,
  logger: ListenTogetherLogger = noopLogger,
  signal?: AbortSignal,
  options: { createWebSocket?: DirectWebSocketFactory } = {},
): Promise<TransportConnection> {
  if (!isValidDirectEndpoint(endpoint, logger)) {
    return Promise.reject(new Error(`Invalid direct endpoint: ${endpoint}`));
  }
  if (signal?.aborted) {
    logger.debug?.("Direct WebSocket connection aborted before start", {
      endpoint,
    });
    return Promise.reject(new Error("Direct WebSocket connection aborted"));
  }

  return new Promise<TransportConnection>((resolve, reject) => {
    let settled = false;
    const makeWs =
      options.createWebSocket ?? ((url, opts) => new WebSocket(url, opts));
    const ws = makeWs(`ws://${endpoint}`, {
      handshakeTimeout: timeoutMs,
      followRedirects: false,
      maxRedirects: 0,
      skipUTF8Validation: true,
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
      ws.removeListener("close", onClose);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Keep a no-op listener because terminating a CONNECTING socket emits an async error.
      ws.on("error", () => {});
      try {
        ws.terminate();
      } catch {
        // ignore termination error
      }
      reject(err);
    };

    const onAbort = () => {
      logger.debug?.("Direct WebSocket connection aborted", { endpoint });
      fail(new Error("Direct WebSocket connection aborted"));
    };

    const timer = setTimeout(() => {
      logger.warn?.("Direct WebSocket connection timed out", {
        endpoint,
        timeoutMs,
      });
      fail(new Error(`Direct WebSocket timeout connecting to ${endpoint}`));
    }, timeoutMs);

    const onOpen = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // Keep a baseline error listener so post-open socket errors don't throw unhandled
      ws.on("error", () => {});
      const id = `direct-${crypto.randomUUID()}`;
      logger.debug?.("Direct WebSocket connected", { endpoint, id });
      resolve(wrapDirectWebSocket(ws, id, endpoint));
    };

    const onError = (err: Error) => {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (/Unexpected server response: 30\d/.test(err.message)) {
        logger.warn?.(
          "Blocked HTTP redirect during Direct WebSocket handshake",
          {
            endpoint,
            error: err.message,
          },
        );
      } else {
        logger.warn?.("Direct WebSocket connection failed", {
          endpoint,
          code: errCode,
          error: err.message,
        });
      }
      fail(err);
    };

    const onClose = (code: number) => {
      logger.warn?.("Direct WebSocket closed before open", { endpoint, code });
      fail(new Error(`Direct WebSocket closed before open (${code})`));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

export class DirectWsTransport implements ITransport {
  public readonly mode = "direct" as const;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly logger: ListenTogetherLogger;
  private readonly createWebSocket?: DirectWebSocketFactory;
  private activeController: AbortController | null = null;
  private activeConn: TransportConnection | null = null;

  constructor(
    endpoint: string,
    options: {
      timeoutMs?: number;
      logger?: ListenTogetherLogger;
      createWebSocket?: DirectWebSocketFactory;
    } = {},
  ) {
    this.endpoint = endpoint;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.logger = options.logger ?? noopLogger;
    this.createWebSocket = options.createWebSocket;
  }

  public async connect(signal?: AbortSignal): Promise<TransportConnection> {
    const controller = new AbortController();
    this.activeController = controller;
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    try {
      const conn = await connectDirectWs(
        this.endpoint,
        this.timeoutMs,
        this.logger,
        controller.signal,
        { createWebSocket: this.createWebSocket },
      );
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

export type DirectWsHostOptions = {
  mdnsFactory?: MdnsFactory;
  networkInterfacesFn?: NetworkInterfacesFn;
  hostnameFn?: () => string;
  logger?: ListenTogetherLogger;
  maxPayloadBytes?: number;
};

export type DirectWsHostStartParams = {
  lookupId: string;
  label: string;
  host?: string;
  port?: number;
  announceMdns?: boolean;
};

function sanitizeMdnsLabel(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  return cleaned || "ytmd-host";
}

function buildTxtEntries(
  lookupId: string,
  port: number,
  label: string,
): Buffer[] {
  return [
    Buffer.from(`lookupId=${lookupId}`, "utf8"),
    Buffer.from(`port=${port}`, "utf8"),
    Buffer.from(`label=${label.slice(0, 64)}`, "utf8"),
  ];
}

/**
 * Hosts a direct WebSocket server on an ephemeral port and advertises `_ytmd-listen._tcp.local` via mDNS.
 */
export class DirectWsHost {
  private readonly mdnsFactory: MdnsFactory;
  private readonly networkInterfacesFn: NetworkInterfacesFn;
  private readonly hostnameFn: () => string;
  private readonly logger: ListenTogetherLogger;
  private readonly maxPayloadBytes: number;
  private readonly connectionHandlers = new Set<
    (conn: TransportConnection) => void
  >();
  private readonly activeConnections = new Set<TransportConnection>();

  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private mdns: mDNS.MulticastDNS | null = null;
  private boundPort = 0;
  private currentLookupId = "";
  private currentLabel = "";
  private statusMeta: { roomName: string; memberCount: number } = {
    roomName: "",
    memberCount: 0,
  };
  private mdnsMetadataCache: {
    meta: {
      domainedHostname: string;
      instanceName: string;
      aRecords: mDNS.ResponsePacket["answers"];
      txtData: Buffer[];
    };
    builtAtMs: number;
  } | null = null;

  constructor(options: DirectWsHostOptions = {}) {
    this.mdnsFactory = options.mdnsFactory ?? (() => mDNS());
    this.networkInterfacesFn =
      options.networkInterfacesFn ?? os.networkInterfaces;
    this.hostnameFn = options.hostnameFn ?? os.hostname;
    this.logger = options.logger ?? noopLogger;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  }

  public setStatusMeta(meta: { roomName?: string; memberCount?: number }): void {
    if (typeof meta.roomName === "string") {
      this.statusMeta.roomName = meta.roomName.slice(0, 64);
    }
    if (typeof meta.memberCount === "number" && Number.isFinite(meta.memberCount)) {
      this.statusMeta.memberCount = Math.max(0, Math.floor(meta.memberCount));
    }
  }

  public onConnection(
    handler: (conn: TransportConnection) => void,
  ): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  public async start(
    params: DirectWsHostStartParams,
  ): Promise<{ port: number; endpoints: string[] }> {
    if (this.httpServer) {
      throw new Error("DirectWsHost already started");
    }

    this.currentLookupId = params.lookupId;
    this.currentLabel = params.label;

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/lt-status") {
        const body = JSON.stringify({
          ok: true,
          roomName: this.statusMeta.roomName,
          memberCount: this.statusMeta.memberCount,
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(body);
        return;
      }
      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade Required");
    });
    const wss = new WebSocketServer({
      server,
      maxPayload: this.maxPayloadBytes,
      skipUTF8Validation: true,
    });

    this.httpServer = server;
    this.wss = wss;

    wss.on("connection", (ws, req) => {
      const remoteAddr = req.socket.remoteAddress ?? "unknown";
      const remotePort = req.socket.remotePort ?? 0;
      const id = `direct-${crypto.randomUUID()}`;
      const conn = wrapDirectWebSocket(ws, id, `${remoteAddr}:${remotePort}`);
      this.logger.debug?.("DirectWsHost accepted incoming connection", {
        id,
        remoteAddr,
        remotePort,
      });
      ws.on("error", (err) => {
        this.logger.debug?.("DirectWsHost client socket error", {
          id,
          error: err.message,
        });
      });
      this.activeConnections.add(conn);

      let isAlive = true;
      const onPong = () => {
        isAlive = true;
      };
      ws.on("pong", onPong);
      const heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!isAlive) {
          this.logger.warn?.("DirectWsHost peer missed heartbeat pong; closing", {
            id,
            remoteAddr,
            remotePort,
          });
          ws.terminate();
          return;
        }
        isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }, 10_000);
      heartbeatTimer.unref?.();

      conn.onClose((code) => {
        clearInterval(heartbeatTimer);
        ws.off("pong", onPong);
        this.activeConnections.delete(conn);
        this.logger.debug?.("DirectWsHost client disconnected", { id, code });
      });
      for (const handler of this.connectionHandlers) {
        handler(conn);
      }
    });

    wss.on("error", (err) => {
      this.logger.warn?.("DirectWsHost WebSocketServer error", {
        error: err.message,
      });
    });

    const listenHost = params.host ?? "0.0.0.0";
    const requestedPort = params.port ?? 0;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.logger.warn?.("DirectWsHost bind/listen error", {
          host: listenHost,
          port: requestedPort,
          code: (err as NodeJS.ErrnoException).code,
          error: err.message,
        });
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        server.on("error", (err) => {
          this.logger.warn?.("DirectWsHost runtime server error", {
            code: (err as NodeJS.ErrnoException).code,
            error: err.message,
          });
        });
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(requestedPort, listenHost);
    }).catch(async (err) => {
      await this.stop();
      throw err;
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Failed to determine DirectWsHost bound port");
    }

    this.boundPort = address.port;
    const endpoints = collectDirectCandidateEndpoints(
      this.boundPort,
      this.networkInterfacesFn,
      this.logger,
    );

    if (endpoints.length === 0) {
      this.logger.warn?.(
        "DirectWsHost found no non-virtual LAN or Tailscale candidate endpoints",
        { port: this.boundPort },
      );
    }

    this.logger.info?.("DirectWsHost listening", {
      port: this.boundPort,
      endpointCount: endpoints.length,
    });

    if (params.announceMdns !== false) {
      this.startMdns();
    }

    return { port: this.boundPort, endpoints };
  }

  public updateAnnouncement(params: { lookupId: string; label: string }): void {
    this.currentLookupId = params.lookupId;
    this.currentLabel = params.label;
    this.mdnsMetadataCache = null;
    this.announceNow();
  }

  private buildMdnsMetadata() {
    const now = Date.now();
    if (
      this.mdnsMetadataCache &&
      now - this.mdnsMetadataCache.builtAtMs < 1_000
    ) {
      return this.mdnsMetadataCache.meta;
    }

    const rawHost = this.hostnameFn().split(".")[0] || "ytmd-host";
    const safeHost = sanitizeMdnsLabel(rawHost);
    const domainedHostname = `${safeHost}.local`;
    const shortId = sanitizeMdnsLabel(this.currentLookupId.slice(0, 12));
    const instanceName = `${shortId}-${safeHost}.${SERVICE_TYPE}`;

    const ips = collectFilteredLocalIpv4s(
      this.networkInterfacesFn,
      this.logger,
    );
    const aRecords: mDNS.ResponsePacket["answers"] = ips.map((ip) => ({
      name: domainedHostname,
      type: "A",
      ttl: 60,
      data: ip,
    }));

    const meta = {
      domainedHostname,
      instanceName,
      aRecords,
      txtData: buildTxtEntries(
        this.currentLookupId,
        this.boundPort,
        this.currentLabel,
      ),
    };
    this.mdnsMetadataCache = { meta, builtAtMs: now };
    return meta;
  }

  private buildServiceAnnouncementPacket(
    meta: ReturnType<DirectWsHost["buildMdnsMetadata"]>,
  ): mDNS.ResponseOutgoingPacket {
    return {
      answers: [
        {
          name: SERVICE_TYPE,
          type: "PTR",
          ttl: 60,
          data: meta.instanceName,
        },
      ],
      additionals: [
        {
          name: meta.instanceName,
          type: "SRV",
          ttl: 60,
          data: {
            port: this.boundPort,
            weight: 0,
            priority: 0,
            target: meta.domainedHostname,
          },
        },
        {
          name: meta.instanceName,
          type: "TXT",
          ttl: 60,
          data: meta.txtData,
        },
        ...meta.aRecords,
      ],
    };
  }

  private startMdns(): void {
    let instance: mDNS.MulticastDNS;
    try {
      instance = this.mdnsFactory();
    } catch (err) {
      this.logger.warn?.("Failed to start mDNS advertiser", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    this.mdns = instance;
    instance.on("error", (err) => {
      this.logger.warn?.("DirectWsHost mDNS error", { error: err.message });
    });

    instance.on("query", (query) => {
      const meta = this.buildMdnsMetadata();
      for (const question of query.questions) {
        const name = question.name.toLowerCase();
        const type: string = question.type;

        if (name === DNS_SD_ENUM) {
          instance.respond({
            answers: [
              {
                name: DNS_SD_ENUM,
                type: "PTR",
                ttl: 120,
                data: SERVICE_TYPE,
              },
            ],
          });
          continue;
        }

        if (name === SERVICE_TYPE && (type === "PTR" || type === "ANY")) {
          instance.respond(this.buildServiceAnnouncementPacket(meta));
          continue;
        }

        if (name === meta.instanceName.toLowerCase()) {
          const answers: mDNS.ResponsePacket["answers"] = [];
          if (type === "SRV" || type === "ANY") {
            answers.push({
              name: meta.instanceName,
              type: "SRV",
              ttl: 60,
              data: {
                port: this.boundPort,
                weight: 0,
                priority: 0,
                target: meta.domainedHostname,
              },
            });
          }
          if (type === "TXT" || type === "ANY") {
            answers.push({
              name: meta.instanceName,
              type: "TXT",
              ttl: 60,
              data: meta.txtData,
            });
          }
          if (answers.length > 0) {
            instance.respond({ answers, additionals: meta.aRecords });
          }
          continue;
        }

        if (
          name === meta.domainedHostname.toLowerCase() &&
          (type === "A" || type === "ANY") &&
          meta.aRecords.length > 0
        ) {
          instance.respond({ answers: meta.aRecords });
        }
      }
    });

    this.announceNow();
  }

  private announceNow(): void {
    if (!this.mdns || this.boundPort <= 0) return;
    const meta = this.buildMdnsMetadata();
    if (meta.aRecords.length === 0) {
      this.logger.debug?.("Skipped mDNS announce: no eligible IPv4 addresses", {
        lookupId: this.currentLookupId,
      });
      return;
    }

    this.logger.debug?.("Announced room via mDNS", {
      lookupId: this.currentLookupId,
      port: this.boundPort,
      instanceName: meta.instanceName,
      addressCount: meta.aRecords.length,
    });

    this.mdns.respond(this.buildServiceAnnouncementPacket(meta));
  }

  public async stop(): Promise<void> {
    this.mdnsMetadataCache = null;
    const previousPort = this.boundPort;
    if (this.mdns) {
      const m = this.mdns;
      this.mdns = null;
      await new Promise<void>((resolve) => {
        try {
          m.destroy(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    for (const conn of this.activeConnections) {
      conn.close(1001, "Host closing");
    }
    this.activeConnections.clear();

    if (this.wss) {
      const wss = this.wss;
      this.wss = null;
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    }

    if (this.httpServer) {
      const server = this.httpServer;
      this.httpServer = null;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    this.boundPort = 0;
    if (previousPort > 0) {
      this.logger.info?.("DirectWsHost stopped", { previousPort });
    }
  }
}

export type DirectWsBrowserOptions = {
  mdnsFactory?: MdnsFactory;
  logger?: ListenTogetherLogger;
  nowMs?: () => number;
  staleAfterMs?: number;
  queryIntervalMs?: number;
};

function parseTxtRecords(data: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = Array.isArray(data) ? data : [data];
  for (const item of entries) {
    let text = "";
    if (Buffer.isBuffer(item)) {
      text = item.toString("utf8");
    } else if (typeof item === "string") {
      text = item;
    } else {
      continue;
    }
    const eqIdx = text.indexOf("=");
    if (eqIdx > 0) {
      result[text.slice(0, eqIdx)] = text.slice(eqIdx + 1);
    }
  }
  return result;
}

/**
 * Browses `_ytmd-listen._tcp.local` via mDNS to discover nearby LAN Listen Together rooms.
 */
export class DirectWsBrowser {
  private readonly mdnsFactory: MdnsFactory;
  private readonly logger: ListenTogetherLogger;
  private readonly nowMs: () => number;
  private readonly staleAfterMs: number;
  private readonly queryIntervalMs: number;
  private readonly rooms = new Map<string, DiscoveredLanRoom>();
  private readonly listeners = new Set<(rooms: DiscoveredLanRoom[]) => void>();

  private mdns: mDNS.MulticastDNS | null = null;
  private queryTimer: NodeJS.Timeout | null = null;

  constructor(options: DirectWsBrowserOptions = {}) {
    this.mdnsFactory = options.mdnsFactory ?? (() => mDNS());
    this.logger = options.logger ?? noopLogger;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.staleAfterMs = options.staleAfterMs ?? 15_000;
    this.queryIntervalMs = options.queryIntervalMs ?? 5_000;
  }

  public onRoomsChanged(
    handler: (rooms: DiscoveredLanRoom[]) => void,
  ): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  public getRooms(): DiscoveredLanRoom[] {
    this.pruneStale();
    return Array.from(this.rooms.values());
  }

  public start(): void {
    if (this.mdns) return;
    let instance: mDNS.MulticastDNS;
    try {
      instance = this.mdnsFactory();
    } catch (err) {
      this.logger.warn?.("Failed to start mDNS browser", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    this.mdns = instance;
    instance.on("error", (err) => {
      this.logger.warn?.("DirectWsBrowser mDNS error", { error: err.message });
    });

    instance.on("response", (packet) => {
      this.handleResponsePacket(packet);
    });

    this.logger.info?.("Started mDNS browser", {
      queryIntervalMs: this.queryIntervalMs,
      staleAfterMs: this.staleAfterMs,
    });

    this.refresh();
    if (this.queryIntervalMs > 0) {
      this.queryTimer = setInterval(() => {
        this.pruneStale();
        this.refresh();
      }, this.queryIntervalMs);
    }
  }

  public refresh(): void {
    this.mdns?.query({
      questions: [{ name: SERVICE_TYPE, type: "PTR" }],
    });
  }

  public async stop(): Promise<void> {
    if (this.queryTimer) {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
    }
    const hadMdns = this.mdns !== null;
    if (this.mdns) {
      const m = this.mdns;
      this.mdns = null;
      await new Promise<void>((resolve) => {
        try {
          m.destroy(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    this.rooms.clear();
    if (hadMdns) {
      this.logger.info?.("Stopped mDNS browser");
    }
  }

  private pruneStale(): boolean {
    const cutoff = this.nowMs() - this.staleAfterMs;
    let changed = false;
    for (const [key, room] of this.rooms.entries()) {
      if (room.lastSeenMs < cutoff) {
        this.rooms.delete(key);
        this.logger.debug?.("Pruned stale mDNS room", {
          lookupId: room.lookupId,
          endpoint: room.endpoint,
        });
        changed = true;
      }
    }
    if (changed) {
      this.emitRooms();
    }
    return changed;
  }

  private emitRooms(): void {
    const snapshot = Array.from(this.rooms.values());
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private handleResponsePacket(packet: mDNS.ResponsePacket): void {
    const allRecords = [
      ...(packet.answers ?? []),
      ...(packet.additionals ?? []),
    ];

    const ptrInstances = new Set<string>();
    const srvByInstance = new Map<string, { port: number; target: string }>();
    const txtByInstance = new Map<string, Record<string, string>>();
    const aByHost = new Map<string, string[]>();

    for (const rec of allRecords) {
      const nameLower = rec.name.toLowerCase();
      if (rec.type === "PTR" && nameLower === SERVICE_TYPE) {
        if (typeof rec.data === "string") {
          ptrInstances.add(rec.data.toLowerCase());
        }
      } else if (rec.type === "SRV" && nameLower.endsWith(`.${SERVICE_TYPE}`)) {
        if (
          rec.data &&
          typeof rec.data === "object" &&
          "port" in rec.data &&
          "target" in rec.data
        ) {
          srvByInstance.set(nameLower, {
            port: Number(rec.data.port),
            target: String(rec.data.target).toLowerCase(),
          });
          ptrInstances.add(nameLower);
        }
      } else if (rec.type === "TXT" && nameLower.endsWith(`.${SERVICE_TYPE}`)) {
        txtByInstance.set(nameLower, parseTxtRecords(rec.data));
      } else if (rec.type === "A" && typeof rec.data === "string") {
        const list = aByHost.get(nameLower) ?? [];
        list.push(rec.data);
        aByHost.set(nameLower, list);
      }
    }

    let updated = false;
    const now = this.nowMs();

    for (const instName of ptrInstances) {
      const srv = srvByInstance.get(instName);
      const txt = txtByInstance.get(instName);
      if (!srv || !txt || !txt.lookupId) {
        continue;
      }

      const ips = aByHost.get(srv.target) ?? [];
      for (const ip of ips) {
        const octets = parseIpv4Octets(ip);
        if (!octets || isBlockedLocalIpv4(octets)) {
          this.logger.debug?.("Ignored mDNS candidate with blocked IPv4", {
            lookupId: txt.lookupId,
            ip,
          });
          continue;
        }
        const port = srv.port;
        const endpoint = `${ip}:${port}`;
        if (!isValidDirectEndpoint(endpoint, this.logger)) {
          continue;
        }
        const key = `${txt.lookupId}|${endpoint}`;
        const isNew = !this.rooms.has(key);
        this.rooms.set(key, {
          lookupId: txt.lookupId,
          host: ip,
          port,
          label: txt.label || "Listen Together Room",
          endpoint,
          lastSeenMs: now,
        });
        if (isNew) {
          this.logger.info?.("Discovered LAN room via mDNS", {
            lookupId: txt.lookupId,
            endpoint,
          });
        } else {
          this.logger.debug?.("Refreshed LAN room via mDNS", {
            lookupId: txt.lookupId,
            endpoint,
          });
        }
        updated = true;
      }
    }

    if (updated) {
      this.emitRooms();
    }
  }
}
