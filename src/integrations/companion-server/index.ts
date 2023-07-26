import { EventEmitter } from "events";
import IIntegration from "../integration";
import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io";
import CompanionServerAPIv1 from "./api/v1";
import { StoreSchema } from "../../shared/store/schema";
import ElectronStore from "electron-store";

export default class CompanionServer implements IIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private store: ElectronStore<StoreSchema>;

  private eventEmitter = new EventEmitter();

  constructor() {
    this.createServer();
  }

  private createServer() {
    this.fastifyServer = Fastify();
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      remoteCommandEmitter: (command: string, ...args: any[]) => this.eventEmitter.emit("executeRemoteCommand", command, ...args),
      getStore: () => {
        return this.store;
      }
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public addEventListener(listener: (...args: any[]) => void) {
    this.eventEmitter.addListener("executeRemoteCommand", listener);
  }

  public removeEventListener(listener: (...args: any[]) => void) {
    this.eventEmitter.removeListener("executeRemoteCommand", listener);
  }

  public provide(store: ElectronStore<StoreSchema>): void {
    this.store = store;
  }

  public enable() {
    if (!this.fastifyServer.server.listening) {
      this.createServer();
      this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
    }
  }

  public disable() {
    this.fastifyServer.close();
  }
}
