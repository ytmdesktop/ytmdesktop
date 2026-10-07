import { ipcMain, MessagePortMain } from "electron";
import Service from "../service";
import EventEmitter from "node:events";
import { ProtectedAPIOpCode } from "~shared/types";
import log from "electron-log";
import { randomUUID } from "node:crypto";

export default class ProtectedAPIManager extends Service {
  private mainPort: MessagePortMain;
  private apis = new Map<string, ProtectedAPI>();

  public override onPreInitialized(): void {}
  public override onInitialized(): void {
    ipcMain.on("protectedApi:bindPort", event => {
      this.setMainPort(event.ports[0]);
    });

    log.info("ProtectedAPIManager initialized");
  }
  public override onPostInitialized(): void {}
  public override onTerminated(): void {}

  /**
   * Sets the main port for the Protected API. This will reset all APIs currently active to have no port and thus become inactive until bound again
   * @param port
   */
  public setMainPort(port: MessagePortMain) {
    this.mainPort = port;
    if (!this.mainPort) return;

    // Reset the ports on all APIs as when setting the main port the other ports are no longer valid
    for (const [name, api] of this.apis) {
      log.info(`protectedapi: unbinding api '${name}' port`);
      api.setPort(null);
    }

    this.mainPort.on("message", event => {
      if (event.data.op === ProtectedAPIOpCode.ProvideAPIPort) {
        const protectedApi = this.createOrGetAPI(event.data.name);
        protectedApi.setPort(event.ports[0]);
      }
    });
    this.mainPort.start();

    log.info("protectedapi: main port bound");
  }

  public createOrGetAPI(name: string): ProtectedAPI {
    if (this.apis.has(name)) return this.apis.get(name)!;

    const protectedApi = new ProtectedAPI(name);
    this.apis.set(name, protectedApi);

    log.info(`protectedapi: api '${name}' created`);

    return protectedApi;
  }
}

export class ProtectedAPI extends EventEmitter {
  private port: MessagePortMain;
  private waitingInvokes = new Map<string, (...args: unknown[]) => void>();

  public readonly name;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public setPort(port: MessagePortMain) {
    this.port = port;
    if (!this.port) return;

    this.port.on("message", event => {
      if (event.data.op === ProtectedAPIOpCode.Message) {
        this.emit(event.data.name, ...event.data.args);
      }

      if (event.data.op === ProtectedAPIOpCode.InvokeResponse) {
        if (this.waitingInvokes.has(event.data.id)) {
          const callback = this.waitingInvokes.get(event.data.id);
          this.waitingInvokes.delete(event.data.id);
          callback(...event.data.args);
        }
      }
    });
    this.port.on("close", () => {
      log.info(`protectedapi: api '${this.name}' port closed unbinding`);
      this.port = null;
    });
    this.port.start();

    log.info(`protectedapi: api '${this.name}' port bound`);
  }

  /**
   * Posts a RPC message to the other end of the ProtectedAPI
   * @param name RPC name
   * @param args RPC arguments
   */
  public postMessage(name: string, ...args: unknown[]) {
    this.port.postMessage({
      op: ProtectedAPIOpCode.Message,
      name,
      args
    });
  }

  /**
   * Posts a RPC message to the other end of the ProtectedAPI and waits for the result
   * @param name RPC name
   * @param args RPC arguments
   */
  public async invokeMessage(name: string, ...args: unknown[]): Promise<unknown[]> {
    const invokeId = randomUUID();
    return new Promise((resolve, reject) => {
      this.waitingInvokes.set(invokeId, (...args: unknown[]) => {
        resolve(args);
      });

      this.port.postMessage({
        op: ProtectedAPIOpCode.Invoke,
        id: invokeId,
        name,
        args
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
