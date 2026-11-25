import { ipcMain } from "electron";
import type { IpcMain, MessagePortMain } from "electron";
import Service, { type ServiceLogger } from "../service";
import EventEmitter from "node:events";
import { ProtectedAPIOpCode } from "~shared/types";
import log from "electron-log";
import { randomUUID } from "node:crypto";

export type ProtectedAPICommandInterceptor = (
  command: string,
  ...args: unknown[]
) => boolean;

export type ProtectedAPILogger = ServiceLogger;

export interface ProtectedAPIPort {
  on(
    event: "message",
    listener: (event: { data: any; ports: any[] }) => void,
  ): unknown;
  on(event: "close", listener: () => void): unknown;
  start(): void;
  postMessage(message: unknown): void;
}

export interface ProtectedAPIManagerDeps {
  ipcMain?: Pick<IpcMain, "on">;
  logger?: ServiceLogger;
}

export default class ProtectedAPIManager extends Service {
  private mainPort: ProtectedAPIPort | null = null;
  private apis = new Map<string, ProtectedAPI>();
  private allowedBinderWebContentsId: number | null = null;
  private ipc: Pick<IpcMain, "on"> | undefined;
  private logger: ServiceLogger = log;

  public setDependencies(deps: ProtectedAPIManagerDeps): this {
    this.ipc = deps.ipcMain;
    this.logger = deps.logger ?? log;
    return this;
  }

  public override onPreInitialized(): void {}
  public override onInitialized(): void {
    const ipc = this.ipc ?? ipcMain;
    ipc.on("protectedApi:bindPort", (event) => {
      const senderId = event.sender?.id ?? null;
      if (
        this.allowedBinderWebContentsId === null ||
        senderId !== this.allowedBinderWebContentsId
      ) {
        this.logger.warn(
          `protectedapi: rejected bindPort from unauthorized sender ${senderId ?? "unknown"} (expected ${this.allowedBinderWebContentsId ?? "none"})`,
        );
        return;
      }

      const port = event.ports?.[0];
      if (!port) {
        this.logger.warn(
          `protectedapi: bindPort from authorized sender ${senderId} had no MessagePort`,
        );
        return;
      }

      this.setMainPort(port);
    });

    this.logger.info("ProtectedAPIManager initialized");
  }
  public override onPostInitialized(): void {}
  public override onTerminated(): void {}

  /**
   * Restricts protectedApi:bindPort IPC binding to the given renderer webContents ID.
   */
  public setAllowedBinderWebContentsId(id: number | null): void {
    this.allowedBinderWebContentsId = id;
    this.logger.debug(
      `protectedapi: allowed binder webContents ID set to ${id ?? "null"}`,
    );
  }

  /**
   * Registers or clears a command interceptor for a ProtectedAPI instance.
   */
  public setCommandInterceptor(
    apiName: string,
    fn: ProtectedAPICommandInterceptor | null,
  ): void {
    this.createOrGetAPI(apiName).setCommandInterceptor(fn);
  }

  /**
   * Sets the main port for the Protected API. This will reset all APIs currently active to have no port and thus become inactive until bound again
   * @param port
   */
  public setMainPort(port: MessagePortMain | ProtectedAPIPort | null) {
    this.mainPort = port;
    if (!this.mainPort) {
      this.logger.warn("protectedapi: main port cleared (null)");
      return;
    }

    // Reset the ports on all APIs as when setting the main port the other ports are no longer valid
    for (const api of this.apis.values()) {
      api.setPort(null);
    }

    const boundMainPort = this.mainPort;
    boundMainPort.on("message", (event) => {
      if (this.mainPort !== boundMainPort) return;
      if (event.data?.op === ProtectedAPIOpCode.ProvideAPIPort) {
        const apiName = event.data.name;
        const apiPort = event.ports?.[0] ?? null;
        if (!apiPort) {
          this.logger.warn(
            `protectedapi: ProvideAPIPort for '${apiName}' had no port`,
          );
          return;
        }
        const protectedApi = this.createOrGetAPI(apiName);
        protectedApi.setPort(apiPort);
      }
    });
    boundMainPort.start();

    this.logger.info("protectedapi: main port bound");
  }

  public createOrGetAPI(name: string): ProtectedAPI {
    if (this.apis.has(name)) return this.apis.get(name)!;

    const protectedApi = new ProtectedAPI(name, this.logger);
    this.apis.set(name, protectedApi);

    this.logger.info(`protectedapi: api '${name}' created`);

    return protectedApi;
  }
}

export class ProtectedAPI extends EventEmitter {
  private port: ProtectedAPIPort | null = null;
  private waitingInvokes = new Map<string, (...args: unknown[]) => void>();
  private portWaiters = new Set<() => void>();
  private commandInterceptor: ProtectedAPICommandInterceptor | null = null;
  private readonly logger: ServiceLogger;

  public readonly name;

  constructor(name: string, logger: ServiceLogger = log) {
    super();
    this.name = name;
    this.logger = logger;
  }

  public get isPortBound(): boolean {
    return this.port !== null;
  }

  public setPort(port: MessagePortMain | ProtectedAPIPort | null) {
    const previousPort = this.port;
    this.port = port;
    if (!this.port) {
      if (previousPort !== null) {
        this.logger.info(`protectedapi: api '${this.name}' port unbound`);
      }
      return;
    }

    if (previousPort !== null && previousPort !== this.port) {
      this.logger.info(`protectedapi: api '${this.name}' replacing bound port`);
    }

    const boundPort = this.port;
    boundPort.on("message", (event) => {
      if (this.port !== boundPort) return;

      if (event.data?.op === ProtectedAPIOpCode.Message) {
        this.emit(event.data.name, ...(event.data.args ?? []));
      }

      if (event.data?.op === ProtectedAPIOpCode.InvokeResponse) {
        if (this.waitingInvokes.has(event.data.id)) {
          const callback = this.waitingInvokes.get(event.data.id);
          this.waitingInvokes.delete(event.data.id);
          if (callback) callback(...(event.data.args ?? []));
        }
      }
    });
    boundPort.on("close", () => {
      if (this.port !== boundPort) return;
      this.logger.info(
        `protectedapi: api '${this.name}' port closed, unbinding`,
      );
      this.port = null;
    });
    boundPort.start();

    this.logger.info(`protectedapi: api '${this.name}' port bound`);

    const waiters = Array.from(this.portWaiters);
    this.portWaiters.clear();
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Resolves immediately if a port is already bound, or once a non-null port is set.
   */
  public waitForPort(timeoutMs?: number): Promise<void> {
    if (this.port !== null) return Promise.resolve();

    this.logger.debug(
      `protectedapi: waiting for api '${this.name}' port${timeoutMs !== undefined ? ` (timeout=${timeoutMs}ms)` : ""}`,
    );

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onBound = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.logger.debug(
          `protectedapi: waiter resolved for api '${this.name}' port`,
        );
        resolve();
      };

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.portWaiters.delete(onBound);
          this.logger.warn(
            `protectedapi: timed out waiting for api '${this.name}' port after ${timeoutMs}ms`,
          );
          reject(
            new Error(`Timed out waiting for ProtectedAPI '${this.name}' port`),
          );
        }, timeoutMs);
      }

      this.portWaiters.add(onBound);
    });
  }

  /**
   * Sets or clears a synchronous interceptor evaluated before posting messages.
   */
  public setCommandInterceptor(
    fn: ProtectedAPICommandInterceptor | null,
  ): void {
    this.commandInterceptor = fn;
    this.logger.debug(
      `protectedapi: command interceptor ${fn ? "set" : "cleared"} for api '${this.name}'`,
    );
  }

  /**
   * Posts a RPC message to the other end of the ProtectedAPI
   * @param name RPC name
   * @param args RPC arguments
   */
  public postMessage(name: string, ...args: unknown[]) {
    if (this.commandInterceptor) {
      const isExecute = name === "execute" && typeof args[0] === "string";
      const command = isExecute ? (args[0] as string) : name;
      const commandArgs = isExecute ? args.slice(1) : args;
      const allowed = this.commandInterceptor(command, ...commandArgs);
      if (allowed === false) {
        this.logger.warn(
          `protectedapi: blocked command '${command}' on api '${this.name}'`,
        );
        return;
      }
    }

    if (!this.port) {
      this.logger.warn(
        `protectedapi: dropped message '${name}' on api '${this.name}' because no port is bound`,
      );
      return;
    }

    this.port.postMessage({
      op: ProtectedAPIOpCode.Message,
      name,
      args,
    });
  }

  /**
   * Posts a RPC message to the other end of the ProtectedAPI and waits for the result
   * @param name RPC name
   * @param args RPC arguments
   */
  public async invokeMessage(
    name: string,
    ...args: unknown[]
  ): Promise<unknown[]> {
    const invokeId = randomUUID();
    return new Promise((resolve, reject) => {
      this.waitingInvokes.set(invokeId, (...args: unknown[]) => {
        resolve(args);
      });

      this.port?.postMessage({
        op: ProtectedAPIOpCode.Invoke,
        id: invokeId,
        name,
        args,
      });

      setTimeout(() => {
        if (this.waitingInvokes.has(invokeId)) {
          this.waitingInvokes.delete(invokeId);
          reject();
        }
      }, 30 * 1000);
    });
  }
}
