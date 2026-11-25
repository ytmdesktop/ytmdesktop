import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  redactInviteUrl,
  redactLogUrl,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import {
  encodeInviteUrl,
  parseInviteUrl,
  type InviteEnvelope,
} from "~shared/listentogether/protocol";
import {
  generateEd25519Keypair,
  signInviteEnvelope,
  verifyInviteEnvelope,
} from "../crypto";
import {
  raceTransports,
  resolveTailcatBinary,
  TailcatHostSidecar,
  TailcatWsTransport,
  TransportManager,
  type ITransport,
  type TailcatChildProcess,
  type TailcatSpawnFn,
  type TransportConnection,
} from "../transport";

function createFakeChild(): TailcatChildProcess &
  EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    killSignals: Array<NodeJS.Signals | number | undefined>;
    autoExitOnSignals: Set<string>;
  } {
  const ee = new EventEmitter() as TailcatChildProcess &
    EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      killSignals: Array<NodeJS.Signals | number | undefined>;
      autoExitOnSignals: Set<string>;
    };
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.exitCode = null;
  ee.signalCode = null;
  ee.killSignals = [];
  ee.autoExitOnSignals = new Set(["SIGTERM", "SIGKILL"]);
  ee.kill = ((sig?: NodeJS.Signals | number) => {
    ee.killSignals.push(sig);
    const sigName = typeof sig === "string" ? sig : "SIGTERM";
    if (
      ee.autoExitOnSignals.has(sigName) &&
      ee.exitCode === null &&
      ee.signalCode === null
    ) {
      ee.signalCode = sigName as NodeJS.Signals;
      queueMicrotask(() => {
        ee.emit("exit", null, sigName);
        ee.emit("close", null, sigName);
      });
    }
    return true;
  }) as TailcatChildProcess["kill"];
  return ee;
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

describe("tailcat transport & sidecar", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.YTMD_TAILCAT_BIN;
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      await fn?.();
    }
  });

  describe("resolveTailcatBinary", () => {
    it("follows priority order: envBin > resourcesPath > appPath/resources/bin > PATH and returns null when missing", () => {
      const resourcesBin = path.join("/opt/ytmd/resources", "tailcat");
      const appBin = path.join(
        "/workspace/ytmd",
        "resources",
        "bin",
        "tailcat",
      );
      const pathBin = "/usr/local/bin/tailcat";
      const envBin = "/custom/bin/tailcat";

      const existing = new Set([envBin, resourcesBin, appBin, pathBin]);
      const existsSync = (p: string) => existing.has(p);

      // 1. envBin wins over everything
      expect(
        resolveTailcatBinary({
          envBin,
          resourcesPath: "/opt/ytmd/resources",
          appPath: "/workspace/ytmd",
          platform: "linux",
          existsSync,
          whichSync: () => pathBin,
        }),
      ).toBe(envBin);

      // Process env YTMD_TAILCAT_BIN also works when envBin omitted
      process.env.YTMD_TAILCAT_BIN = envBin;
      expect(
        resolveTailcatBinary({
          resourcesPath: "/opt/ytmd/resources",
          appPath: "/workspace/ytmd",
          platform: "linux",
          existsSync,
          whichSync: () => pathBin,
        }),
      ).toBe(envBin);
      delete process.env.YTMD_TAILCAT_BIN;

      // 2. resourcesPath/tailcat wins when envBin missing
      expect(
        resolveTailcatBinary({
          envBin: "/does/not/exist",
          resourcesPath: "/opt/ytmd/resources",
          appPath: "/workspace/ytmd",
          platform: "linux",
          existsSync,
          whichSync: () => pathBin,
        }),
      ).toBe(resourcesBin);

      // 3. appPath/resources/bin/tailcat wins when resourcesPath missing
      expect(
        resolveTailcatBinary({
          resourcesPath: "/missing/resources",
          appPath: "/workspace/ytmd",
          platform: "linux",
          existsSync,
          whichSync: () => pathBin,
        }),
      ).toBe(appBin);

      // 4. system PATH wins when earlier candidates don't exist
      expect(
        resolveTailcatBinary({
          resourcesPath: "/missing/resources",
          appPath: "/missing/app",
          platform: "linux",
          existsSync,
          whichSync: () => pathBin,
        }),
      ).toBe(pathBin);

      // 5. returns null when missing everywhere
      expect(
        resolveTailcatBinary({
          envBin: "/missing/env",
          resourcesPath: "/missing/resources",
          appPath: "/missing/app",
          platform: "linux",
          existsSync: () => false,
          whichSync: () => null,
        }),
      ).toBeNull();

      // 6. uses .exe on win32
      const winAppBin = path.join("C:\\app", "resources", "bin", "tailcat.exe");
      expect(
        resolveTailcatBinary({
          resourcesPath: undefined,
          appPath: "C:\\app",
          platform: "win32",
          existsSync: (p) => p === winAppBin,
          whichSync: () => null,
        }),
      ).toBe(winAppBin);
    });
  });

  describe("TailcatHostSidecar", () => {
    it("parses tc... capability address from stderr, passes TAILCAT_DERPMAP_URL, and cleans up on stop()", async () => {
      const fakeChild = createFakeChild();
      const spy = createSpyLogger();
      const spawnCalls: Array<{
        cmd: string;
        args: string[];
        derp?: string;
      }> = [];

      const spawnFn: TailcatSpawnFn = (cmd, args, opts) => {
        spawnCalls.push({
          cmd,
          args,
          derp: opts.env?.TAILCAT_DERPMAP_URL,
        });
        queueMicrotask(() => {
          fakeChild.stderr.write("tailcat bootstrapping...\nListening on ");
          fakeChild.stderr.write("tcAbCdEfGhIjKlMnOpQrStUvWxYz0123\n");
        });
        return fakeChild;
      };

      const sidecar = new TailcatHostSidecar({
        binaryPath: "/mock/tailcat",
        spawnFn,
        logger: spy.logger,
      });
      cleanups.push(() => sidecar.stop());

      const started = await sidecar.start({
        localPort: 45123,
        derpMapUrl: "https://derp.example.com/map.json",
        timeoutMs: 2000,
      });

      expect(started).toEqual({
        tcAddress: "tcAbCdEfGhIjKlMnOpQrStUvWxYz0123",
        remotePort: 47820,
      });
      expect(spawnCalls).toEqual([
        {
          cmd: "/mock/tailcat",
          args: ["serve", "--key=new", "--log", "47820:45123"],
          derp: "https://derp.example.com/map.json",
        },
      ]);
      expect(spy.dump()).not.toContain("tcAbCdEfGhIjKlMnOpQrStUvWxYz0123");

      await sidecar.stop();
      expect(fakeChild.killSignals).toContain("SIGTERM");
    });

    it("kills child process on startup timeout and falls back to SIGKILL after 2s in stop()", async () => {
      vi.useFakeTimers();

      // Timeout teardown test
      const stalledChild = createFakeChild();
      const sidecar1 = new TailcatHostSidecar({
        binaryPath: "/mock/tailcat",
        spawnFn: () => stalledChild,
      });

      const startPromise = sidecar1.start({
        localPort: 45124,
        timeoutMs: 500,
      });
      const assertion = expect(startPromise).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      expect(stalledChild.killSignals).toContain("SIGTERM");

      // stop() SIGTERM -> 2s SIGKILL fallback test
      const stubbornChild = createFakeChild();
      stubbornChild.autoExitOnSignals.delete("SIGTERM");

      const sidecar2 = new TailcatHostSidecar({
        binaryPath: "/mock/tailcat",
        spawnFn: () => {
          queueMicrotask(() => {
            stubbornChild.stderr.write("tcStubborn1234567890abcdef\n");
          });
          return stubbornChild;
        },
      });
      await sidecar2.start({ localPort: 45125, timeoutMs: 1000 });

      const stopPromise = sidecar2.stop();
      expect(stubbornChild.killSignals).toEqual(["SIGTERM"]);

      await vi.advanceTimersByTimeAsync(1999);
      expect(stubbornChild.killSignals).toEqual(["SIGTERM"]);

      await vi.advanceTimersByTimeAsync(1);
      await stopPromise;
      expect(stubbornChild.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    });
  });

  describe("TailcatWsTransport", () => {
    it("connects through a mock forwarder to a real local WebSocketServer, exchanges frames, and terminates child on close() and AbortSignal", async () => {
      // Real local WebSocketServer representing the remote host
      const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      await new Promise<void>((resolve) => wss.once("listening", resolve));
      cleanups.push(
        () =>
          new Promise<void>((resolve) => {
            wss.close(() => resolve());
          }),
      );
      const wssAddr = wss.address();
      if (!wssAddr || typeof wssAddr === "string") {
        throw new Error("Expected numeric port");
      }
      const remotePort = wssAddr.port;

      const serverMessages: Buffer[] = [];
      wss.on("connection", (ws) => {
        ws.on("message", (data) => {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
          serverMessages.push(buf);
          ws.send(Buffer.from(`echo:${buf.toString("utf8")}`, "utf8"));
        });
      });

      const forwarderChildren: Array<{
        child: ReturnType<typeof createFakeChild>;
        proxyServer: net.Server;
        args: string[];
        derp?: string;
      }> = [];

      // Mock tailcat forward --key=new <tcAddress> <localPort>:<remotePort> that opens a delayed TCP proxy on 127.0.0.1:<localPort>
      const spawnFn: TailcatSpawnFn = (_cmd, args, opts) => {
        const child = createFakeChild();
        const portMap = args[args.length - 1];
        const [localPortStr, targetPortStr] = portMap.split(":");
        const localPort = Number(localPortStr);
        const targetPort = Number(targetPortStr);

        const proxyServer = net.createServer((clientSock) => {
          const upstreamSock = net.createConnection({
            host: "127.0.0.1",
            port: targetPort,
          });
          clientSock.pipe(upstreamSock);
          upstreamSock.pipe(clientSock);
          clientSock.on("error", () => upstreamSock.destroy());
          upstreamSock.on("error", () => clientSock.destroy());
        });

        // Slight delay to exercise connect retry loop
        setTimeout(() => {
          if (!child.signalCode && child.exitCode === null) {
            proxyServer.listen(localPort, "127.0.0.1");
          }
        }, 40);

        child.once("exit", () => {
          proxyServer.close();
        });

        forwarderChildren.push({
          child,
          proxyServer,
          args,
          derp: opts.env?.TAILCAT_DERPMAP_URL,
        });
        return child;
      };

      const tcAddress = "tcValidCapabilityAddress12345";
      const spy = createSpyLogger();
      const transport = new TailcatWsTransport({
        tcAddress,
        remotePort,
        derpMapUrl: "https://derp.example.com/custom",
        binaryPath: "/mock/tailcat",
        spawnFn,
        timeoutMs: 3000,
        logger: spy.logger,
      });

      const conn = await transport.connect();
      expect(conn.mode).toBe("tailcat");
      expect(conn.remoteLabel).toBe("tailcat:redacted");
      expect(conn.id.startsWith("tailcat-")).toBe(true);
      expect(conn.isOpen).toBe(true);

      expect(forwarderChildren).toHaveLength(1);
      expect(forwarderChildren[0].args[0]).toBe("forward");
      expect(forwarderChildren[0].args[1]).toBe("--key=new");
      expect(forwarderChildren[0].args[2]).toBe(tcAddress);
      expect(forwarderChildren[0].args[3]).toMatch(
        new RegExp(`^\\d+:${remotePort}$`),
      );
      expect(forwarderChildren[0].derp).toBe("https://derp.example.com/custom");

      const received = new Promise<Buffer>((resolve) => {
        conn.onMessage((buf) => resolve(buf));
      });
      conn.send(Buffer.from("ping-tailcat", "utf8"));
      expect((await received).toString("utf8")).toBe("echo:ping-tailcat");
      expect(serverMessages.map((b) => b.toString("utf8"))).toEqual([
        "ping-tailcat",
      ]);

      // Closing connection terminates tailcat forward child process
      conn.close(1000, "done");
      await vi.waitFor(() => {
        expect(forwarderChildren[0].child.killSignals).toContain("SIGTERM");
      });
      expect(spy.dump()).not.toContain(tcAddress);

      // Aborting via AbortSignal terminates forwarder immediately
      const abortController = new AbortController();
      const stalledSpawn: TailcatSpawnFn = () => {
        const child = createFakeChild();
        forwarderChildren.push({
          child,
          proxyServer: net.createServer(),
          args: [],
        });
        return child;
      };
      const abortTransport = new TailcatWsTransport({
        tcAddress,
        remotePort,
        binaryPath: "/mock/tailcat",
        spawnFn: stalledSpawn,
        timeoutMs: 5000,
      });

      const connectPromise = abortTransport.connect(abortController.signal);
      await vi.waitFor(() => {
        expect(forwarderChildren.length).toBe(2);
      });
      abortController.abort();
      await expect(connectPromise).rejects.toThrow(/aborted/i);
      expect(forwarderChildren[1].child.killSignals).toContain("SIGTERM");
    });
  });

  describe("TransportManager racing Direct vs Tailcat vs Relay", () => {
    const makeMockConn = (id: string, mode: "direct" | "tailcat" | "relay") => {
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

    it("closes Tailcat when Direct wins on LAN, and launches Tailcat + Relay when Direct fails so Tailcat wins and closes Relay", async () => {
      vi.useFakeTimers();
      const manager = new TransportManager({
        directHeadStartMs: 250,
        totalTimeoutMs: 5000,
      });

      // 1. Direct wins on LAN -> Tailcat never started & closed
      let tailcatStarted = false;
      let tailcatClosed = false;
      let relayClosed = false;
      const d1 = makeMockConn("d-lan", "direct");

      const lanResult = await manager.race({
        directTransports: [
          {
            mode: "direct",
            connect: async () => d1.conn,
            close: () => {},
          },
        ],
        tailcatTransport: {
          mode: "tailcat",
          connect: async () => {
            tailcatStarted = true;
            return makeMockConn("tc-1", "tailcat").conn;
          },
          close: () => {
            tailcatClosed = true;
          },
        },
        relayTransport: {
          mode: "relay",
          connect: async () => makeMockConn("r-1", "relay").conn,
          close: () => {
            relayClosed = true;
          },
        },
        authenticate: async (conn) => conn.id,
      });

      expect(lanResult.mode).toBe("direct");
      expect(tailcatStarted).toBe(false);
      expect(tailcatClosed).toBe(true);
      expect(relayClosed).toBe(true);

      // 2. Direct fails -> Tailcat + Relay launch immediately -> Tailcat wins -> Relay aborted & closed
      let tcLaunched = false;
      let rLaunched = false;
      let rAborted = false;
      let rCloseCalled = false;
      const tcWin = makeMockConn("tc-win", "tailcat");
      const rLate = makeMockConn("r-late", "relay");

      const failingDirect: ITransport = {
        mode: "direct",
        connect: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("LAN unreachable")), 15);
          }),
        close: () => {},
      };
      const fastTailcat: ITransport = {
        mode: "tailcat",
        connect: () =>
          new Promise((resolve) => {
            tcLaunched = true;
            setTimeout(() => resolve(tcWin.conn), 20);
          }),
        close: () => {},
      };
      const slowRelay: ITransport = {
        mode: "relay",
        connect: (signal) =>
          new Promise((resolve) => {
            rLaunched = true;
            signal?.addEventListener("abort", () => {
              rAborted = true;
            });
            setTimeout(() => resolve(rLate.conn), 200);
          }),
        close: () => {
          rCloseCalled = true;
        },
      };

      const racePromise = raceTransports({
        directTransports: [failingDirect],
        tailcatTransport: fastTailcat,
        relayTransport: slowRelay,
        directHeadStartMs: 250,
        authenticate: async (conn) => conn.id,
      });

      await vi.advanceTimersByTimeAsync(15);
      expect(tcLaunched).toBe(true);
      expect(rLaunched).toBe(true);

      await vi.advanceTimersByTimeAsync(20);
      const fallbackResult = await racePromise;
      expect(fallbackResult.mode).toBe("tailcat");
      expect(fallbackResult.auth).toBe("tc-win");
      expect(tcWin.isClosed()).toBe(false);
      expect(rAborted).toBe(true);
      expect(rCloseCalled).toBe(true);

      await vi.advanceTimersByTimeAsync(200);
      expect(rLate.isClosed()).toBe(true);
    });
  });

  describe("InviteEnvelope tc/tcp & logger redaction", () => {
    it("roundtrips, signs, and verifies InviteEnvelope with tc + tcp and redacts tc tokens in logs", () => {
      const hostKeys = generateEd25519Keypair();
      const tcToken = "tcAbCdEfGhIjKlMnOpQrStUvWxYz012345";
      const unsigned = {
        r: "room-tc-1",
        k: hostKeys.publicKeyB64,
        t: "SECRET_JOIN_TOKEN_XYZ",
        ep: ["192.168.1.10:42069"],
        tc: tcToken,
        tcp: 42069,
        sig: "wss://relay.example.com/ws",
        exp: Date.now() + 60_000,
        te: 1,
      };

      const signed: InviteEnvelope = signInviteEnvelope(
        unsigned,
        hostKeys.privateKey,
      );
      expect(verifyInviteEnvelope(signed)).toBe(true);

      const url = encodeInviteUrl(signed);
      const parsed = parseInviteUrl(url);
      expect(parsed).toEqual(signed);
      expect(parsed && verifyInviteEnvelope(parsed)).toBe(true);

      // Invalid tc / tcp rejected
      expect(() =>
        encodeInviteUrl({ ...signed, tc: "badprefix1234567890" }),
      ).toThrow();
      expect(() => encodeInviteUrl({ ...signed, tc: "tcShort" })).toThrow();
      expect(() => encodeInviteUrl({ ...signed, tcp: 0 })).toThrow();
      expect(() => encodeInviteUrl({ ...signed, tcp: 65536 })).toThrow();

      // Redaction in redactInviteUrl & redactLogUrl
      expect(redactInviteUrl(`Connecting to ${tcToken} on port 42069`)).toBe(
        "Connecting to tc[REDACTED] on port 42069",
      );
      expect(redactLogUrl(`tailcat://${tcToken}`)).toBe(
        "tailcat://tc[REDACTED]",
      );
      expect(
        redactLogUrl(`https://user:secret@relay.example.com/${tcToken}`),
      ).toBe("https://redacted:redacted@relay.example.com/tc[REDACTED]");
      expect(redactLogUrl(`${url} ${tcToken}`)).toBe(
        "ytmd://l/[redacted] tc[REDACTED]",
      );
    });
  });
});
