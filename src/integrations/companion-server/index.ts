import IIntegration from "../integration";
import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io";
import CompanionServerAPIv1 from "./api/v1";
import { MemoryStoreSchema, StoreSchema } from "../../shared/store/schema";
import ElectronStore from "electron-store";
import { BrowserView, safeStorage } from "electron";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "./shared/auth";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import MemoryStore from "../../memory-store";
import log from "electron-log";

export default class CompanionServer implements IIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private store: ElectronStore<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private ytmView: BrowserView;
  private storeListener: () => void | null = null;

  private createServer() {
    this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    this.fastifyServer.register(cors, {
      origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false)
          ? "*"
          : false
      }
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      },
      getMemoryStore: () => {
        return this.memoryStore;
      }
    });
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      if (!error.statusCode || error.statusCode >= 500) {
        log.error(error);
        reply.send(new Error("An internal server error occurred"));
      } else {
        reply.send(error);
      }
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public provide(store: ElectronStore<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: BrowserView): void {
    this.store = store;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  public async enable() {
    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      this.createServer();
      await this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
      this.storeListener = this.store.onDidChange("integrations", async newState => {
        const validTokenIds: string[] = JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map(
          (authToken: AuthToken) => authToken.id
        );
        if (this.fastifyServer.server.listening) {
          const namespaces = this.fastifyServer.io._nsps.keys();
          let sockets: RemoteSocket<DefaultEventsMap, { tokenId: string }>[] = [];

          for (const namespace of namespaces) {
            const namespacedSockets = await this.fastifyServer.io.of(namespace).fetchSockets();
            sockets = sockets.concat(namespacedSockets);
          }

          for (const socket of sockets) {
            if (!validTokenIds.includes(socket.data.tokenId)) {
              socket.disconnect(true);
            }
          }
        }
      });
    }
  }

  public async disable() {
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
  }
}
