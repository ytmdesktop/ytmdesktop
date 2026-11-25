import "./ws-env";
import {
  execFileSync,
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";
import {
  noopLogger,
  redactInviteUrl,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import type { DirectWebSocketFactory } from "./direct-ws";
import {
  createTransportConnection,
  type ITransport,
  type TransportConnection,
} from "./types";

const TAILCAT_ADDR_RE = /\btc[A-Za-z0-9_-]{16,}\b/;
const TAILCAT_ADDR_STRICT_RE = /^tc[A-Za-z0-9_-]{14,510}$/;
const DEFAULT_SIDECAR_START_TIMEOUT_MS = 15_000;
const DEFAULT_FORWARD_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_KILL_GRACE_MS = 2_000;
const FORWARD_CONNECT_RETRY_MS = 25;
const MAX_OUTPUT_BUFFER_CHARS = 32_768;

export type TailcatChildProcess = Pick<
  ChildProcess,
  "stdout" | "stderr" | "kill" | "on" | "once" | "removeListener"
> & {
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
};

export type TailcatSpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => TailcatChildProcess;

export type ResolveTailcatBinaryOptions = {
  envBin?: string;
  resourcesPath?: string;
  appPath?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
  whichSync?: (bin: string) => string | null;
};

function defaultWhichSync(
  bin: string,
  existsSync: (p: string) => boolean,
): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      if (existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore inaccessible PATH entries
    }
  }
  return null;
}

/**
 * Resolves the `tailcat` sidecar binary in priority order:
 * 1. `envBin ?? process.env.YTMD_TAILCAT_BIN`
 * 2. `<resourcesPath>/tailcat(.exe)`
 * 3. `<appPath>/resources/bin/tailcat(.exe)`
 * 4. System `PATH` (`tailcat(.exe)`)
 */
export function resolveTailcatBinary(
  options: ResolveTailcatBinaryOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const binName = platform === "win32" ? "tailcat.exe" : "tailcat";
  const existsSync = options.existsSync ?? fs.existsSync;
  const whichSync =
    options.whichSync ?? ((bin: string) => defaultWhichSync(bin, existsSync));

  const envBin =
    "envBin" in options ? options.envBin : process.env.YTMD_TAILCAT_BIN;
  const resourcesPath =
    "resourcesPath" in options
      ? options.resourcesPath
      : (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const appPath = "appPath" in options ? options.appPath : process.cwd();

  const candidates: Array<string | null | undefined> = [
    envBin || null,
    resourcesPath ? path.join(resourcesPath, binName) : null,
    appPath ? path.join(appPath, "resources", "bin", binName) : null,
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  const pathMatch = whichSync(binName);
  if (pathMatch && existsSync(pathMatch)) {
    return pathMatch;
  }

  return null;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isChildExited(child: TailcatChildProcess): boolean {
  return (
    (child.exitCode !== undefined && child.exitCode !== null) ||
    (child.signalCode !== undefined && child.signalCode !== null)
  );
}

function terminateChildAsync(
  child: TailcatChildProcess,
  graceMs = DEFAULT_STOP_KILL_GRACE_MS,
): Promise<void> {
  if (isChildExited(child)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let done = false;
    let killTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      child.removeListener("exit", onExit);
      child.removeListener("close", onExit);
      child.removeListener("error", onError);
      resolve();
    };

    const onExit = () => finish();
    const onError = () => finish();

    child.once("exit", onExit);
    child.once("close", onExit);
    child.once("error", onError);

    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }

    if (isChildExited(child)) {
      finish();
      return;
    }

    killTimer = setTimeout(() => {
      killTimer = null;
      if (!isChildExited(child)) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill errors
        }
      }
    }, graceMs);
    killTimer.unref?.();
  });
}

function terminateChildImmediate(child: TailcatChildProcess): void {
  void terminateChildAsync(child);
}

function defaultAllocateLocalPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
        } else if (!port) {
          reject(new Error("Failed to allocate local loopback port"));
        } else {
          resolve(port);
        }
      });
    });
  });
}

export type TailcatHostSidecarOptions = {
  binaryPath?: string;
  spawnFn?: TailcatSpawnFn;
  logger?: ListenTogetherLogger;
};

export type TailcatHostSidecarStartOptions = {
  localPort: number;
  derpMapUrl?: string | null;
  stateDir?: string | null;
  timeoutMs?: number;
};

/**
 * Manages the host-side `tailcat serve --log <localPort>` sidecar process
 * and parses its `tc...` capability address.
 */
export class TailcatHostSidecar {
  private readonly binaryPath?: string;
  private readonly spawnFn: TailcatSpawnFn;
  private readonly logger: ListenTogetherLogger;
  private child: TailcatChildProcess | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(options: TailcatHostSidecarOptions = {}) {
    this.binaryPath = options.binaryPath;
    this.spawnFn =
      options.spawnFn ??
      ((command, args, spawnOpts) => nodeSpawn(command, args, spawnOpts));
    this.logger = options.logger ?? noopLogger;
  }

  public async start(
    options: TailcatHostSidecarStartOptions,
  ): Promise<{ tcAddress: string; remotePort: number }> {
    if (this.child) {
      throw new Error("TailcatHostSidecar already started");
    }
    if (!isValidPort(options.localPort)) {
      throw new Error(
        `Invalid localPort for tailcat serve: ${options.localPort}`,
      );
    }

    const bin = this.binaryPath ?? resolveTailcatBinary();
    if (!bin) {
      throw new Error("Tailcat binary not found");
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_SIDECAR_START_TIMEOUT_MS;
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.derpMapUrl) {
      env.TAILCAT_DERPMAP_URL = options.derpMapUrl;
    }

    let keyArg = "--key=new";
    if (options.stateDir) {
      try {
        fs.mkdirSync(options.stateDir, { recursive: true });
        const keyFile = path.join(options.stateDir, "host.private.json");
        if (!fs.existsSync(keyFile)) {
          execFileSync(bin, ["genkey", `--key=${keyFile}`], {
            env,
            timeout: 5000,
            windowsHide: true,
          });
        }
        if (fs.existsSync(keyFile)) {
          keyArg = `--key=${keyFile}`;
        }
      } catch (err) {
        this.logger.warn?.(
          "Failed to prepare persistent Tailcat key; falling back to --key=new",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
    const args = ["serve", keyArg, "--log", String(options.localPort)];
    this.logger.debug?.("Starting TailcatHostSidecar", {
      localPort: options.localPort,
      hasDerpMapUrl: Boolean(options.derpMapUrl),
      timeoutMs,
    });

    const child = this.spawnFn(bin, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    return new Promise<{ tcAddress: string; remotePort: number }>(
      (resolve, reject) => {
        let settled = false;
        let stdoutBuf = "";
        let stderrBuf = "";
        let timeoutTimer: NodeJS.Timeout | null = null;

        const appendAndScan = (
          prev: string,
          chunk: Buffer | string,
        ): string => {
          const text =
            typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const next = (prev + text).slice(-MAX_OUTPUT_BUFFER_CHARS);
          const match = TAILCAT_ADDR_RE.exec(next);
          if (match) {
            onFound(match[0]);
          }
          return next;
        };

        const onStdoutData = (chunk: Buffer | string) => {
          stdoutBuf = appendAndScan(stdoutBuf, chunk);
        };

        const onStderrData = (chunk: Buffer | string) => {
          stderrBuf = appendAndScan(stderrBuf, chunk);
        };

        const cleanupStartup = () => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          child.stdout?.removeListener("data", onStdoutData);
          child.stderr?.removeListener("data", onStderrData);
          child.removeListener("error", onStartupError);
          child.removeListener("exit", onStartupExit);
          child.removeListener("close", onStartupExit);
        };

        const onFound = (tcAddress: string) => {
          if (settled) return;
          settled = true;
          cleanupStartup();

          child.on("error", (err) => {
            this.logger.warn?.("TailcatHostSidecar process error", {
              error: redactInviteUrl(err.message),
            });
          });
          child.once("exit", (code, sig) => {
            if (this.child === child) {
              this.child = null;
            }
            this.logger.debug?.("TailcatHostSidecar exited", {
              code,
              signal: sig,
            });
          });

          this.logger.info?.("TailcatHostSidecar ready", {
            remotePort: options.localPort,
          });
          resolve({ tcAddress, remotePort: options.localPort });
        };

        const fail = (err: Error, killProcess: boolean) => {
          if (settled) return;
          settled = true;
          cleanupStartup();
          if (this.child === child) {
            this.child = null;
          }
          if (killProcess) {
            terminateChildImmediate(child);
          }
          reject(err);
        };

        const onStartupError = (err: Error) => {
          this.logger.warn?.("TailcatHostSidecar failed to spawn", {
            error: redactInviteUrl(err.message),
          });
          fail(err, false);
        };

        const onStartupExit = (
          code: number | null,
          sig: NodeJS.Signals | null,
        ) => {
          this.logger.warn?.(
            "TailcatHostSidecar exited before publishing address",
            {
              code,
              signal: sig,
            },
          );
          fail(
            new Error(
              `Tailcat sidecar exited before publishing address (code=${code ?? "null"}, signal=${sig ?? "null"})`,
            ),
            false,
          );
        };

        child.stdout?.on("data", onStdoutData);
        child.stderr?.on("data", onStderrData);
        child.once("error", onStartupError);
        child.once("exit", onStartupExit);
        child.once("close", onStartupExit);

        if (timeoutMs > 0) {
          timeoutTimer = setTimeout(() => {
            this.logger.warn?.("TailcatHostSidecar start timed out", {
              timeoutMs,
            });
            fail(
              new Error(`Tailcat sidecar timed out after ${timeoutMs} ms`),
              true,
            );
          }, timeoutMs);
        }
      },
    );
  }

  public stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    const child = this.child;
    this.child = null;
    if (!child) {
      return Promise.resolve();
    }

    const promise = terminateChildAsync(
      child,
      DEFAULT_STOP_KILL_GRACE_MS,
    ).finally(() => {
      if (this.stopPromise === promise) {
        this.stopPromise = null;
      }
    });
    this.stopPromise = promise;
    return promise;
  }
}

export type TailcatWsTransportOptions = {
  tcAddress: string;
  remotePort: number;
  derpMapUrl?: string | null;
  timeoutMs?: number;
  binaryPath?: string;
  spawnFn?: TailcatSpawnFn;
  createWebSocket?: DirectWebSocketFactory;
  allocateLocalPort?: () => Promise<number>;
  logger?: ListenTogetherLogger;
};

/**
 * Guest-side Tailcat WebSocket transport implementing `ITransport`.
 * Spawns `tailcat forward <tcAddress> <localPort>:<remotePort>` and connects
 * a `ws` WebSocket over loopback to `ws://127.0.0.1:<localPort>/`.
 */
export class TailcatWsTransport implements ITransport {
  public readonly mode = "tailcat" as const;
  private readonly tcAddress: string;
  private readonly remotePort: number;
  private readonly derpMapUrl?: string | null;
  private readonly timeoutMs: number;
  private readonly binaryPath?: string;
  private readonly spawnFn: TailcatSpawnFn;
  private readonly createWebSocket?: DirectWebSocketFactory;
  private readonly allocateLocalPort: () => Promise<number>;
  private readonly logger: ListenTogetherLogger;

  private activeController: AbortController | null = null;
  private activeChild: TailcatChildProcess | null = null;
  private activeConn: TransportConnection | null = null;

  constructor(options: TailcatWsTransportOptions) {
    this.tcAddress = options.tcAddress;
    this.remotePort = options.remotePort;
    this.derpMapUrl = options.derpMapUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FORWARD_TIMEOUT_MS;
    this.binaryPath = options.binaryPath;
    this.spawnFn =
      options.spawnFn ??
      ((command, args, spawnOpts) => nodeSpawn(command, args, spawnOpts));
    this.createWebSocket = options.createWebSocket;
    this.allocateLocalPort =
      options.allocateLocalPort ?? defaultAllocateLocalPort;
    this.logger = options.logger ?? noopLogger;
  }

  public async connect(signal?: AbortSignal): Promise<TransportConnection> {
    if (signal?.aborted) {
      throw new Error("Tailcat WebSocket connection aborted");
    }
    if (!TAILCAT_ADDR_STRICT_RE.test(this.tcAddress)) {
      throw new Error("Invalid Tailcat capability address");
    }
    if (!isValidPort(this.remotePort)) {
      throw new Error(`Invalid Tailcat remote port: ${this.remotePort}`);
    }

    const bin = this.binaryPath ?? resolveTailcatBinary();
    if (!bin) {
      throw new Error("Tailcat binary not found");
    }

    const controller = new AbortController();
    this.activeController = controller;
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });

    let child: TailcatChildProcess | null = null;

    try {
      const localPort = await this.allocateLocalPort();
      if (controller.signal.aborted) {
        throw new Error("Tailcat WebSocket connection aborted");
      }
      if (!isValidPort(localPort)) {
        throw new Error(`Invalid allocated local port: ${localPort}`);
      }

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (this.derpMapUrl) {
        env.TAILCAT_DERPMAP_URL = this.derpMapUrl;
      }

      const args = [
        "forward",
        "--key=new",
        this.tcAddress,
        `${localPort}:${this.remotePort}`,
      ];
      child = this.spawnFn(bin, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.activeChild = child;

      const ws = await this.connectForwarderWebSocket(
        child,
        localPort,
        controller.signal,
      );

      if (controller.signal.aborted) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        throw new Error("Tailcat WebSocket connection aborted");
      }

      const conn = this.wrapTailcatWebSocket(ws, child);
      this.activeConn = conn;
      return conn;
    } catch (err) {
      if (child) {
        if (this.activeChild === child) {
          this.activeChild = null;
        }
        terminateChildImmediate(child);
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onExternalAbort);
      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }

  private connectForwarderWebSocket(
    child: TailcatChildProcess,
    localPort: number,
    signal: AbortSignal,
  ): Promise<WebSocket> {
    const wsUrl = `ws://127.0.0.1:${localPort}/`;
    const makeWs =
      this.createWebSocket ?? ((url, opts) => new WebSocket(url, opts));
    const deadlineMs =
      this.timeoutMs > 0 ? Date.now() + this.timeoutMs : Infinity;

    return new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let currentWs: WebSocket | null = null;
      let retryTimer: NodeJS.Timeout | null = null;
      let totalTimer: NodeJS.Timeout | null = null;

      const cleanupAll = () => {
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        if (totalTimer) {
          clearTimeout(totalTimer);
          totalTimer = null;
        }
        signal.removeEventListener("abort", onAbort);
        child.removeListener("error", onChildError);
        child.removeListener("exit", onChildExit);
        child.removeListener("close", onChildExit);
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanupAll();
        if (currentWs) {
          try {
            currentWs.terminate();
          } catch {
            // ignore
          }
          currentWs = null;
        }
        reject(err);
      };

      const onAbort = () => {
        this.logger.debug?.("Tailcat WebSocket connection aborted", {
          remoteLabel: "tailcat:redacted",
        });
        fail(new Error("Tailcat WebSocket connection aborted"));
      };

      const onChildError = (err: Error) => {
        this.logger.warn?.("Tailcat forwarder spawn error", {
          error: redactInviteUrl(err.message),
        });
        fail(err);
      };

      const onChildExit = (code: number | null, sig: NodeJS.Signals | null) => {
        this.logger.warn?.("Tailcat forwarder exited before WebSocket opened", {
          code,
          signal: sig,
        });
        fail(
          new Error(
            `Tailcat forwarder exited before WebSocket opened (code=${code ?? "null"}, signal=${sig ?? "null"})`,
          ),
        );
      };

      signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", onChildError);
      child.once("exit", onChildExit);
      child.once("close", onChildExit);

      if (this.timeoutMs > 0) {
        totalTimer = setTimeout(() => {
          this.logger.warn?.("Tailcat WebSocket connection timed out", {
            timeoutMs: this.timeoutMs,
          });
          fail(
            new Error(`Tailcat WebSocket timeout after ${this.timeoutMs} ms`),
          );
        }, this.timeoutMs);
      }

      const attemptConnect = () => {
        if (settled) return;
        if (signal.aborted) {
          onAbort();
          return;
        }
        if (isChildExited(child)) {
          onChildExit(child.exitCode ?? null, child.signalCode ?? null);
          return;
        }

        const remainingMs = Math.max(50, deadlineMs - Date.now());
        const ws = makeWs(wsUrl, {
          handshakeTimeout: this.timeoutMs > 0 ? remainingMs : undefined,
          followRedirects: false,
          maxRedirects: 0,
          skipUTF8Validation: true,
        });
        currentWs = ws;

        const cleanupAttempt = () => {
          ws.removeListener("open", onOpen);
          ws.removeListener("error", onError);
          ws.removeListener("close", onClose);
        };

        const scheduleRetry = (err: Error) => {
          cleanupAttempt();
          try {
            ws.terminate();
          } catch {
            // ignore
          }
          if (currentWs === ws) {
            currentWs = null;
          }
          if (settled) return;
          if (this.timeoutMs > 0 && Date.now() >= deadlineMs) {
            fail(err);
            return;
          }
          retryTimer = setTimeout(() => {
            retryTimer = null;
            attemptConnect();
          }, FORWARD_CONNECT_RETRY_MS);
        };

        const onOpen = () => {
          if (settled) {
            cleanupAttempt();
            try {
              ws.terminate();
            } catch {
              // ignore
            }
            return;
          }
          settled = true;
          cleanupAttempt();
          cleanupAll();
          ws.on("error", () => {});
          resolve(ws);
        };

        const onError = (err: Error) => {
          const code = (err as NodeJS.ErrnoException).code;
          if (
            code === "ECONNREFUSED" ||
            code === "ECONNRESET" ||
            /ECONNREFUSED|ECONNRESET/i.test(err.message)
          ) {
            scheduleRetry(err);
            return;
          }
          cleanupAttempt();
          fail(err);
        };

        const onClose = (code: number) => {
          cleanupAttempt();
          if (settled) return;
          if (
            (this.timeoutMs <= 0 || Date.now() < deadlineMs) &&
            !isChildExited(child)
          ) {
            scheduleRetry(
              new Error(
                `Tailcat forwarder closed socket before open (${code})`,
              ),
            );
            return;
          }
          fail(new Error(`Tailcat WebSocket closed before open (${code})`));
        };

        ws.once("open", onOpen);
        ws.once("error", onError);
        ws.once("close", onClose);
      };

      attemptConnect();
    });
  }

  private wrapTailcatWebSocket(
    ws: WebSocket,
    child: TailcatChildProcess,
  ): TransportConnection {
    const id = `tailcat-${crypto.randomUUID()}`;

    const stopForwarder = () => {
      if (this.activeChild === child) {
        this.activeChild = null;
      }
      child.removeListener("exit", onChildExitAfterOpen);
      child.removeListener("error", onChildErrorAfterOpen);
      terminateChildImmediate(child);
    };

    const { conn, emitError } = createTransportConnection(ws, {
      id,
      mode: "tailcat",
      remoteLabel: "tailcat:redacted",
      onClose: stopForwarder,
    });

    const onChildExitAfterOpen = () => {
      if (this.activeChild === child) {
        this.activeChild = null;
      }
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.terminate();
      }
    };

    const onChildErrorAfterOpen = (err: Error) => {
      emitError(err);
      onChildExitAfterOpen();
    };

    child.once("exit", onChildExitAfterOpen);
    child.on("error", onChildErrorAfterOpen);

    return conn;
  }

  public close(): void {
    this.activeController?.abort();
    this.activeConn?.close();
    if (this.activeChild) {
      const child = this.activeChild;
      this.activeChild = null;
      terminateChildImmediate(child);
    }
  }
}

export type ProbeTailcatRoomStatusResult = {
  online: boolean;
  roomName?: string | null;
  memberCount?: number;
};

/**
 * Probes a friend's Tailcat endpoint (`GET /lt-status`) to check if their room is open.
 */
export async function probeTailcatRoomStatus(options: {
  tcAddress: string;
  remotePort: number;
  derpMapUrl?: string | null;
  timeoutMs?: number;
  binaryPath?: string;
  spawnFn?: TailcatSpawnFn;
}): Promise<ProbeTailcatRoomStatusResult> {
  if (!TAILCAT_ADDR_STRICT_RE.test(options.tcAddress) || !isValidPort(options.remotePort)) {
    return { online: false };
  }
  const bin = options.binaryPath ?? resolveTailcatBinary();
  if (!bin) {
    return { online: false };
  }

  let localPort: number;
  try {
    localPort = await defaultAllocateLocalPort();
  } catch {
    return { online: false };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.derpMapUrl) {
    env.TAILCAT_DERPMAP_URL = options.derpMapUrl;
  }

  const spawn = options.spawnFn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, opts));
  const child = spawn(
    bin,
    ["forward", "--key=new", options.tcAddress, `${localPort}:${options.remotePort}`],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const timeoutMs = options.timeoutMs ?? 4_500;
  const deadline = Date.now() + timeoutMs;

  return new Promise<ProbeTailcatRoomStatusResult>((resolve) => {
    let settled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let activeReq: http.ClientRequest | null = null;

    const finish = (result: ProbeTailcatRoomStatusResult) => {
      if (settled) return;
      settled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      try {
        activeReq?.destroy();
      } catch {
        // ignore
      }
      child.removeListener("error", onChildExit);
      child.removeListener("exit", onChildExit);
      terminateChildImmediate(child);
      resolve(result);
    };

    const onChildExit = () => finish({ online: false });
    child.once("error", onChildExit);
    child.once("exit", onChildExit);

    timeoutTimer = setTimeout(() => finish({ online: false }), timeoutMs);
    timeoutTimer.unref?.();

    const attempt = () => {
      if (settled) return;
      if (Date.now() >= deadline) {
        finish({ online: false });
        return;
      }
      const req = http.get(
        `http://127.0.0.1:${localPort}/lt-status`,
        { timeout: 1500 },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (raw.length < 4096) raw += chunk;
          });
          res.on("end", () => {
            if (res.statusCode !== 200) {
              finish({ online: false });
              return;
            }
            try {
              const parsed = JSON.parse(raw) as {
                ok?: boolean;
                roomName?: unknown;
                memberCount?: unknown;
              };
              finish({
                online: Boolean(parsed?.ok),
                roomName:
                  typeof parsed?.roomName === "string" && parsed.roomName.trim()
                    ? parsed.roomName.trim()
                    : null,
                memberCount:
                  typeof parsed?.memberCount === "number"
                    ? parsed.memberCount
                    : undefined,
              });
            } catch {
              finish({ online: false });
            }
          });
        },
      );
      activeReq = req;
      req.on("error", () => {
        if (settled) return;
        if (Date.now() + 80 < deadline) {
          retryTimer = setTimeout(attempt, 80);
          retryTimer.unref?.();
        } else {
          finish({ online: false });
        }
      });
      req.on("timeout", () => {
        req.destroy();
      });
    };

    retryTimer = setTimeout(attempt, 40);
    retryTimer.unref?.();
  });
}
