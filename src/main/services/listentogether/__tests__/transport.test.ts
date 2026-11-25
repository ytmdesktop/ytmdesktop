import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import type os from "node:os";
import type mDNS from "multicast-dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createRelayServer } from "../../../../../server/listen-relay/src/index";
import {
  createGuestHandshake,
  createHostHandshake,
  decryptFrame,
  encryptFrame,
  generateEd25519Keypair,
  type ClientAuth,
  type ClientHello,
  type HostHello,
  type LinkSession,
  type ServerAuth,
} from "../crypto";
import {
  collectDirectCandidateEndpoints,
  collectFilteredLocalIpv4s,
  connectDirectWs,
  DirectWsBrowser,
  DirectWsHost,
  DirectWsTransport,
  raceTransports,
  RelayHostClient,
  RelayWsTransport,
  resolveAndValidateRelayUrl,
  TransportManager,
  type ITransport,
  type TransportConnection,
} from "../transport";
import type { ListenTogetherLogger } from "~shared/listentogether/logger";

function createMdnsBus() {
  const peers = new Set<EventEmitter>();

  const makePeer = (): mDNS.MulticastDNS => {
    const ee = new EventEmitter() as EventEmitter & mDNS.MulticastDNS;
    peers.add(ee);
    ee.query = ((packet: mDNS.QueryPacket) => {
      queueMicrotask(() => {
        for (const peer of peers) {
          if (peer !== ee) {
            peer.emit("query", packet, { address: "192.168.1.50", port: 5353 });
          }
        }
      });
    }) as mDNS.MulticastDNS["query"];
    ee.respond = ((packet: mDNS.ResponsePacket) => {
      queueMicrotask(() => {
        for (const peer of peers) {
          if (peer !== ee) {
            peer.emit("response", packet, {
              address: "192.168.1.10",
              port: 5353,
            });
          }
        }
      });
    }) as mDNS.MulticastDNS["respond"];
    ee.destroy = ((cb?: () => void) => {
      peers.delete(ee);
      cb?.();
    }) as mDNS.MulticastDNS["destroy"];
    return ee;
  };

  return { makePeer };
}

function makeFakeIface(
  address: string,
  internal = false,
  family: "IPv4" | "IPv6" = "IPv4",
): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: family === "IPv4" ? "255.255.255.0" : "ffff::",
    family,
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  } as os.NetworkInterfaceInfo;
}

function createSpyLogger(): {
  logger: ListenTogetherLogger;
  dump(): string;
} {
  const entries: Array<{
    level: string;
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  const log =
    (level: string) => (message: string, context?: Record<string, unknown>) => {
      entries.push({ level, message, context });
    };
  return {
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    },
    dump: () => JSON.stringify(entries),
  };
}

function nextConnMessage(
  conn: TransportConnection,
  timeoutMs = 3000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      offMsg();
      offClose();
      reject(new Error(`Timed out waiting for connection message`));
    }, timeoutMs);
    const offMsg = conn.onMessage((buf) => {
      clearTimeout(timer);
      offMsg();
      offClose();
      resolve(buf);
    });
    const offClose = conn.onClose((code, reason) => {
      clearTimeout(timer);
      offMsg();
      offClose();
      reject(new Error(`Connection closed (${code}: ${reason})`));
    });
  });
}

function createConnMessageQueue(conn: TransportConnection): {
  next(timeoutMs?: number): Promise<Buffer>;
} {
  const queue: Buffer[] = [];
  const waiters: Array<(buf: Buffer) => void> = [];
  const errWaiters: Array<(err: Error) => void> = [];

  conn.onMessage((buf) => {
    const waiter = waiters.shift();
    if (waiter) {
      errWaiters.shift();
      waiter(buf);
    } else {
      queue.push(buf);
    }
  });
  conn.onClose((code, reason) => {
    const err = new Error(`Connection closed (${code}: ${reason})`);
    while (errWaiters.length > 0) {
      waiters.shift();
      errWaiters.shift()!(err);
    }
  });

  return {
    next(timeoutMs = 3000): Promise<Buffer> {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(onMsg);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            errWaiters.splice(idx, 1);
          }
          reject(new Error("Timed out waiting for queued message"));
        }, timeoutMs);
        const onMsg = (buf: Buffer) => {
          clearTimeout(timer);
          resolve(buf);
        };
        const onErr = (err: Error) => {
          clearTimeout(timer);
          reject(err);
        };
        waiters.push(onMsg);
        errWaiters.push(onErr);
      });
    },
  };
}

describe("transport", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      await fn?.();
    }
  });

  it("filters virtual/link-local adapters and keeps LAN + Tailscale endpoints (max 6)", () => {
    const fakeInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [makeFakeIface("127.0.0.1", true)],
      docker0: [makeFakeIface("172.17.0.1")],
      veth12ab: [makeFakeIface("172.18.0.1")],
      "br-987654": [makeFakeIface("172.19.0.1")],
      virbr0: [makeFakeIface("192.168.122.1")],
      vmnet1: [makeFakeIface("192.168.200.1")],
      "vEthernet (WSL)": [makeFakeIface("172.24.0.1")],
      eth0: [
        makeFakeIface("169.254.10.20"),
        makeFakeIface("0.0.0.0"),
        makeFakeIface("224.0.0.1"),
        makeFakeIface("192.168.1.42"),
        makeFakeIface("192.168.1.42"), // duplicate
        makeFakeIface("fe80::1", false, "IPv6"),
      ],
      tailscale0: [
        makeFakeIface("100.64.0.1"),
        makeFakeIface("100.127.255.254"),
      ],
      otherIf: [
        makeFakeIface("100.63.255.1"), // outside 100.64.0.0/10
        makeFakeIface("100.128.0.1"), // outside 100.64.0.0/10
      ],
      wlan0: [
        makeFakeIface("10.0.0.15"),
        makeFakeIface("10.0.0.16"),
        makeFakeIface("10.0.0.17"),
        makeFakeIface("10.0.0.18"),
        makeFakeIface("10.0.0.19"),
      ],
    };

    const ips = collectFilteredLocalIpv4s(() => fakeInterfaces);
    expect(ips).toContain("192.168.1.42");
    expect(ips).toContain("100.64.0.1");
    expect(ips).toContain("100.127.255.254");
    expect(ips).toContain("10.0.0.15");
    expect(ips).not.toContain("172.17.0.1");
    expect(ips).not.toContain("172.18.0.1");
    expect(ips).not.toContain("172.19.0.1");
    expect(ips).not.toContain("192.168.122.1");
    expect(ips).not.toContain("192.168.200.1");
    expect(ips).not.toContain("172.24.0.1");
    expect(ips).not.toContain("169.254.10.20");
    expect(ips).not.toContain("0.0.0.0");
    expect(ips).not.toContain("224.0.0.1");
    expect(ips).not.toContain("127.0.0.1");
    expect(ips.filter((ip) => ip === "192.168.1.42")).toHaveLength(1);

    // LAN (192.168.1.42, 10.0.0.15..19) then Tailscale (100.64/10), capped at 6
    const endpoints = collectDirectCandidateEndpoints(
      45000,
      () => fakeInterfaces,
    );
    expect(endpoints.length).toBe(6);
    expect(endpoints.every((ep) => ep.endsWith(":45000"))).toBe(true);
  });

  it("blocks SSRF, credentials, non-wss/https protocols, and DNS rebinding in resolveAndValidateRelayUrl", async () => {
    const spy = createSpyLogger();

    await expect(
      resolveAndValidateRelayUrl(
        "ws://relay.example.com/ws",
        false,
        undefined,
        spy.logger,
      ),
    ).rejects.toThrow(/Disallowed/i);

    await expect(
      resolveAndValidateRelayUrl(
        "http://relay.example.com",
        false,
        undefined,
        spy.logger,
      ),
    ).rejects.toThrow(/Disallowed/i);

    await expect(
      resolveAndValidateRelayUrl(
        "wss://secretuser:secretpass@relay.example.com",
        false,
        undefined,
        spy.logger,
      ),
    ).rejects.toThrow(/Disallowed/i);
    // Credentials must be redacted in logs and error
    expect(spy.dump()).not.toContain("secretuser");
    expect(spy.dump()).not.toContain("secretpass");

    for (const blockedUrl of [
      "wss://127.0.0.1:8443",
      "wss://169.254.169.254/latest/meta-data",
      "wss://0.0.0.0:8443",
      "wss://localhost:8443",
      "wss://foo.localhost:8443",
      "wss://metadata.google.internal",
      "wss://[::1]:8443",
    ]) {
      await expect(
        resolveAndValidateRelayUrl(blockedUrl, true),
      ).rejects.toThrow(/Disallowed/i);
    }

    await expect(
      resolveAndValidateRelayUrl("wss://100.64.5.1:8443", false),
    ).rejects.toThrow(/Disallowed/i);
    await expect(
      resolveAndValidateRelayUrl("wss://192.168.1.1:8443", false),
    ).rejects.toThrow(/Disallowed/i);

    // Private literal allowed only when explicitly confirmed
    const allowedPrivate = await resolveAndValidateRelayUrl(
      "wss://100.64.5.1:8443",
      true,
    );
    expect(allowedPrivate.addresses[0].address).toBe("100.64.5.1");

    // DNS rebinding checks block private, loopback, metadata, NAT64, 6to4, ULA, and IPv4-mapped IPv6
    for (const badIp of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.1",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.10",
      "64:ff9b::127.0.0.1",
      "2002:7f00:0001::1",
    ]) {
      await expect(
        resolveAndValidateRelayUrl(
          "https://rebind.example.com",
          false,
          async () => [{ address: badIp, family: badIp.includes(":") ? 6 : 4 }],
        ),
      ).rejects.toThrow(/disallowed IP/i);
    }

    // Multi-record DNS response where second record rebinds to metadata IP is still rejected
    await expect(
      resolveAndValidateRelayUrl(
        "https://rebind.example.com",
        false,
        async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ],
      ),
    ).rejects.toThrow(/disallowed IP/i);

    // Empty DNS result and lookup errors are rejected
    await expect(
      resolveAndValidateRelayUrl(
        "https://empty.example.com",
        false,
        async () => [],
      ),
    ).rejects.toThrow(/no addresses/i);
    await expect(
      resolveAndValidateRelayUrl("https://err.example.com", false, async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow("ENOTFOUND");

    const publicTarget = await resolveAndValidateRelayUrl(
      "https://relay.example.com/listen",
      false,
      async () => [{ address: "93.184.216.34", family: 4 }],
    );
    expect(publicTarget.url.protocol).toBe("wss:");
    expect(publicTarget.addresses[0].address).toBe("93.184.216.34");
  });

  it("hosts DirectWsHost, advertises/browses/prunes via mDNS, and validates DirectWsTransport", async () => {
    const bus = createMdnsBus();
    let now = 10_000;
    const fakeInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [makeFakeIface("192.168.1.55")],
      tailscale0: [makeFakeIface("100.64.2.10")],
    };

    const host = new DirectWsHost({
      mdnsFactory: bus.makePeer,
      networkInterfacesFn: () => fakeInterfaces,
      hostnameFn: () => "studio-pc.local",
    });
    cleanups.push(() => host.stop());

    const browserPeer = bus.makePeer();
    const browser = new DirectWsBrowser({
      mdnsFactory: () => browserPeer,
      queryIntervalMs: 0,
      staleAfterMs: 1000,
      nowMs: () => now,
    });
    cleanups.push(() => browser.stop());

    const incomingConns: TransportConnection[] = [];
    host.onConnection((conn) => incomingConns.push(conn));

    const started = await host.start({
      lookupId: "lookup-lan-1",
      label: "Alice's Room",
      host: "127.0.0.1",
      port: 0,
    });
    expect(started.port).toBeGreaterThanOrEqual(1024);
    expect(started.endpoints).toEqual([
      `192.168.1.55:${started.port}`,
      `100.64.2.10:${started.port}`,
    ]);

    const discoveredPromise = new Promise<void>((resolve) => {
      browser.onRoomsChanged((rooms) => {
        if (rooms.some((r) => r.lookupId === "lookup-lan-1")) {
          resolve();
        }
      });
    });

    browser.start();
    await discoveredPromise;
    expect(browser.getRooms().length).toBeGreaterThanOrEqual(1);
    expect(browser.getRooms()[0].label).toBe("Alice's Room");

    // Verify updateAnnouncement propagates updated room metadata
    const updatedPromise = new Promise<void>((resolve) => {
      browser.onRoomsChanged((rooms) => {
        if (rooms.some((r) => r.label === "Renamed Room")) {
          resolve();
        }
      });
    });
    host.updateAnnouncement({
      lookupId: "lookup-lan-1",
      label: "Renamed Room",
    });
    await updatedPromise;

    // Browser ignores mDNS responses carrying blocked local IPs or privileged ports
    browserPeer.emit("response", {
      answers: [
        {
          name: "_ytmd-listen._tcp.local",
          type: "PTR",
          data: "evil._ytmd-listen._tcp.local",
        },
      ],
      additionals: [
        {
          name: "evil._ytmd-listen._tcp.local",
          type: "SRV",
          data: {
            port: started.port,
            weight: 0,
            priority: 0,
            target: "evil.local",
          },
        },
        {
          name: "evil._ytmd-listen._tcp.local",
          type: "TXT",
          data: [Buffer.from("lookupId=evil-room")],
        },
        { name: "evil.local", type: "A", data: "127.0.0.1" },
        { name: "evil.local", type: "A", data: "169.254.169.254" },
      ],
    } as unknown as mDNS.ResponsePacket);
    expect(browser.getRooms().some((r) => r.lookupId === "evil-room")).toBe(
      false,
    );

    // Deterministic stale room pruning
    now += 1001;
    expect(browser.getRooms()).toEqual([]);

    // SSRF endpoints rejected by connectDirectWs
    await expect(connectDirectWs(`127.0.0.1:${started.port}`)).rejects.toThrow(
      /Invalid direct endpoint/i,
    );
    await expect(connectDirectWs("169.254.169.254:8080")).rejects.toThrow(
      /Invalid direct endpoint/i,
    );
    await expect(connectDirectWs("192.168.1.55:80")).rejects.toThrow(
      /Invalid direct endpoint/i,
    );

    // Pre-aborted signal rejects immediately
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      connectDirectWs(
        `192.168.1.55:${started.port}`,
        3000,
        undefined,
        aborted.signal,
      ),
    ).rejects.toThrow(/aborted/i);

    // DirectWsTransport connects with followRedirects=false and roundtrips binary frames
    let observedFollowRedirects: boolean | undefined;
    let observedSkipUtf8: boolean | undefined;
    const directTransport = new DirectWsTransport(
      `192.168.1.55:${started.port}`,
      {
        createWebSocket: (_url, opts) => {
          observedFollowRedirects = opts.followRedirects;
          observedSkipUtf8 = opts.skipUTF8Validation;
          return new WebSocket(`ws://127.0.0.1:${started.port}`, opts);
        },
      },
    );
    cleanups.push(() => directTransport.close());

    const guestConn = await directTransport.connect();
    expect(observedFollowRedirects).toBe(false);
    expect(observedSkipUtf8).toBe(true);

    // Wait for host side connection
    await vi.waitFor(() => {
      expect(incomingConns.length).toBe(1);
    });
    const hostConn = incomingConns[0]!;

    const hostReceived = nextConnMessage(hostConn);
    guestConn.send(Buffer.from("hello-host", "utf8"));
    expect((await hostReceived).toString("utf8")).toBe("hello-host");

    const guestReceived = nextConnMessage(guestConn);
    hostConn.send(Buffer.from("hello-guest", "utf8"));
    expect((await guestReceived).toString("utf8")).toBe("hello-guest");

    // stop() closes active connections cleanly
    const guestClosed = new Promise<number>((resolve) => {
      guestConn.onClose((code) => resolve(code));
    });
    await host.stop();
    expect(await guestClosed).toBe(1001);
  });

  it("catches DirectWsHost bind errors cleanly without throwing unhandled events", async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, "127.0.0.1", resolve),
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          blocker.close(() => resolve());
        }),
    );
    const addr = blocker.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Expected numeric port");
    }

    const host = new DirectWsHost({
      networkInterfacesFn: () => ({}),
    });
    await expect(
      host.start({
        lookupId: "conflict",
        label: "Conflict",
        host: "127.0.0.1",
        port: addr.port,
        announceMdns: false,
      }),
    ).rejects.toThrow();
  });

  describe("TransportManager and raceTransports (deterministic fake timers)", () => {
    const makeMockConn = (id: string, mode: "direct" | "relay") => {
      let closed = false;
      const conn: TransportConnection = {
        id,
        mode,
        remoteLabel: id,
        get isOpen() {
          return !closed;
        },
        send: () => {},
        close: () => {
          closed = true;
        },
        onMessage: () => () => {},
        onClose: () => () => {},
        onError: () => () => {},
      };
      return { conn, isClosed: () => closed };
    };

    it("enforces exact 250ms DirectWs head-start before launching RelayWs", async () => {
      vi.useFakeTimers();

      let relayStarted = false;
      let directAborted = false;
      const losingDirect = makeMockConn("d-slow", "direct");
      const winningRelay = makeMockConn("r-fast", "relay");

      const delayedDirect: ITransport = {
        mode: "direct",
        connect: (signal) =>
          new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve(losingDirect.conn), 1000);
            signal?.addEventListener(
              "abort",
              () => {
                directAborted = true;
                clearTimeout(t);
                reject(new Error("aborted"));
              },
              { once: true },
            );
          }),
        close: () => {},
      };

      const fastRelay: ITransport = {
        mode: "relay",
        connect: async () => {
          relayStarted = true;
          return winningRelay.conn;
        },
        close: () => {},
      };

      const racePromise = raceTransports({
        directTransports: [delayedDirect],
        relayTransport: fastRelay,
        directHeadStartMs: 250,
        authenticate: async (conn) => conn.id,
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(relayStarted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(relayStarted).toBe(true);

      const result = await racePromise;
      expect(result.mode).toBe("relay");
      expect(result.auth).toBe("r-fast");
      expect(winningRelay.isClosed()).toBe(false);
      expect(directAborted).toBe(true);
    });

    it("cancels RelayWs when DirectWs wins both before and after 250ms head-start", async () => {
      vi.useFakeTimers();
      const manager = new TransportManager({ directHeadStartMs: 250 });

      // Win before 250ms: relay never starts
      let relayCalled = false;
      const d1 = makeMockConn("d1", "direct");
      const res1 = await manager.race({
        directTransports: [
          {
            mode: "direct",
            connect: async () => d1.conn,
            close: () => {},
          },
        ],
        relayTransport: {
          mode: "relay",
          connect: async () => {
            relayCalled = true;
            return makeMockConn("r1", "relay").conn;
          },
          close: () => {},
        },
        authenticate: async (conn) => conn.id,
      });
      expect(res1.mode).toBe("direct");
      expect(relayCalled).toBe(false);

      // Win at 270ms (after relay started at 250ms): relay aborted & closed, late relay conn closed
      let relayAborted = false;
      let relayCloseCalled = false;
      const lateRelay = makeMockConn("r-late", "relay");
      const d2 = makeMockConn("d2", "direct");

      const directWinsLate: ITransport = {
        mode: "direct",
        connect: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(d2.conn), 270);
          }),
        close: () => {},
      };
      const slowRelay: ITransport = {
        mode: "relay",
        connect: (signal) =>
          new Promise((resolve) => {
            signal?.addEventListener("abort", () => {
              relayAborted = true;
            });
            setTimeout(() => resolve(lateRelay.conn), 350);
          }),
        close: () => {
          relayCloseCalled = true;
        },
      };

      const race2 = manager.race({
        directTransports: [directWinsLate],
        relayTransport: slowRelay,
        authenticate: async (conn) => conn.id,
      });

      await vi.advanceTimersByTimeAsync(270);
      const res2 = await race2;
      expect(res2.mode).toBe("direct");
      expect(relayAborted).toBe(true);
      expect(relayCloseCalled).toBe(true);

      // Advance past t=250ms + 350ms so lateRelay resolves and verify it gets closed immediately
      await vi.advanceTimersByTimeAsync(350);
      expect(lateRelay.isClosed()).toBe(true);
    });

    it("launches RelayWs immediately when all DirectWs fail early, handles auth failures, and enforces totalTimeoutMs", async () => {
      vi.useFakeTimers();
      const manager = new TransportManager({
        directHeadStartMs: 250,
        totalTimeoutMs: 500,
      });

      let relayStarted = false;
      const rFallback = makeMockConn("r-fallback", "relay");
      const earlyFailDirect: ITransport = {
        mode: "direct",
        connect: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("ECONNREFUSED")), 10);
          }),
        close: () => {},
      };
      const fallbackRelay: ITransport = {
        mode: "relay",
        connect: async () => {
          relayStarted = true;
          return rFallback.conn;
        },
        close: () => {},
      };

      const racePromise = manager.race({
        directTransports: [earlyFailDirect],
        relayTransport: fallbackRelay,
        authenticate: async (conn) => conn.id,
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(relayStarted).toBe(true);
      const res = await racePromise;
      expect(res.mode).toBe("relay");

      // Direct auth failure closes direct conn and falls back to relay
      const badAuthDirect = makeMockConn("d-bad-auth", "direct");
      const goodRelay = makeMockConn("r-good", "relay");
      const resAuth = await manager.race({
        directTransports: [
          {
            mode: "direct",
            connect: async () => badAuthDirect.conn,
            close: () => {},
          },
        ],
        relayTransport: {
          mode: "relay",
          connect: async () => goodRelay.conn,
          close: () => {},
        },
        directHeadStartMs: 0,
        authenticate: async (conn) => {
          if (conn.mode === "direct") {
            throw new Error("AUTH_FAILED");
          }
          return conn.id;
        },
      });
      expect(resAuth.mode).toBe("relay");
      expect(badAuthDirect.isClosed()).toBe(true);

      // Total timeout rejects stalled transports
      const stalledDirect: ITransport = {
        mode: "direct",
        connect: () => new Promise(() => {}),
        close: () => {},
      };
      const stalledRace = manager.race({
        directTransports: [stalledDirect],
        relayTransport: null,
        authenticate: async (conn) => conn.id,
      });
      const assertion = expect(stalledRace).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;

      // Both fail -> AggregateError
      await expect(
        manager.race({
          directTransports: [
            {
              mode: "direct",
              connect: async () => {
                throw new Error("Direct down");
              },
              close: () => {},
            },
          ],
          relayTransport: {
            mode: "relay",
            connect: async () => {
              throw new Error("Relay down");
            },
            close: () => {},
          },
          authenticate: async (conn) => conn.id,
        }),
      ).rejects.toThrow(/All transports failed/i);
    });
  });

  it("integrates real createRelayServer + RelayHostClient + RelayWsTransport + DirectWs + crypto.ts end-to-end", async () => {
    const relayServer = await createRelayServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      rateLimitMax: 50,
    });
    cleanups.push(() => relayServer.close());
    const relayUrl = await relayServer.start();

    const directHost = new DirectWsHost({
      networkInterfacesFn: () => ({
        eth0: [makeFakeIface("192.168.1.55")],
      }),
    });
    cleanups.push(() => directHost.stop());
    const directStarted = await directHost.start({
      lookupId: "e2e-lookup-1",
      label: "E2E Room",
      host: "127.0.0.1",
      port: 0,
      announceMdns: false,
    });

    const hostKeys = generateEd25519Keypair();
    const guest1Keys = generateEd25519Keypair();
    const guest2Keys = generateEd25519Keypair();
    const wrongHostKeys = generateEd25519Keypair();
    const roomSalt = crypto.randomBytes(16);
    const inviteToken = crypto.randomBytes(16);
    const lookupId = "e2e-lookup-1";
    const roomId = "room-e2e-1";

    const relayHost = new RelayHostClient({
      signalingUrl: "wss://relay.example.com/ws",
      lookupId,
      hostPubKeyB64: hostKeys.publicKeyB64,
      hostPrivKey: hostKeys.privateKey,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      createWebSocket: (_url, opts) => new WebSocket(relayUrl, opts),
      heartbeatIntervalMs: 0,
    });
    cleanups.push(() => relayHost.close());
    await relayHost.connect("create");

    expect(relayServer.relay.getRoomStats(lookupId)).toEqual({
      admittedCount: 0,
      pendingCount: 0,
      hostConnected: true,
    });

    // Helper: host-side E2EE handshake handler for any incoming TransportConnection
    const hostSessions = new Map<string, LinkSession>();
    const hostConns = new Map<string, TransportConnection>();
    const hostQueues = new Map<
      string,
      ReturnType<typeof createConnMessageQueue>
    >();
    const attachHostConnection = (
      conn: TransportConnection,
      admitOnRelay: boolean,
    ) => {
      const q = createConnMessageQueue(conn);
      hostConns.set(conn.id, conn);
      hostQueues.set(conn.id, q);
      void (async () => {
        const hs = createHostHandshake({
          roomId,
          lookupId,
          epoch: 1,
          roomSalt,
          hostKeypair: hostKeys,
          roomInviteToken: inviteToken,
          roomTokenEpoch: 1,
        });
        const clientHello = JSON.parse(
          (await q.next()).toString("utf8"),
        ) as ClientHello;
        const hostHello = hs.receiveClientHello(clientHello);
        conn.send(Buffer.from(JSON.stringify(hostHello), "utf8"));

        const clientAuth = JSON.parse(
          (await q.next()).toString("utf8"),
        ) as ClientAuth;
        const { serverAuth, session } = hs.verifyClientAuth(clientAuth);
        if (admitOnRelay) {
          relayHost.admitPeer(conn.id);
        }
        hostSessions.set(conn.id, session);
        conn.send(Buffer.from(JSON.stringify(serverAuth), "utf8"));
      })();
    };

    directHost.onConnection((conn) => attachHostConnection(conn, false));
    relayHost.onPeerConnection((conn) => attachHostConnection(conn, true));

    const guestAuthenticate = async (conn: TransportConnection) => {
      const q = createConnMessageQueue(conn);
      const guestHs = createGuestHandshake({
        guestKeypair: conn.mode === "direct" ? guest1Keys : guest2Keys,
        expectedRoomId: roomId,
        expectedLookupId: lookupId,
        expectedHostPubKeyB64: hostKeys.publicKeyB64,
        authMode: "token",
        authSecret: inviteToken,
        tokenEpoch: 1,
      });
      conn.send(
        Buffer.from(JSON.stringify(guestHs.createClientHello()), "utf8"),
      );
      const hostHello = JSON.parse(
        (await q.next()).toString("utf8"),
      ) as HostHello;
      const clientAuth = guestHs.receiveHostHello(hostHello);
      conn.send(Buffer.from(JSON.stringify(clientAuth), "utf8"));
      const serverAuth = JSON.parse(
        (await q.next()).toString("utf8"),
      ) as ServerAuth;
      const session = guestHs.verifyServerAuth(serverAuth);
      return { session, queue: q };
    };

    const manager = new TransportManager({ directHeadStartMs: 250 });

    // Guest 1: DirectWs wins the race over RelayWs and exchanges E2EE frames
    const directWinner = await manager.race({
      directTransports: [
        new DirectWsTransport(`192.168.1.55:${directStarted.port}`, {
          createWebSocket: (_url, opts) =>
            new WebSocket(`ws://127.0.0.1:${directStarted.port}`, opts),
        }),
      ],
      relayTransport: new RelayWsTransport({
        signalingUrl: "wss://relay.example.com/ws",
        lookupId,
        lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        createWebSocket: (_url, opts) => new WebSocket(relayUrl, opts),
        heartbeatIntervalMs: 0,
      }),
      authenticate: guestAuthenticate,
    });
    cleanups.push(() => directWinner.connection.close());

    expect(directWinner.mode).toBe("direct");
    const directHostEntry = Array.from(hostSessions.entries()).find(([id]) =>
      id.startsWith("direct-"),
    );
    expect(directHostEntry).toBeDefined();
    const [directHostConnId, directHostSession] = directHostEntry!;
    const directHostQueue = hostQueues.get(directHostConnId)!;

    // Guest 1 -> Host and Host -> Guest 1 E2EE frames over DirectWs
    const directPlain = JSON.stringify({ type: "SYNC_ANCHOR", seq: 1 });
    directWinner.connection.send(
      encryptFrame(directWinner.auth.session, directPlain),
    );
    const directEncryptedOnHost = await directHostQueue.next();
    expect(
      decryptFrame(directHostSession, directEncryptedOnHost).toString("utf8"),
    ).toBe(directPlain);

    const directHostReply = JSON.stringify({ type: "PONG", seq: 2 });
    hostConns
      .get(directHostConnId)!
      .send(encryptFrame(directHostSession, directHostReply));
    const directEncryptedOnGuest = await directWinner.auth.queue.next();
    expect(
      decryptFrame(directWinner.auth.session, directEncryptedOnGuest).toString(
        "utf8",
      ),
    ).toBe(directHostReply);

    // Guest 2: DirectWs fails -> RelayWs wins against real createRelayServer and exchanges E2EE frames
    const relayWinner = await manager.race({
      directTransports: [
        {
          mode: "direct",
          connect: async () => {
            throw new Error("Direct unreachable");
          },
          close: () => {},
        },
      ],
      relayTransport: new RelayWsTransport({
        signalingUrl: "wss://relay.example.com/ws",
        lookupId,
        lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        createWebSocket: (_url, opts) => new WebSocket(relayUrl, opts),
        heartbeatIntervalMs: 0,
      }),
      authenticate: guestAuthenticate,
    });
    cleanups.push(() => relayWinner.connection.close());

    expect(relayWinner.mode).toBe("relay");
    expect(relayServer.relay.getRoomStats(lookupId)).toEqual({
      admittedCount: 1,
      pendingCount: 0,
      hostConnected: true,
    });

    const relayHostEntry = Array.from(hostSessions.entries()).find(([id]) =>
      id.startsWith("peer-"),
    );
    expect(relayHostEntry).toBeDefined();
    const [relayPeerId, relayHostSession] = relayHostEntry!;
    const relayHostQueue = hostQueues.get(relayPeerId)!;

    // Guest 2 -> Host E2EE frame through real RelayServer
    const g2ToHostPlain = JSON.stringify({ type: "TRACK_READY", seq: 7 });
    relayWinner.connection.send(
      encryptFrame(relayWinner.auth.session, g2ToHostPlain),
    );
    const encFromGuest2 = await relayHostQueue.next();
    expect(decryptFrame(relayHostSession, encFromGuest2).toString("utf8")).toBe(
      g2ToHostPlain,
    );

    // Host -> Guest 2 E2EE frame through real RelayServer
    const hostToG2Plain = JSON.stringify({ type: "PLAY", seq: 8 });
    relayHost.sendFrame(
      relayPeerId,
      encryptFrame(relayHostSession, hostToG2Plain),
    );
    const encOnGuest2 = await relayWinner.auth.queue.next();
    expect(
      decryptFrame(relayWinner.auth.session, encOnGuest2).toString("utf8"),
    ).toBe(hostToG2Plain);

    // Host disconnects and wrong key fails HOST_RESUME, then legitimate key resumes!
    const hostClosedPromise = new Promise<void>((resolve) => {
      relayHost.onClose(() => resolve());
    });
    relayHost.close();
    await hostClosedPromise;

    const evilResume = new RelayHostClient({
      signalingUrl: "wss://relay.example.com/ws",
      lookupId,
      hostPubKeyB64: wrongHostKeys.publicKeyB64,
      hostPrivKey: wrongHostKeys.privateKey,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      createWebSocket: (_url, opts) => new WebSocket(relayUrl, opts),
      heartbeatIntervalMs: 0,
    });
    cleanups.push(() => evilResume.close());
    await expect(evilResume.connect("resume")).rejects.toThrow(/FORBIDDEN/i);

    const resumedHost = new RelayHostClient({
      signalingUrl: "wss://relay.example.com/ws",
      lookupId,
      hostPubKeyB64: hostKeys.publicKeyB64,
      hostPrivKey: hostKeys.privateKey,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      createWebSocket: (_url, opts) => new WebSocket(relayUrl, opts),
      heartbeatIntervalMs: 0,
    });
    cleanups.push(() => resumedHost.close());
    await resumedHost.connect("resume");

    // E2EE frame still routes after HOST_RESUME
    const resumedFrameHostPromise = new Promise<Buffer>((resolve) => {
      resumedHost.onPeerConnection((conn) => {
        conn.onMessage((buf) => resolve(buf));
      });
    });
    const postResumeMsg = JSON.stringify({ type: "AFTER_RESUME", seq: 9 });
    relayWinner.connection.send(
      encryptFrame(relayWinner.auth.session, postResumeMsg),
    );
    expect(
      decryptFrame(relayHostSession, await resumedFrameHostPromise).toString(
        "utf8",
      ),
    ).toBe(postResumeMsg);

    // dropPeer cuts Guest 2 immediately
    const guest2Closed = new Promise<number>((resolve) => {
      relayWinner.connection.onClose((code) => resolve(code));
    });
    resumedHost.dropPeer(relayPeerId, "Kicked");
    expect(await guest2Closed).toBe(4005);
  });

  it("closes underlying WebSocket cleanly when RelayWsTransport is aborted while awaiting GUEST_JOIN", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          wss.close(() => resolve());
        }),
    );
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const addr = wss.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Expected numeric port");
    }

    let serverSocketClosed: Promise<void> | null = null;
    const guestJoinReceived = new Promise<void>((resolve) => {
      wss.on("connection", (ws) => {
        serverSocketClosed = new Promise<void>((resClose) => {
          ws.once("close", () => resClose());
        });
        ws.on("message", () => {
          resolve();
        });
      });
    });

    const controller = new AbortController();
    const transport = new RelayWsTransport({
      signalingUrl: "wss://relay.example.com/ws",
      lookupId: "abort-lookup",
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      createWebSocket: (_url, opts) =>
        new WebSocket(`ws://127.0.0.1:${addr.port}`, opts),
      heartbeatIntervalMs: 20_000,
      timeoutMs: 5000,
    });

    const connectPromise = transport.connect(controller.signal);
    await guestJoinReceived;
    controller.abort();

    await expect(connectPromise).rejects.toThrow(/aborted/i);
    await expect(serverSocketClosed!).resolves.toBeUndefined();
  });

  it("does not emit unhandled WebSocket error when DirectWsTransport is aborted before connection is established", async () => {
    // HTTP server that holds Upgrade requests open without sending 101,
    // keeping WebSocket in CONNECTING state so ws.terminate() emits the async error.
    const server = http.createServer();
    const heldSockets = new Set<import("node:stream").Duplex>();
    server.on("upgrade", (_req, socket) => {
      heldSockets.add(socket);
      socket.on("close", () => heldSockets.delete(socket));
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const s of heldSockets) s.destroy();
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Expected numeric port");
    }

    const controller = new AbortController();
    const connectPromise = connectDirectWs(
      `192.168.1.250:${addr.port}`,
      5000,
      undefined,
      controller.signal,
      {
        createWebSocket: (_url, opts) =>
          new WebSocket(`ws://127.0.0.1:${addr.port}`, opts),
      },
    );
    // Let the TCP handshake start, then abort while WebSocket is still CONNECTING
    await new Promise((resolve) => setTimeout(resolve, 15));
    controller.abort();
    await expect(connectPromise).rejects.toThrow(/aborted/i);
    // Allow microtasks/nextTick for ws.terminate() async 'error' event to fire
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});
