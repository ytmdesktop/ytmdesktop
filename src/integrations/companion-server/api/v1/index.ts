import crypto from 'crypto';
import { BrowserWindow, ipcMain, safeStorage } from "electron";
import ElectronStore from 'electron-store';
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { StoreSchema } from '../../../../shared/store/schema';
import playerStateStore from "../../../../player-state-store";
import { createAuthToken, getIsTemporaryAuthCodeValidAndRemove, getTemporaryAuthCode, isAuthValid, isAuthValidMiddleware } from '../../shared/auth';

declare const AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY: string;
declare const AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const mapThumbnails = (thumbnail: any) => {
    // Explicit mapping to keep a consistent API
    // If YouTube Music changes how this is presented internally then it's easier to update without breaking the API
    return {
        url: thumbnail.url,
        width: thumbnail.width,
        height: thumbnail.height
    }
}

const mapQueueItems = (item: any) => {
    let playlistPanelVideoRenderer;
    if (item.playlistPanelVideoRenderer)
        playlistPanelVideoRenderer = item.playlistPanelVideoRenderer;
    else if (item.playlistPanelVideoWrapperRenderer)
        playlistPanelVideoRenderer = item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;

    // This probably shouldn't happen but in the off chance it does we need to return nothing
    if (!playlistPanelVideoRenderer)
        return null

    return {
        thubmnails: playlistPanelVideoRenderer.thumbnail.thumbnails.map(mapThumbnails),
        title: playlistPanelVideoRenderer.title.runs[0].text,
        author: playlistPanelVideoRenderer.shortBylineText.runs[0].text,
        duration: playlistPanelVideoRenderer.lengthText.runs[0].text
    };
}

const getPlayerState = () => {
    const state = playerStateStore.getState();
    return {
        player: {
            state: state.trackState,
            progress: state.videoProgress,
            queue: state.queue ? {
                autoplay: state.queue.autoplay,
                shuffleEnabled: state.queue.shuffleEnabled,
                items: state.queue.items.map(mapQueueItems),
                automixItems: state.queue.automixItems.map(mapQueueItems),
                isGenerating: state.queue.isGenerating,
                isInfinite: state.queue.isInfinite,
                repeatMode: state.queue.repeatMode,
                // Developer note:
                //  selectedItemIndex can be 0 when the current video is not 0 in the queue.
                //  YouTube Music usually only does this on first navigations if going directly to a video + playlist (possibly within new queues as well on a playlist)
                selectedItemIndex: state.queue.selectedItemIndex
            } : null
        },
        video: state.videoDetails ? {
            author: state.videoDetails.author,
            title: state.videoDetails.title,
            album: state.videoDetails.album,
            thumbnails: state.videoDetails.thumbnail.thumbnails.map(mapThumbnails),
            duration: parseInt(state.videoDetails.lengthSeconds),
            id: state.videoDetails.videoId,
        } : null
    }
}

interface CompanionServerAPIv1Options extends FastifyPluginOptions {
    remoteCommandEmitter: (command: string, ...args: any[]) => void;
    getStore: () => ElectronStore<StoreSchema>;
}

const CompanionServerAPIv1: FastifyPluginCallback<CompanionServerAPIv1Options> = (fastify, options, next) => {
    fastify.post<{ Body: { appName: string } }>('/auth/requestcode', async (request, response) => {
        const code = await getTemporaryAuthCode(request.body.appName);
        if (code) {
            response.send({
                code
            });
        } else {
            response.send({
                error: 'AUTHORIZATION_TIMEOUT'
            })
        }
    });

    fastify.post<{ Body: { appName: string, code: string } }>('/auth/request', async (request, response) => {
        let companionServerAuthWindowEnabled = false;
        try {
            companionServerAuthWindowEnabled = safeStorage.decryptString(Buffer.from(options.getStore().get('integrations').companionServerAuthWindowEnabled, 'hex')) === 'true' ? true : false;
        } catch { /* do nothing, value is false */ }

        if (!companionServerAuthWindowEnabled) {
            response.send({
                error: 'AUTHORIZATION_DISABLED'
            });
            return;
        }

        if (!getIsTemporaryAuthCodeValidAndRemove(request.body.appName, request.body.code)) {
            response.send({
                error: 'AUTHORIZATION_INVALID'
            });
            return;
        }

        ipcMain.handle('companionAuthorization:getAppName', () => {
            return request.body.appName;
        });

        ipcMain.handle('companionAuthorization:getCode', () => {
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
                preload: AUTHORIZE_COMPANION_WINDOW_PRELOAD_WEBPACK_ENTRY,
            },
        });
        authorizationWindow.loadURL(AUTHORIZE_COMPANION_WINDOW_WEBPACK_ENTRY);
        authorizationWindow.show();

        // Open the DevTools.
        if (process.env.NODE_ENV === 'development') {
            authorizationWindow.webContents.openDevTools({
                mode: 'detach'
            });
        }

        let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
        let promiseInterval: string | number | NodeJS.Timeout;

        function resultListener(_event: Electron.IpcMainEvent, authorized: boolean) {
            clearInterval(this.interval);
            promiseResolve(authorized);
        }

        function closeListener() {
            clearInterval(this.interval);
            promiseResolve(false);
        }

        const startTime = Date.now();
        const authorized = await new Promise<boolean>((resolve) => {
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

            ipcMain.once('companionAuthorization:result', resultListener);
            ipcMain.once('companionWindow:close', closeListener);
        })

        authorizationWindow.close();
        ipcMain.removeHandler('companionAuthorization:getAppName');
        ipcMain.removeHandler('companionAuthorization:getCode');
        ipcMain.removeListener('companionAuthorization:result', resultListener);
        ipcMain.removeListener('companionWindow:close', closeListener);

        if (authorized) {
            const token = createAuthToken(options.getStore(), request.body.appName);

            response.send({
                token
            });
            options.getStore().set('integrations.companionServerAuthWindowEnabled', await safeStorage.encryptString("false"));
        } else {
            response.send({
                error: 'AUTHORIZATION_DENIED'
            })
        }
    })

    fastify.get('/state', {
        preHandler: (request, response, next) => {
            return isAuthValidMiddleware(options.getStore(), request, response, next);
        }
    }, (request, response) => {
        response.send(getPlayerState())
    })

    fastify.ready().then(() => {
        fastify.io.of('/api/v1').use((socket, next) => {
            const token = socket.handshake.auth.token
            const validSession = isAuthValid(options.getStore(), token);
            if (validSession)
                next()
            else
                next(new Error("UNAUTHORIZED"))
        });
        fastify.io.of('/api/v1').on('connection', (socket) => {
            socket.on('command', (command) => {
                switch (command) {
                    case "playPause": {
                        options.remoteCommandEmitter('playPause');
                        break;
                    }

                    case "volumeUp": {
                        options.remoteCommandEmitter('volumeUp');
                        break;
                    }

                    case "volumeDown": {
                        options.remoteCommandEmitter('volumeDown');
                        break;
                    }

                    case "next": {
                        options.remoteCommandEmitter('next');
                        break;
                    }

                    case "previous`": {
                        options.remoteCommandEmitter('previous');
                        break;
                    }
                }
            });
        });

        playerStateStore.addEventListener(() => {
            fastify.io.of('/api/v1').emit('state-update', getPlayerState())
        });
    })

    next();
};

export default CompanionServerAPIv1;