import { BrowserView, BrowserWindow, ipcMain } from "electron";
import ElectronStore from "electron-store";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { StoreSchema } from "../../../../shared/store/schema";
import playerStateStore, { PlayerState, RepeatMode } from "../../../../player-state-store";
import { createAuthToken, getIsTemporaryAuthCodeValidAndRemove, getTemporaryAuthCode, isAuthValid, isAuthValidMiddleware } from "../../shared/auth";
import fastifyRateLimit from "@fastify/rate-limit";
import crypto from "crypto";
import createError from "@fastify/error";
import {
  APIV1CommandRequestBody,
  APIV1CommandRequestBodyType,
  APIV1RequestCodeBody,
  APIV1RequestCodeBodyType,
  APIV1RequestTokenBody,
  APIV1RequestTokenBodyType
} from "../../shared/schemas";

declare const AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY: string;
declare const AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const transformPlayerState = (state: PlayerState) => {
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
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
  getStore: () => ElectronStore<StoreSchema>;
  getYtmView: () => BrowserView;
}

//const InvalidCommandError = createError("INVALID_COMMAND", "Command '%s' is invalid", 400);
const InvalidVolumeError = createError("INVALID_VOLUME", "Volume '%s' is invalid", 400);
const InvalidRepeatModeError = createError("INVALID_REPEAT_MODE", "Repeat mode '%s' cannot be set", 400);
const InvalidPositionError = createError("INVALID_SEEK_POSITION", "Seek position '%s' is invalid", 400);
const UnauthenticatedError = createError("UNAUTHENTICATED", "Authentication not provided or invalid", 401);
const AuthorizationDisabled = createError("AUTHORIZATION_DISABLED", "Authorization requests are disabled", 403);
const AuthorizationInvalid = createError("AUTHORIZATION_INVALID", "Authorization invalid", 400);
const AuthorizationTimeOut = createError("AUTHORIZATION_TIME_OUT", "Authorization timed out", 504);
const AuthorizationDenied = createError("AUTHORIZATION_DENIED", "Authorization request denied", 403);
const AuthorizationTooMany = createError("AUTHORIZATION_TOO_MANY", "Too many authorization requests currently active", 503);
const YouTubeMusicUnavailable = createError("YOUTUBE_MUSIC_UNVAILABLE", "YouTube Music is currently unvailable", 503);
const YouTubeMusicTimeOut = createError("YOUTUBE_MUSIC_TIME_OUT", "Response from YouTube Music took too long", 504);

//type RemoteCommand = "playPause" | "play" | "pause" | "volumeUp" | "volumeDown" | "setVolume" | "mute" | "unmute" | "next" | "previous" | "repeatMode";

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
        throw new AuthorizationDisabled();
      }

      const code = await getTemporaryAuthCode(request.body.appId, request.body.appVersion, request.body.appName);
      if (code) {
        response.send({
          code
        });
      } else {
        throw new AuthorizationTimeOut();
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
        throw new AuthorizationTooMany();
      }

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabled();
      }

      // API Users: Make sure you /requestcode above
      const authData = getIsTemporaryAuthCodeValidAndRemove(request.body.appId, request.body.code);
      if (!authData) {
        throw new AuthorizationInvalid();
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
        if (process.env.NODE_ENV === "development") 
          if (event.url.startsWith("http://localhost")) 
            return;

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

        const resultListener = (_event: Electron.IpcMainEvent, authorized: boolean) => {
          clearInterval(promiseInterval);
          promiseResolve(authorized);
        };

        const closeListener = () => {
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
          authorizationWindow.once("closed", () => {authorizationWindowClosed = true; closeListener()});
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
          throw new AuthorizationDenied();
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
    (request, response) => {
      const ytmView = options.getYtmView();
      if (ytmView) {
        const requestId = crypto.randomUUID();

        const playlistsResponseListener = (_event: Electron.IpcMainEvent, playlists: Playlist[]) => {
          response.send(playlists);
        };
        ipcMain.once(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);

        setTimeout(() => {
          ipcMain.removeListener(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);
          throw new YouTubeMusicTimeOut();
        }, 1000 * 5);

        ytmView.webContents.send(`ytmView:getPlaylists`, requestId);
        //response.send(transformPlayerState(playerStateStore.getState()));
      } else {
        throw new YouTubeMusicUnavailable();
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

    const createPlaylistObservedListener = (_event: Electron.IpcMainEvent, playlist: Playlist) => {
      fastify.io.of("/api/v1/realtime").emit("playlist-created", playlist);
    };
    ipcMain.on("ytmView:createPlaylistObserved", createPlaylistObservedListener);

    const deletePlaylistObservedListener = (_event: Electron.IpcMainEvent, playlistId: string) => {
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
