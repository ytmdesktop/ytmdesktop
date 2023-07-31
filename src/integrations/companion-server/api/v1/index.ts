import { BrowserView, BrowserWindow, ipcMain, safeStorage } from "electron";
import ElectronStore from "electron-store";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { StoreSchema } from "../../../../shared/store/schema";
import playerStateStore from "../../../../player-state-store";
import { createAuthToken, getIsTemporaryAuthCodeValidAndRemove, getTemporaryAuthCode, isAuthValid, isAuthValidMiddleware } from "../../shared/auth";
import fastifyRateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import createError from "@fastify/error";

declare const AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY: string;
declare const AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const mapThumbnails = (thumbnail: any) => {
  // Explicit mapping to keep a consistent API
  // If YouTube Music changes how this is presented internally then it's easier to update without breaking the API
  return {
    url: thumbnail.url,
    width: thumbnail.width,
    height: thumbnail.height
  };
};

function getYTMTextRun(runs: any[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

const mapQueueItems = (item: any) => {
  let playlistPanelVideoRenderer;
  if (item.playlistPanelVideoRenderer) playlistPanelVideoRenderer = item.playlistPanelVideoRenderer;
  else if (item.playlistPanelVideoWrapperRenderer)
    playlistPanelVideoRenderer = item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;

  // This probably shouldn't happen but in the off chance it does we need to return nothing
  if (!playlistPanelVideoRenderer) return null;

  return {
    thubmnails: playlistPanelVideoRenderer.thumbnail.thumbnails.map(mapThumbnails),
    title: getYTMTextRun(playlistPanelVideoRenderer.title.runs),
    author: getYTMTextRun(playlistPanelVideoRenderer.shortBylineText.runs),
    duration: getYTMTextRun(playlistPanelVideoRenderer.lengthText.runs),
    selected: playlistPanelVideoRenderer.selected
  };
};

const transformPlayerState = (state: any) => {
  const queueItems = state.queue ? state.queue.items.map(mapQueueItems) : null;
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
      queue: state.queue
        ? {
            autoplay: state.queue.autoplay,
            shuffleEnabled: state.queue.shuffleEnabled,
            items: queueItems,
            // automixItems comes from an autoplay queue that isn't pushed yet to the main queue. A radio will never have automixItems (weird YTM distinction from autoplay vs radio)
            automixItems: state.queue.automixItems.map(mapQueueItems),
            isGenerating: state.queue.isGenerating,
            // Observed state seems to be a radio having infinite true while an autoplay queue has infinite false
            isInfinite: state.queue.isInfinite,
            repeatMode: state.queue.repeatMode,
            // YTM has a native selectedItemIndex property but that isn't updated correctly so we calculate it ourselves
            selectedItemIndex: queueItems.findIndex((item: any) => {
              return item.selected
            })
          }
        : null
    },
    video: state.videoDetails
      ? {
          author: state.videoDetails.author,
          title: state.videoDetails.title,
          album: state.videoDetails.album,
          thumbnails: state.videoDetails.thumbnail.thumbnails.map(mapThumbnails),
          duration: parseInt(state.videoDetails.lengthSeconds),
          id: state.videoDetails.videoId
        }
      : null
  };
};

interface CompanionServerAPIv1Options extends FastifyPluginOptions {
  //remoteCommandEmitter: (command: string, ...args: any[]) => void;
  getStore: () => ElectronStore<StoreSchema>;
  getYtmView: () => BrowserView;
}

const InvalidCommandError = createError("INVALID_COMMAND", "Command '%s' is invalid", 400);
const InvalidRepeatModeError = createError("INVALID_REPEAT_MODE", "Repeat mode '%s' is invalid", 400);

type RemoteCommand = "playPause" | "play" | "pause" | "volumeUp" | "volumeDown" | "setVolume" | "mute" | "unmute" | "next" | "previous" | "repeatMode";

const CompanionServerAPIv1: FastifyPluginCallback<CompanionServerAPIv1Options> = async (fastify, options, next) => {
  const sendCommand = (command: RemoteCommand, value: any) => {
    const ytmView = options.getYtmView();
    if (ytmView) {
      switch (command) {
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
          const valueInt: number = parseInt(value);
          // Check if Volume is a number and between 0 and 100
          if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
            throw new Error("Invalid volume");
          }

          ytmView.webContents.send("remoteControl:execute", "setVolume", valueInt);
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

        case "next": {
          ytmView.webContents.send("remoteControl:execute", "next");
          break;
        }

        case "previous": {
          ytmView.webContents.send("remoteControl:execute", "previous");
          break;
        }

        case "repeatMode": {
          switch (value) {
            case "NONE": {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "NONE");
              break;
            }
            case "ALL": {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ALL");
              break;
            }
            case "ONE": {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ONE");
              break;
            }
            default: {
              throw new InvalidRepeatModeError(value);
            }
          }
          break;
        }

        default: {
          throw new InvalidCommandError(command);
        }
      }
    }
  }

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: 1000 * 60
  });

  fastify.post<{ Body: { appName: string } }>("/auth/requestcode", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 1000 * 60
      }
    }
  }, async (request, response) => {
    const code = await getTemporaryAuthCode(request.body.appName);
    if (code) {
      response.send({
        code
      });
    } else {
      response.code(504).send({
        error: "AUTHORIZATION_TIMEOUT"
      });
    }
  });

  fastify.post<{ Body: { appName: string; code: string } }>("/auth/request", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 1000 * 60
      }
    }
  }, async (request, response) => {
    let companionServerAuthWindowEnabled = false;
    try {
      companionServerAuthWindowEnabled =
        safeStorage.decryptString(Buffer.from(options.getStore().get("integrations").companionServerAuthWindowEnabled, "hex")) === "true" ? true : false;
    } catch {
      /* do nothing, value is false */
    }

    if (!companionServerAuthWindowEnabled) {
      response.code(403).send({
        error: "AUTHORIZATION_DISABLED"
      });
      return;
    }

    if (!getIsTemporaryAuthCodeValidAndRemove(request.body.appName, request.body.code)) {
      response.code(400).send({
        error: "AUTHORIZATION_INVALID"
      });
      return;
    }

    ipcMain.handle("companionAuthorization:getAppName", () => {
      return request.body.appName;
    });

    ipcMain.handle("companionAuthorization:getCode", () => {
      return request.body.code;
    });

    // Create the authorization browser window.
    const authorizationWindow = new BrowserWindow({
      width: 640,
      height: 480,
      minimizable: false,
      maximizable: false,
      resizable: false,
      frame: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY
      }
    });
    authorizationWindow.loadURL(AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY);
    authorizationWindow.show();

    // Open the DevTools.
    if (process.env.NODE_ENV === "development") {
      authorizationWindow.webContents.openDevTools({
        mode: "detach"
      });
    }

    let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
    let promiseInterval: string | number | NodeJS.Timeout;

    function resultListener(_event: Electron.IpcMainEvent, authorized: boolean) {
      clearInterval(promiseInterval);
      promiseResolve(authorized);
    }

    function closeListener() {
      clearInterval(promiseInterval);
      promiseResolve(false);
    }

    const startTime = Date.now();
    const authorized = await new Promise<boolean>(resolve => {
      promiseResolve = resolve;
      promiseInterval = setInterval(() => {
        if (request.connection.destroyed) {
          clearInterval(promiseInterval);
          resolve(false);
        }

        if (Date.now() - startTime > 30 * 1000) {
          clearInterval(promiseInterval);
          resolve(false);
        }
      }, 250);

      ipcMain.once("companionAuthorization:result", resultListener);
      ipcMain.once("companionWindow:close", closeListener);
    });

    authorizationWindow.close();
    ipcMain.removeHandler("companionAuthorization:getAppName");
    ipcMain.removeHandler("companionAuthorization:getCode");
    ipcMain.removeListener("companionAuthorization:result", resultListener);
    ipcMain.removeListener("companionWindow:close", closeListener);

    if (authorized) {
      const token = createAuthToken(options.getStore(), request.body.appName);

      response.send({
        token
      });
      options.getStore().set("integrations.companionServerAuthWindowEnabled", await safeStorage.encryptString("false"));
    } else {
      response.code(403).send({
        error: "AUTHORIZATION_DENIED"
      });
    }
  });

  fastify.get(
    "/playlists",
    {
      config: {
        // This endpoint sends a real API request to YTM which allows to fetch playlists.
        // API users: Please cache playlists, they are unlikely to change often. A websocket event will be emitted if a playlist is created or deleted
        rateLimit: {
          hook: 'preHandler',
          max: 1,
          timeWindow: 1000 * 30,
          keyGenerator: (request) => {
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

        const playlistsResponseListener = (_event: Electron.IpcMainEvent, playlists: any) => {
          response.send(playlists);
        }
        ipcMain.once(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);

        setTimeout(() => {
          ipcMain.removeListener(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);
          response.code(504).send({
            error: 'YTM_RESULT_TIMEOUT'
          });
        }, 1000 * 5);

        ytmView.webContents.send(`ytmView:getPlaylists`, requestId);
        //response.send(transformPlayerState(playerStateStore.getState()));
      } else {
        response.code(503).send({
          error: 'YTM_UNAVAILABLE'
        });
      }
    }
  );

  fastify.get(
    "/state",
    {
      config: {
        // API users: Please utilize the realtime websocket to get the state. Request this endpoint as necessary, such as initial state fetching.
        rateLimit: {
          hook: 'preHandler',
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: (request) => {
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

  fastify.post<{ Body: { command: RemoteCommand, data: any } }>(
    "/command",
    {
      config: {
        rateLimit: {
          hook: 'preHandler',
          max: 2,
          timeWindow: 1000 * 1,
          keyGenerator: (request) => {
            return request.authId || request.ip;
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      sendCommand(request.body.command, request.body.data);
      response.code(204).send();
    }
  );

  fastify.ready().then(() => {
    fastify.io.of("/api/v1/realtime").use((socket, next) => {
      const token = socket.handshake.auth.token;
      const validSession = isAuthValid(options.getStore(), token);
      if (validSession) next();
      else next(new Error("UNAUTHORIZED"));
    });
    // Will look into enabling sending commands/requests over the websocket at a later point in time
    /*fastify.io.of("/api/v1/realtime").on("connection", socket => {
      socket.on("command", (command: RemoteCommand) => {
        sendCommand(command);
      });
    });*/

    const stateStoreListener = (state: any) => {
      fastify.io.of("/api/v1/realtime").emit("state-update", transformPlayerState(state));
    };
    playerStateStore.addEventListener(stateStoreListener);

    const createPlaylistObservedListener = (_event: Electron.IpcMainEvent, playlist: any) => {
      console.log("Create playlist observed", playlist);
      fastify.io.of("/api/v1/realtime").emit("playlist-created", playlist);
    };
    ipcMain.on('ytmView:createPlaylistObserved', createPlaylistObservedListener);
    
    const deletePlaylistObservedListener = (_event: Electron.IpcMainEvent, playlistId: string) => {
      console.log("Delete playlist observed", playlistId);
      fastify.io.of("/api/v1/realtime").emit("playlist-deleted", playlistId);
    };
    ipcMain.on('ytmView:deletePlaylistObserved', deletePlaylistObservedListener);

    fastify.addHook('onClose', () => {
      // This should normally close on its own but we'll make sure it's closed out
      fastify.io.close();
      playerStateStore.removeEventListener(stateStoreListener);
      ipcMain.off('ytmView:createPlaylistObserved', createPlaylistObservedListener);
      ipcMain.off('ytmView:deletePlaylistObserved', deletePlaylistObservedListener);
    });
  });

  next();
};

export default CompanionServerAPIv1;
