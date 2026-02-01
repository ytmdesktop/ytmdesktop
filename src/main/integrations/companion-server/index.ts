import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket";
import CompanionServerAPIv1 from "./api/v1";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import { BrowserView, safeStorage, app } from "electron";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import MemoryStore from "../../memory-store";
import log from "electron-log";
import { isDefinedAPIError, getStandardizedError, InternalServerError } from "./api-shared/errors";
import BaseIntegration from "../base-integration";
import os from "os";
import path from "path";
import fs from "fs/promises";

export default class CompanionServer extends BaseIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private store: Conf<StoreSchema>;
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

    // Enhanced error handler with better categorization and logging
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      try {
        if (isDefinedAPIError(error)) {
          // Already a known API error, just pass it through
          log.debug(`API error occurred: ${error.code} - ${error.message}`);
          reply.status(error.statusCode).send(error);
          return;
        }

        // Handle common system-level errors
        if (error.code === "EADDRINUSE") {
          log.error(`Server address in use (port ${this.listenPort}):`, error);
          reply.status(503).send(new InternalServerError(`Server cannot bind to port ${this.listenPort}`));
          return;
        }

        // Get a standardized error for unknown error types
        const standardizedError = getStandardizedError(error);

        // Only log detailed errors for server errors
        if (standardizedError.statusCode >= 500) {
          log.error(`Server error in companion server:`, error);
        } else {
          log.debug(`Client error in companion server: ${standardizedError.code} - ${standardizedError.message}`);
        }

        reply.status(standardizedError.statusCode).send(standardizedError);
      } catch (handlerError) {
        // If error handling itself fails, return a generic error
        log.error("Error in error handler:", handlerError);
        reply.status(500).send(new InternalServerError("An unexpected error occurred"));
      }
    });

    // Root endpoint - HTML Remote Control page (v1.13.0 compatibility)
    this.fastifyServer.get("/", (request, reply) => {
      const playerState = this.memoryStore.get("ytm") as
        | { player?: { videoDetails?: { title?: string; author?: string; thumbnail?: { thumbnails?: Array<{ url: string }> } } } }
        | undefined;
      const track = playerState?.player;
      const hostname = os.hostname();
      const networkInterfaces = os.networkInterfaces();

      // Get first IPv4 address
      let ipAddress = "127.0.0.1";
      for (const name of Object.keys(networkInterfaces)) {
        for (const net of networkInterfaces[name]) {
          if (net.family === "IPv4" && !net.internal) {
            ipAddress = net.address;
            break;
          }
        }
      }

      const html = `<!DOCTYPE html>
<html>
    <head>
        <title>YTMDesktop Remote Control</title>
        <meta http-equiv="refresh" content="60">
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">
        <style>
            html {
                margin: 0;
                padding: 0;
                text-align: center;
                background: linear-gradient(to right top, #000 20%, #1d1d1d 80%);
                background-attachment: fixed;
                font-family: sans-serif;
            }
            h5 {
                margin: 1rem 0 1rem 0 !important;
            }
            .center {
                width: 68%;
                position: absolute;
                left: 50%;
                top: 48%;
                transform: translate(-50%, -50%);
            }
        </style>
    </head>
    <body>
        <h4 class="white-text">YTMDesktop Remote Control</h4>
        <div class="row" style="height: 0; visibility: visible">
            <div class="col s8 offset-s2 m6 offset-m3 l2 offset-l5">
                <div class="card horizontal">
                    <div class="card-image" style="padding: 3px;">
                        <img src="${track?.videoDetails?.thumbnail?.thumbnails?.[0]?.url || ""}" style="min-width: 78px; width: 78px;">
                    </div>
                    <div class="card-stacked" style="width: 74%;">
                        <div class="card-content" style="font-size: 11px;">
                            <p class="truncate">
                                <strong>${track?.videoDetails?.title || "No track playing"}</strong>
                            </p>
                            ${track?.videoDetails?.author || ""}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="container" style="margin: 13% auto 5% auto;">
            <div class="row">
                <div class="col s12">
                    <div class="card transparent z-depth-0">
                        <div class="card-content">
                            <div class="row" style="margin-bottom: 0 !important;">
                                <div class="col s6">
                                    <img class="card card-content" style="padding: 10px !important;" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='20' fill='%23fff'%3EQR Code%3C/text%3E%3C/svg%3E" width="180"/>
                                </div>
                                <div class="col s6 white-text" style="border-left: solid 1px #222 !important; heigth: 500px; margin-top: 2.8% !important;">
                                    <h3>Network</h3>
                                    <h5 style="font-weight: 100 !important;">${ipAddress}</h5>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="card-panel transparent z-depth-0 white-text" style="position: fixed; bottom: 0; text-align: center; width: 100%; padding: 0;">
            <div>
                <a href='https://play.google.com/store/apps/details?id=app.ytmdesktop.remote&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1' target="_blank">
                    <img width="200" alt='Get it on Google Play' src='https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png'/>
                </a>
            </div>
            <a class="orange-text btn-flat tooltipped" data-position="top" data-tooltip="Not protected with password">
                <i class="material-icons tiny">lock_open</i>
            </a>
            ${hostname}
            <a class="white-text btn-flat tooltipped" data-position="top" data-tooltip="Devices Connected">
                <i class="material-icons left">devices_other</i>
                0
            </a>
        </div>
    </body>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var elems = document.querySelectorAll('.tooltipped');
            M.Tooltip.init(elems, {});
        });
    </script>
</html>`;

      reply.type("text/html").send(html);
    });

    this.fastifyServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: ["v1"]
      });
    });

    // Query endpoint for v1.13.0 compatibility (6K Labs widgets)
    this.fastifyServer.get("/query", (request, reply) => {
      const playerState = this.memoryStore.get("ytm") as
        | {
            player?: {
              videoDetails?: {
                title?: string;
                author?: string;
                durationSeconds?: number;
                thumbnails?: Array<{ url: string; width?: number; height?: number }>;
                videoId?: string;
              };
              videoProgress?: number;
              trackState?: number;
              likeStatus?: string;
              volume?: number;
            };
          }
        | undefined;

      const track = playerState?.player;

      if (!track || !track.videoDetails) {
        reply.send({
          track: {
            author: "",
            title: "",
            album: "",
            cover: "",
            duration: 0,
            url: "",
            id: "",
            isVideo: false,
            isAdvertisement: false,
            inLibrary: false
          },
          player: {
            hasSong: false,
            isPaused: true,
            volumePercent: 100,
            seekbarCurrentPosition: 0,
            seekbarCurrentPositionHuman: "0:00",
            statePercent: 0,
            adPlaying: false,
            likeStatus: "INDIFFERENT",
            repeatType: null
          }
        });
        return;
      }

      // Find the best thumbnail (largest)
      // Note: thumbnails is stored as an array directly on videoDetails, not nested under thumbnail
      const thumbnails = track.videoDetails.thumbnails || [];
      const bestThumbnail =
        thumbnails.length > 0
          ? thumbnails.reduce((best: { url: string; width?: number; height?: number }, next: { url: string; width?: number; height?: number }) => {
              const bestArea = (best.width ?? 0) * (best.height ?? 0);
              const nextArea = (next.width ?? 0) * (next.height ?? 0);
              return nextArea > bestArea ? next : best;
            }).url
          : "";

      // Calculate progress values matching v1.13.0 format
      const durationSeconds = track.videoDetails.durationSeconds || 0;
      const videoProgressSeconds = track.videoProgress ?? 0; // Progress in seconds from player

      // Calculate progress as decimal (0-1) by dividing current time by duration
      const progressDecimal = durationSeconds > 0 ? videoProgressSeconds / durationSeconds : 0;
      // Cap progress at 100% (1.0) to prevent overflow
      const cappedProgress = Math.min(progressDecimal, 1.0);

      const seekbarCurrentPosition = Math.floor(videoProgressSeconds); // Progress in seconds (use raw value)
      const statePercent = cappedProgress * 100; // Convert to percentage (0-100)

      // Format time as MM:SS or H:MM:SS
      const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
      };

      reply.send({
        player: {
          hasSong: true,
          isPaused: track.trackState !== 1, // trackState: 1 = playing, 2 = paused
          volumePercent: track.volume || 100,
          seekbarCurrentPosition: seekbarCurrentPosition,
          seekbarCurrentPositionHuman: formatTime(seekbarCurrentPosition),
          statePercent: statePercent,
          likeStatus: track.likeStatus || "INDIFFERENT",
          repeatType: null
        },
        track: {
          author: track.videoDetails.author || "",
          title: track.videoDetails.title || "",
          album: "",
          cover: bestThumbnail,
          duration: durationSeconds,
          durationHuman: formatTime(durationSeconds),
          url: `https://music.youtube.com/watch?v=${track.videoDetails.videoId || ""}`,
          id: track.videoDetails.videoId || "",
          isVideo: false,
          isAdvertisement: false,
          inLibrary: false
        }
      });
    });

    // OBS/browser-source friendly overlay (local remake UI powered by /query)
    this.fastifyServer.get("/overlay/vinyl", async (_request, reply) => {
      try {
        const htmlPath = app.isPackaged
          ? path.join(__dirname, "..", "plugins", "builtin", "vinyl-player", "vinyl-remake.html")
          : path.join(process.cwd(), "src/main/integrations/plugins/builtin/vinyl-player/vinyl-remake.html");
        const html = await fs.readFile(htmlPath, { encoding: "utf-8" });
        reply.header("Cache-Control", "no-store");
        reply.type("text/html").send(html);
      } catch (error) {
        log.error("Failed to serve vinyl overlay page:", error);
        reply.type("text/plain").send("Failed to load overlay page.");
      }
    });

    // Setup compatibility namespaces for third-party widgets (e.g., 6K Labs)
    this.fastifyServer.ready().then(() => {
      this.setupCompatibilityNamespaces();
    });
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: BrowserView): void {
    this.store = store;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  public async enable() {
    if (this.isEnabled) {
      return;
    }

    this.isEnabled = true;

    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Safe Storage not available for Companion Server Integration, using insecure storage instead");
      this.memoryStore.set("companionServerUsingInsecureStorage", true);
    } else {
      this.memoryStore.set("companionServerUsingInsecureStorage", false);
    }

    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      try {
        this.createServer();
        await this.fastifyServer.listen({
          host: this.listenIp,
          port: this.listenPort
        });

        // Register store listener using our base class helper for automatic cleanup
        this.registerStoreListener();

        log.info(`Companion server listening on ${this.listenIp}:${this.listenPort}`);
      } catch (error) {
        log.error("Failed to start companion server:", error);
        this.isEnabled = false;
      }
    }
  }

  private registerStoreListener() {
    this.storeListener = this.store.onDidChange("integrations", async newState => {
      try {
        let validTokenIds: string[] = [];

        if (newState.companionServerAuthTokens) {
          try {
            if (this.memoryStore.get("safeStorageAvailable")) {
              validTokenIds = JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map(
                (authToken: AuthToken) => authToken.id
              );
            } else {
              // Use the tokens directly without decryption
              validTokenIds = JSON.parse(newState.companionServerAuthTokens).map((authToken: AuthToken) => authToken.id);
            }
          } catch (error) {
            log.error(`Failed to parse companion server auth tokens: ${error.message || "Unknown error"}`);
          }
        }

        if (this.fastifyServer?.server.listening) {
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
      } catch (error) {
        log.error("Error in store listener:", error);
      }
    });
  }

  public override async disable() {
    if (!this.isEnabled) {
      return;
    }

    if (this.fastifyServer) {
      try {
        await this.fastifyServer.close();
        log.info("Companion server stopped");
      } catch (error) {
        log.error("Error closing companion server:", error);
      }
    }

    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }

    // Call the base class implementation to handle common cleanup
    super.disable();
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  /**
   * Compatibility Namespaces
   * Adds minimal Socket.IO endpoints expected by some external widgets.
   * We implement a simple joinRoom protocol and broadcast player updates.
   */
  private setupCompatibilityNamespaces(): void {
    try {
      const io = this.fastifyServer.io;

      // Generic helper to attach a namespace with joinRoom handling
      const attachNamespace = (ns: string) => {
        const nsp = io.of(ns);
        nsp.on("connection", socket => {
          // Simple room join based on provided room/token id
          socket.on("joinRoom", (roomId: string) => {
            try {
              socket.data.tokenId = roomId;
              socket.join(roomId);
              // Immediately push a settings update event if listeners expect it
              // (Observed from 6K Labs widget code: "update user widget settings in database")
              nsp.to(roomId).emit("update user widget settings in database", { joined: true, namespace: ns });
            } catch {
              // ignore malformatted join
            }
          });
        });
      };

      // Observed path in bundled assets for Spotify was '/spotify/socket.io';
      // We mirror both youtube and spotify namespaces for compatibility.
      attachNamespace("/youtube");
      attachNamespace("/spotify");

      // Forward lightweight player state as a generic event many widgets can consume
      // We avoid heavy/spam by throttling via memoryStore (optional future improvement)
      try {
        const forwardUpdate = (state: unknown) => {
          const s = state as
            | {
                videoDetails?: { title?: string; author?: string; durationSeconds?: number; thumbnails?: Array<{ url?: string }> };
                videoProgress?: number;
                trackState?: number;
              }
            | undefined;
          if (!s || !s.videoDetails) return;
          const payload: { title?: string; artist?: string; duration: number; progress: number; cover_url: string | null; is_playing: boolean } = {
            title: s.videoDetails?.title,
            artist: s.videoDetails?.author,
            duration: s.videoDetails?.durationSeconds ?? 0,
            progress: s.videoProgress ?? 0,
            cover_url:
              Array.isArray(s.videoDetails?.thumbnails) && (s.videoDetails?.thumbnails?.length ?? 0) > 0
                ? (s.videoDetails!.thumbnails![s.videoDetails!.thumbnails!.length - 1]!.url ?? null)
                : null,
            is_playing: s.trackState === 1 // VideoState.Playing
          };
          this.fastifyServer.io.of("/youtube").emit("player:update", payload);
        };
        // Defer dynamic import to avoid cyclic deps
        import("../../player-state-store/index.js")
          .then(mod => {
            const store = mod as unknown as {
              default?: { addEventListener?: (cb: (s: unknown) => void) => void };
              addEventListener?: (cb: (s: unknown) => void) => void;
            };
            const api = (store && (store.default ?? store)) as { addEventListener?: (cb: (s: unknown) => void) => void };
            if (api && typeof api.addEventListener === "function") {
              api.addEventListener(forwardUpdate);
            }
          })
          .catch((): void => {
            /* noop */
          });
      } catch {
        // best-effort only
      }
    } catch {
      // Ignore setup failures; server remains functional without compatibility layer
    }
  }
}
