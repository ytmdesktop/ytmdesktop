import { BrowserView, BrowserWindow, ipcMain } from "electron";
import Conf from "conf";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { StoreSchema } from "~shared/store/schema";
import playerStateStore, { PlayerState, RepeatMode } from "../../../../player-state-store";
import { createAuthToken, getIsTemporaryAuthCodeValidAndRemove, getTemporaryAuthCode, isAuthValid, isAuthValidMiddleware } from "../../api-shared/auth";
import fastifyRateLimit from "@fastify/rate-limit";
import crypto from "crypto";
import {
  APIV1CommandRequestBody,
  APIV1CommandRequestBodyType,
  APIV1RequestCodeBody,
  APIV1RequestCodeBodyType,
  APIV1RequestTokenBody,
  APIV1RequestTokenBodyType
} from "../../api-shared/schemas";
import {
  AuthorizationDeniedError,
  AuthorizationDisabledError,
  AuthorizationInvalidError,
  AuthorizationTimeOutError,
  AuthorizationTooManyError,
  InvalidPositionError,
  InvalidQueueIndexError,
  InvalidRepeatModeError,
  InvalidVolumeError,
  UnauthenticatedError,
  YouTubeMusicTimeOutError,
  YouTubeMusicUnavailableError
} from "../../api-shared/errors";

declare const AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY: string;
declare const AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const transformPlayerState = (state: PlayerState) => {
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
      volume: state.volume,
      muted: state.muted,
      adPlaying: state.adPlaying,
      queue: state.queue
        ? {
            autoplay: state.queue.autoplay,
            items: state.queue.items,
            automixItems: state.queue.automixItems,
            isGenerating: state.queue.isGenerating,
            isInfinite: state.queue.isInfinite,
            repeatMode: state.queue.repeatMode,
            selectedItemIndex: state.queue.selectedItemIndex
          }
        : null
    },
    video: state.videoDetails
      ? {
          author: state.videoDetails.author,
          channelId: state.videoDetails.channelId,
          title: state.videoDetails.title,
          album: state.videoDetails.album,
          albumId: state.videoDetails.albumId,
          likeStatus: state.videoDetails.likeStatus,
          thumbnails: state.videoDetails.thumbnails,
          durationSeconds: state.videoDetails.durationSeconds,
          id: state.videoDetails.id
        }
      : null,
    // API Users:
    // WARNING! WARNING! WARNING! WARNING!
    // playlistId may not be what you expect it to be.
    // - If the song playing comes from a randomly generated radio queue then this will be the id of that random queue (YTM does not persist these, pretend these IDs don't exist on the YTM backend)
    // - If you add an album/playlist to queue once those songs start playing then playlistId will be the id of that album/playlist
    // - Play Next for individual songs have a null playlistId when reached in a queue. Does not apply for Play Next to an entire album/playlist.
    // In summary, this property doesn't reliably tell you this video belongs to the specified playlistId. Do not treat it as such. Use it as a state if something may be playing from a known playlistId
    playlistId: state.playlistId
  };
};

interface CompanionServerAPIv1Options extends FastifyPluginOptions {
  getStore: () => Conf<StoreSchema>;
  getYtmView: () => BrowserView;
}

type Playlist = {
  id: string;
  title: string;
};

const authorizationWindows: BrowserWindow[] = [];

const CompanionServerAPIv1: FastifyPluginCallback<CompanionServerAPIv1Options> = async (fastify, options, next) => {
  const sendCommand = (commandRequest: APIV1CommandRequestBodyType) => {
    const ytmView = options.getYtmView();
    if (ytmView) {
      switch (commandRequest.command) {
        case "playPause": {
          ytmView.webContents.send("remoteControl:execute", "playPause");
          break;
        }

        case "play": {
          ytmView.webContents.send("remoteControl:execute", "play");
          break;
        }

        case "pause": {
          ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        }

        case "volumeUp": {
          ytmView.webContents.send("remoteControl:execute", "volumeUp");
          break;
        }

        case "volumeDown": {
          ytmView.webContents.send("remoteControl:execute", "volumeDown");
          break;
        }

        case "setVolume": {
          const volume = commandRequest.data;
          // Check if Volume is a number and between 0 and 100
          if (isNaN(volume) || volume < 0 || volume > 100) {
            throw new InvalidVolumeError(volume);
          }

          ytmView.webContents.send("remoteControl:execute", "setVolume", volume);
          break;
        }

        case "mute": {
          ytmView.webContents.send("remoteControl:execute", "mute");
          break;
        }

        case "unmute": {
          ytmView.webContents.send("remoteControl:execute", "unmute");
          break;
        }

        case "seekTo": {
          const position = commandRequest.data;
          if (isNaN(position) || position < 0 || position > playerStateStore.getState().videoDetails.durationSeconds) {
            throw new InvalidPositionError(position);
          }
          ytmView.webContents.send("remoteControl:execute", "seekTo", position);
          break;
        }

        case "next": {
          ytmView.webContents.send("remoteControl:execute", "next");
          break;
        }

        case "previous": {
          ytmView.webContents.send("remoteControl:execute", "previous");
          break;
        }

        case "repeatMode": {
          const repeatMode = commandRequest.data;
          switch (repeatMode) {
            case RepeatMode.None: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "NONE");
              break;
            }
            case RepeatMode.All: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ALL");
              break;
            }
            case RepeatMode.One: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ONE");
              break;
            }
            default: {
              throw new InvalidRepeatModeError(repeatMode);
            }
          }
          break;
        }

        case "shuffle": {
          ytmView.webContents.send("remoteControl:execute", "shuffle");
          break;
        }

        case "playQueueIndex": {
          const index = commandRequest.data;
          const state = playerStateStore.getState();

          if (isNaN(index) || index > state.queue.items.length + state.queue.automixItems.length - 1) {
            throw new InvalidQueueIndexError(index);
          }

          ytmView.webContents.send("remoteControl:execute", "playQueueIndex", index);
          break;
        }

        case "toggleLike": {
          ytmView.webContents.send("remoteControl:execute", "toggleLike");
          break;
        }

        case "toggleDislike": {
          ytmView.webContents.send("remoteControl:execute", "toggleDislike");
          break;
        }
      }
    }
  };

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: 1000 * 60
  });

  fastify.post<{ Body: APIV1RequestCodeBodyType }>(
    "/auth/requestcode",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestCodeBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      const code = await getTemporaryAuthCode(request.body.appId, request.body.appVersion, request.body.appName);
      if (code) {
        response.send({
          code
        });
      } else {
        throw new AuthorizationTimeOutError();
      }
    }
  );

  fastify.post<{ Body: APIV1RequestTokenBodyType }>(
    "/auth/request",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestTokenBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // There's too many authorization windows open and we have to reject this request for now (this is unlikely to occur but this prevents malicious use of spamming auth windows)
      // API Users: Show a friendly feedback that too many applications are trying to authorize at the same time
      if (authorizationWindows.length >= 5) {
        throw new AuthorizationTooManyError();
      }

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      // API Users: Make sure you /requestcode above
      const authData = getIsTemporaryAuthCodeValidAndRemove(request.body.appId, request.body.code);
      if (!authData) {
        throw new AuthorizationInvalidError();
      }

      const requestId = crypto.randomUUID();

      let authorizationWindowClosed = false;

      // Create the authorization browser window.
      const authorizationWindow = new BrowserWindow({
        width: 640,
        height: 480,
        minimizable: false,
        maximizable: false,
        resizable: false,
        frame: false,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#000000",
          symbolColor: "#BBBBBB",
          height: 36
        },
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY,
          additionalArguments: [requestId, authData.appName, request.body.code]
        }
      });
      authorizationWindow.loadURL(AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY);
      authorizationWindow.show();
      authorizationWindow.flashFrame(true);

      authorizationWindow.webContents.setWindowOpenHandler(() => {
        return {
          action: "deny"
        };
      });

      authorizationWindow.webContents.on("will-navigate", event => {
        if (process.env.NODE_ENV === "development") if (event.url.startsWith("http://localhost")) return;

        event.preventDefault();
      });

      authorizationWindows.push(authorizationWindow);

      try {
        // Open the DevTools.
        if (process.env.NODE_ENV === "development") {
          authorizationWindow.webContents.openDevTools({
            mode: "detach"
          });
        }

        let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
        let promiseInterval: string | number | NodeJS.Timeout;

        const resultListener = (event: Electron.IpcMainEvent, authorized: boolean) => {
          if (event.sender !== authorizationWindow.webContents) return;

          clearInterval(promiseInterval);
          promiseResolve(authorized);
        };

        const closeListener = (event: Electron.IpcMainEvent) => {
          if (event && event.sender !== authorizationWindow.webContents) return;

          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const startTime = Date.now();
        const authorized = await new Promise<boolean>(resolve => {
          promiseResolve = resolve;
          promiseInterval = setInterval(() => {
            if (request.socket.destroyed) {
              clearInterval(promiseInterval);
              resolve(false);
            }

            if (Date.now() - startTime > 30 * 1000) {
              clearInterval(promiseInterval);
              resolve(false);
            }
          }, 250);

          ipcMain.once(`companionAuthorization:result:${requestId}`, resultListener);
          ipcMain.once(`companionWindow:close:${requestId}`, closeListener);
          authorizationWindow.once("closed", () => {
            authorizationWindowClosed = true;
            closeListener(null);
          });
        });

        if (!authorizationWindowClosed) {
          authorizationWindow.removeListener("closed", closeListener);
          authorizationWindow.close();
        }
        ipcMain.removeListener(`companionAuthorization:result:${requestId}`, resultListener);
        ipcMain.removeListener(`companionWindow:close:${requestId}`, closeListener);

        if (authorized) {
          const token = createAuthToken(options.getStore(), authData.appId, authData.appVersion, authData.appName);

          response.send({
            token
          });
          options.getMemoryStore().set("companionServerAuthWindowEnabled", false);
        } else {
          throw new AuthorizationDeniedError();
        }
      } finally {
        const index = authorizationWindows.indexOf(authorizationWindow);
        if (index > -1) {
          authorizationWindows.splice(index, 1);
        }
      }
    }
  );

  fastify.get(
    "/playlists",
    {
      config: {
        // This endpoint sends a real API request to YTM which allows to fetch playlists.
        // API users: Please cache playlists, they are unlikely to change often. A websocket event will be emitted if a playlist is created or deleted
        rateLimit: {
          hook: "preHandler",
          max: 1,
          timeWindow: 1000 * 30,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    async (request, response) => {
      const ytmView = options.getYtmView();
      if (ytmView) {
        const requestId = crypto.randomUUID();

        const playlistsResponseListener = (event: Electron.IpcMainEvent, playlists: Playlist[]) => {
          if (event.sender !== ytmView.webContents) return;
          response.send(playlists);
        };
        ipcMain.once(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);

        ytmView.webContents.send(`ytmView:getPlaylists`, requestId);

        await new Promise((_resolve, reject) =>
          setTimeout(() => {
            ipcMain.removeListener(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);
            reject(new YouTubeMusicTimeOutError());
          }, 1000 * 30)
        );
      } else {
        throw new YouTubeMusicUnavailableError();
      }
    }
  );

  fastify.get(
    "/state",
    {
      config: {
        // API users: Please utilize the realtime websocket to get the state. Request this endpoint as necessary, such as initial state fetching.
        rateLimit: {
          hook: "preHandler",
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      response.send(transformPlayerState(playerStateStore.getState()));
    }
  );

  fastify.post<{ Body: APIV1CommandRequestBodyType }>(
    "/command",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 2,
          timeWindow: 1000 * 1,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      schema: {
        body: APIV1CommandRequestBody
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      sendCommand(request.body);
      response.code(204).send();
    }
  );

  fastify.ready().then(() => {
    fastify.io.of("/api/v1/realtime").use((socket, next) => {
      const token = socket.handshake.auth.token;
      const [validSession, tokenId] = isAuthValid(options.getStore(), token);
      if (validSession) {
        socket.data.tokenId = tokenId;
        next();
      } else {
        next(new UnauthenticatedError());
      }
    });
    // Will look into enabling sending commands/requests over the websocket at a later point in time
    /*fastify.io.of("/api/v1/realtime").on("connection", socket => {
      socket.on("command", (command: RemoteCommand) => {
        sendCommand(command);
      });
    });*/

    const stateStoreListener = (state: PlayerState) => {
      fastify.io.of("/api/v1/realtime").emit("state-update", transformPlayerState(state));
    };
    playerStateStore.addEventListener(stateStoreListener);

    const createPlaylistObservedListener = (event: Electron.IpcMainEvent, playlist: Playlist) => {
      const ytmView = options.getYtmView();
      if (event.sender !== ytmView.webContents) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-created", playlist);
    };
    ipcMain.on("ytmView:createPlaylistObserved", createPlaylistObservedListener);

    const deletePlaylistObservedListener = (event: Electron.IpcMainEvent, playlistId: string) => {
      const ytmView = options.getYtmView();
      if (event.sender !== ytmView.webContents) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-deleted", playlistId);
    };
    ipcMain.on("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);

    fastify.addHook("onClose", () => {
      // This should normally close on its own but we'll make sure it's closed out
      fastify.io.close();
      playerStateStore.removeEventListener(stateStoreListener);
      ipcMain.off("ytmView:createPlaylistObserved", createPlaylistObservedListener);
      ipcMain.off("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);
    });
  });

  next();
};

export default CompanionServerAPIv1;
