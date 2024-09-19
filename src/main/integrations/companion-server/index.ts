import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import CompanionServerAPIv1 from "./api/v1";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import Integration from "../integration";
import configStore from "../../config-store";
import memoryStore from "../../memory-store";
import { safeStorage } from "electron";
import { MemoryStoreSchema } from "~shared/store/schema";

export default class CompanionServer extends Integration {
  public name = "CompanionServer";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.companionServerEnabled";
  public override dependentStoreProperties: Integration["dependentStoreProperties"] = ["integrations.companionServerCORSWildcardEnabled"];

  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private storeListener: () => void | null = null;
  private authWindowTimeout: NodeJS.Timeout | null = null;

  private createServer() {
    this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    this.fastifyServer.register(cors, {
      origin: configStore.get("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: configStore.get("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
      }
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1"
    });
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      if (!isDefinedAPIError(error)) {
        if (!error.statusCode || error.statusCode >= 500) {
          log.error(error);
          reply.send(new Error("An internal server error occurred"));
          return;
        }
      }

      reply.send(error);
    });
    this.fastifyServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: ["v1"]
      });
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public async onEnabled() {
    if (!memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    memoryStore.onStateChanged(this.memoryStoryListenerCallback);

    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      this.createServer();
      await this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
      this.storeListener = configStore.onDidChange("integrations", async newState => {
        const validTokenIds: string[] = newState.companionServerAuthTokens
          ? JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map((authToken: AuthToken) => authToken.id)
          : [];
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

  public async onDisabled() {
    memoryStore.set("companionServerAuthWindowEnabled", false);
    memoryStore.removeOnStateChanged(this.memoryStoryListenerCallback);
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
  }

  private memoryStoryListenerCallback(newState: MemoryStoreSchema, oldState: MemoryStoreSchema) {
    if (newState.companionServerAuthWindowEnabled && !oldState.companionServerAuthWindowEnabled) {
      this.authWindowTimeout = setTimeout(
        () => {
          memoryStore.set("companionServerAuthWindowEnabled", false);
          this.authWindowTimeout = null;
        },
        5 * 60 * 1000
      );
    } else if (!newState.companionServerAuthWindowEnabled) {
      if (this.authWindowTimeout) {
        clearTimeout(this.authWindowTimeout);
        this.authWindowTimeout = null;
      }
    }
  }
}
