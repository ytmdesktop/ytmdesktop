import IIntegration from "../integration";
import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io";
import CompanionServerAPIv1 from "./api/v1";
import { StoreSchema } from "../../shared/store/schema";
import ElectronStore from "electron-store";
import { BrowserView } from "electron";

export default class CompanionServer implements IIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private store: ElectronStore<StoreSchema>;
  private ytmView: BrowserView;

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
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      }
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public provide(store: ElectronStore<StoreSchema>, ytmView: BrowserView): void {
    this.store = store;
    this.ytmView = ytmView;
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
