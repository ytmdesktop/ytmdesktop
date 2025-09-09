import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import CompanionServerAPIv1, { transformPlayerState as transformPlayerStatev1 } from "./api/v1";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import Integration from "../integration";
import { safeStorage } from "electron";
import { MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../../services/memorystore";
import ConfigStore from "../../services/configstore";
import { Constructor } from "~shared/types";
import Service from "../../services/service";
import net from "node:net";
import playerStateStore from "../../player-state-store";
import mDNS from "multicast-dns";
import os from "node:os";
import CompanionServerIpcClient from "./ipc-client";
import { PlayerState } from "~shared/playerstatestore/types";

const API_VERSIONS = ["v1"];
const TRANSFORM_PLAYER_STATE_FOR_VERSION: { [version: string]: (state: PlayerState) => unknown } = {
  v1: transformPlayerStatev1
};

enum IpcOpcode {
  HELLO = 0,
  SELECT_VERSION = 1,
  EVENT = 2,
  PING = 3,
  PONG = 4
}

export default class CompanionServer extends Integration {
  public name = "CompanionServer";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.companionServerEnabled";
  public override dependentStoreProperties: Integration["dependentStoreProperties"] = ["integrations.companionServerCORSWildcardEnabled"];

  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private storeListener: () => void | null = null;
  private authWindowTimeout: NodeJS.Timeout | null = null;

  private ipcServer: net.Server;
  private ipcServerClients: CompanionServerIpcClient[] = [];
  private stateStoreListener: (state: PlayerState) => void | null = null;

  private mdns: mDNS;

  private createServer() {
    const configStore = this.getService(ConfigStore);
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
      prefix: "/api/v1",
      getService: <T extends Service>(service: Constructor<T>) => {
        return this.getService<T>(service);
      }
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
        apiVersions: API_VERSIONS
      });
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  private getIpcPath() {
    if (process.platform === "win32") {
      return `\\\\?\\pipe\\ytmdesktop-ipc`;
    }

    const dirtyPrefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
    const prefix = dirtyPrefix.replace(/\/$/, "");

    return `${prefix}/ytmdesktop-ipc`;
  }

  private createIpcServer() {
    this.ipcServer = net.createServer(socket => {
      log.info("ipc: client connected");
      const ipcClient = new CompanionServerIpcClient(socket);
      this.ipcServerClients.push(ipcClient);
      let heartbeated = true;
      const heartbeatInterval = setInterval(() => {
        if (!heartbeated) {
          log.info("ipc: client missed heartbeat - disconnecting");
          socket.destroy();
        }
        heartbeated = false;
      }, 30 * 1000);

      socket.on("data", data => {
        try {
          const op: IpcOpcode = data.readInt32LE(0);
          if (op === IpcOpcode.SELECT_VERSION) {
            if (ipcClient.version) {
              socket.destroy();
              return;
            }

            const versionStringLength = data.readInt32LE(4);
            if (versionStringLength > 255) {
              socket.destroy();
              return;
            }
            const selectedVersion = data.toString("utf-8", 8, 8 + versionStringLength);
            if (API_VERSIONS.indexOf(selectedVersion) === -1) {
              socket.destroy();
              return;
            }

            log.info(`ipc: client selected api version ${selectedVersion}`);
            ipcClient.version = selectedVersion;
          }

          if (op === IpcOpcode.PING) {
            heartbeated = true;
            const pong = Buffer.alloc(4);
            pong.writeInt32LE(IpcOpcode.PONG);
            socket.write(pong);
          }
        } catch {
          socket.destroy();
        }
      });

      socket.on("error", error => {
        log.info(`ipc: client errored ${error}`);
      });

      socket.on("close", () => {
        log.info("ipc: client disconnected");

        clearInterval(heartbeatInterval);

        const clientIndex = this.ipcServerClients.indexOf(ipcClient);
        if (clientIndex !== -1) {
          this.ipcServerClients.splice(clientIndex, 1);
        }
      });
    });

    const pipePath = this.getIpcPath();
    this.ipcServer.listen(pipePath, () => {
      log.info(`ipc: listening on ${pipePath}`);
    });

    this.stateStoreListener = (state: PlayerState) => {
      const eventNameBuffer = Buffer.from("state-update");
      this.ipcServerClients.forEach(ipcClient => {
        if (ipcClient.version) {
          const stateBuffer = Buffer.from(JSON.stringify(TRANSFORM_PLAYER_STATE_FOR_VERSION[ipcClient.version](state)));
          const buffer = Buffer.alloc(12 + eventNameBuffer.byteLength + stateBuffer.byteLength);
          buffer.writeInt32LE(IpcOpcode.EVENT, 0);
          buffer.writeInt32LE(eventNameBuffer.byteLength, 4);
          buffer.writeInt32LE(stateBuffer.byteLength, 8);
          eventNameBuffer.copy(buffer, 12);
          stateBuffer.copy(buffer, 12 + eventNameBuffer.length);
          ipcClient.socket.write(buffer);
        }
      });
    };
    playerStateStore.addEventListener(this.stateStoreListener);
  }

  private createMdnsServer() {
    this.mdns = mDNS();

    const hostname = os.hostname();
    const aRecords = [];

    const interfaces = os.networkInterfaces();
    for (const deviceName in interfaces) {
      const iface = interfaces[deviceName];

      for (const alias of iface) {
        if (alias.family === "IPv4" && !alias.internal) {
          aRecords.push({
            name: `${hostname}._ytmdesktop._tcp.local`,
            type: "A",
            ttl: 60,
            data: alias.address
          });
        }
      }
    }

    this.mdns.on("query", query => {
      for (const question of query.questions) {
        if (question.name === "_services._dns-sd._udp.local") {
          this.mdns.respond({
            answers: [
              {
                name: `_services._dns-sd._udp.local`,
                type: "PTR",
                ttl: 3960,
                data: `_ytmdesktop._tcp.local`
              }
            ]
          });
        }

        if (question.name === "_ytmdesktop._tcp.local") {
          this.mdns.respond({
            answers: [
              {
                name: `_ytmdesktop._tcp.local`,
                type: "PTR",
                ttl: 60,
                data: `${hostname}._ytmdesktop._tcp.local`
              }
            ]
          });
        }

        if (question.name === `${hostname}._ytmdesktop._tcp.local`) {
          const compiledAnswers = [];
          if (question.type === "SRV") {
            compiledAnswers.push({
              name: `${hostname}._ytmdesktop._tcp.local`,
              type: "SRV",
              data: {
                port: 9863,
                weight: 0,
                priority: 0,
                target: `${hostname}._ytmdesktop._tcp.local`
              }
            });
            compiledAnswers.push(...aRecords);
          }

          if (question.type === "TXT") {
            compiledAnswers.push({
              name: `${hostname}._ytmdesktop._tcp.local`,
              type: "TXT",
              ttl: 60,
              data: ""
            });
          }

          if (question.type === "A") {
            compiledAnswers.push(...aRecords);
          }

          this.mdns.respond({
            answers: compiledAnswers
          });
        }
      }
    });

    log.info("mdns: created mdns server");
  }

  public onSetup() {}

  public async onEnabled() {
    const configStore = this.getService(ConfigStore);
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);

    if (!memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    this.createIpcServer();

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

    this.createMdnsServer();
  }

  public async onDisabled() {
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("companionServerAuthWindowEnabled", false);
    memoryStore.removeOnStateChanged(this.memoryStoryListenerCallback);
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
    if (this.ipcServer) {
      this.ipcServer.close();
      if (this.stateStoreListener) {
        playerStateStore.removeEventListener(this.stateStoreListener);
      }
    }
    if (this.mdns) {
      this.mdns.destroy();
    }
  }

  private memoryStoryListenerCallback(newState: MemoryStoreSchema, oldState: MemoryStoreSchema) {
    if (newState.companionServerAuthWindowEnabled && !oldState.companionServerAuthWindowEnabled) {
      this.authWindowTimeout = setTimeout(
        () => {
          const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
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
