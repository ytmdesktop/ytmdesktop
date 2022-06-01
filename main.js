require('./src/utils/defaultSettings')

const {
    app,
    BrowserWindow,
    BrowserView,
    globalShortcut,
    Menu,
    ipcMain,
    systemPreferences,
    nativeTheme,
    screen,
    shell,
    dialog,
    powerMonitor,
} = require('electron')
const path = require('path')
const isDev = require('electron-is-dev')
const ClipboardWatcher = require('electron-clipboard-watcher')
const electronLocalshortcut = require('electron-localshortcut')
const electronLog = require('electron-log')
const os = require('os')

const { calcYTViewSize } = require('./src/utils/calcYTViewSize')
const { isWindows, isMac, isLinux } = require('./src/utils/systemInfo')
const { checkWindowPosition, doBehavior } = require('./src/utils/window')
const fileSystem = require('./src/utils/fileSystem')
const Vibrant = require('node-vibrant')

const __ = require('./src/providers/translateProvider')
const assetsProvider = require('./src/providers/assetsProvider')
const scrobblerProvider = require('./src/providers/scrobblerProvider')
const { statusBarMenu } = require('./src/providers/templateProvider')
const settingsProvider = require('./src/providers/settingsProvider')
const infoPlayerProvider = require('./src/providers/infoPlayerProvider')
const rainmeterNowPlaying = require('./src/providers/rainmeterNowPlaying')
const companionServer = require('./src/providers/companionServer')
const geniusAuthServer = require('./src/providers/geniusAuthServer')
const discordRPC = require('./src/providers/discordRpcProvider')
const mprisProvider = (() => {
    if (isLinux()) {
        return require('./src/providers/mprisProvider')
    } else {
        return null
    }
})()

const { commit_hash } = require('./commit_hash')

/* Variables =========================================================================== */
const defaultUrl = 'https://music.youtube.com'

let mainWindow,
    view,
    miniplayer,
    lyrics,
    settings,
    infoPlayerInterval,
    customCSSAppKey,
    customCSSPageKey,
    lastTrackId,
    lastTrackProgress,
    lastIsPaused,
    lastSeekbarCurrentPosition,
    doublePressPlayPause,
    updateTrackInfoTimeout,
    activityLikeStatus,
    settingsRendererIPC,
    mediaServiceProvider,
    audioDevices

let isFirstTime = false

let isClipboardWatcherRunning = false

let renderer_for_status_bar = (clipboardWatcher = null)

let mainWindowParams = {
    url: defaultUrl,
    width: 1500,
    height: 800,
}

let windowConfig = {
    frame: false,
    titleBarStyle: '',
}

global.sharedObj = {
    title: 'YTMDesktop',
    paused: true,
    rollable: settingsProvider.get('settings-shiny-tray-song-title-rollable'),
}

let iconDefault = assetsProvider.getIcon('favicon')
let iconTray = assetsProvider.getIcon('trayTemplate')
let iconPlay = assetsProvider.getIcon('favicon_play')
let iconPause = assetsProvider.getIcon('favicon_pause')
let sleepTimer = {
    mode: 0, // "time/counter/else"
    counter: 0, // "minutes in time mode/ songs in counter mode"
    interval: 0, // "valid in time mode"
}
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

/* First checks ========================================================================= */
app.commandLine.appendSwitch('disable-features', 'MediaSessionService') //This keeps chromium from trying to launch up it's own mpris service, hence stopping the double service.

if (!app.isDefaultProtocolClient('ytmd', process.execPath)) {
    app.setAsDefaultProtocolClient('ytmd', process.execPath)
}

if (settingsProvider.get('settings-surround-sound')) {
    app.commandLine.appendSwitch('try-supported-channel-layouts', '1')
}

app.commandLine.appendSwitch('disable-http-cache')

createCustomAppDir()

createCustomCSSDir()
createCustomCSSPageFile()

if (settingsProvider.get('has-updated') === true)
    setTimeout(() => {
        writeLog({ type: 'info', data: 'YTMDesktop updated' })
        ipcMain.emit('window', { command: 'show-changelog' })
    }, 2000)

/*if (
    isWindows() &&
    os.release().startsWith('10.') &&
    settingsProvider.get('settings-windows10-media-service')
)*/
try {
    mediaServiceProvider = require('./src/providers/mediaServiceProvider')
} catch (error) {
    console.log('error mediaServiceProvider > ' + error)
}

if (isMac()) {
    settingsProvider.set(
        'settings-shiny-tray-dark',
        nativeTheme.shouldUseDarkColors
    )
    systemPreferences.subscribeNotification(
        'AppleInterfaceThemeChangedNotification',
        function theThemeHasChanged() {
            settingsProvider.set(
                'settings-shiny-tray-dark',
                nativeTheme.shouldUseDarkColors
            )
            updateStatusBar()
        }
    )
    const menu = Menu.buildFromTemplate(statusBarMenu)
    Menu.setApplicationMenu(menu)
}

if (settingsProvider.get('settings-disable-hardware-acceleration'))
    app.disableHardwareAcceleration()

/* Functions ============================================================================= */
async function updateAccentColorPref() {
    if (settingsProvider.get('settings-enable-player-bgcolor')) {
        await view.webContents.executeJavaScript(
            `document.body.setAttribute('accent-enabled', '')`
        )
        await mainWindow.webContents.executeJavaScript(
            `document.body.setAttribute('accent-enabled', '')`
        )
    } else {
        await view.webContents.executeJavaScript(
            `document.body.removeAttribute('accent-enabled')`
        )
        await mainWindow.webContents.executeJavaScript(
            `document.body.removeAttribute('accent-enabled')`
        )
    }
}

async function createWindow() {
    if (isMac() || isWindows()) {
        const execApp = path.basename(process.execPath)
        const startArgs = ['--processStart', `"${execApp}"`]
        const startOnBoot = settingsProvider.get('settings-start-on-boot')
        if (startOnBoot)
            app.setLoginItemSettings({
                openAtLogin: true,
                path: process.execPath,
                args: startArgs,
            })
        else
            app.setLoginItemSettings({
                openAtLogin: false,
                args: startArgs,
            })
    }
    windowSize = settingsProvider.get('window-size')
    windowMaximized = settingsProvider.get('window-maximized')
    windowMinimized = settingsProvider.get('settings-start-minimized')

    if (windowSize) {
        mainWindowParams.width = windowSize.width
        mainWindowParams.height = windowSize.height
    } else {
        let size = screen.getPrimaryDisplay().workAreaSize

        mainWindowParams.width = size.width - 150
        mainWindowParams.height = size.height - 150
    }

    browserWindowConfig = {
        icon: iconDefault,
        width: mainWindowParams.width,
        height: mainWindowParams.height,
        minWidth: 300,
        minHeight: 300,
        show: !windowMinimized,
        autoHideMenuBar: true,
        backgroundColor: '#232323',
        center: true,
        closable: true,
        skipTaskbar: false,
        resize: true,
        maximizable: true,
        webPreferences: {
            nodeIntegration: true,
            webviewTag: true,
            enableRemoteModule: true,
            contextIsolation: false,
        },
    }

    switch (settingsProvider.get('titlebar-type')) {
        case 'nice':
            browserWindowConfig.frame = false
            browserWindowConfig.titleBarStyle = 'hidden'

            windowConfig.frame = false
            windowConfig.titleBarStyle = 'hidden'
            break

        case 'system':
            browserWindowConfig.frame = true

            windowConfig.frame = true
            windowConfig.titleBarStyle = 'hidden'
            break

        case 'none':
            browserWindowConfig.frame = false
            browserWindowConfig.titleBarStyle = 'hidden'

            windowConfig.frame = false
            windowConfig.titleBarStyle = 'hidden'
            break
    }

    /* For the uninformed:
        - The `view` variable is the actual webpage that contains youtube music and stuff.
        - The `mainWindow` variable contains the window frame that holds the mainWindow, but you cannot inspect mainWindow elements.
        Yes, I am confused as you are, but hopefully that clears up some confusion
    */
    mainWindow = new BrowserWindow(browserWindowConfig)

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
        {
            urls: ['https://accounts.google.com/*'],
        },
        (details, callback) => {
            const newRequestHeaders = Object.assign(
                {},
                details.requestHeaders || {},
                {
                    'User-Agent': settingsProvider.get('user-agent'),
                }
            )
            callback({ requestHeaders: newRequestHeaders })
        }
    )

    view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            webviewTag: false,
            enableRemoteModule: false,
            contextIsolation: true,
            sandbox: true,
            nativeWindowOpen: true,
            preload: path.join(
                app.getAppPath(),
                '/src/utils/injectControls.js'
            ),
        },
    })

    await mainWindow.loadFile(
        path.join(
            app.getAppPath(),
            '/src/pages/shared/window-buttons/window-buttons.html'
        ),
        { search: 'page=home/home&trusted=1&script=shiny-tray-helper' }
    )

    mainWindow.addBrowserView(view)

    view.setBounds(calcYTViewSize(settingsProvider, mainWindow))

    if (
        settingsProvider.get('settings-continue-where-left-of') &&
        settingsProvider.get('window-url')
    )
        mainWindowParams.url = settingsProvider.get('window-url')

    view.webContents.loadURL(mainWindowParams.url).then(() => {
        updateAccentColorPref()
    })

    if (process.env.NODE_ENV === 'development') {
        view.webContents.openDevTools({ mode: 'detach' })
    }

    mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())

    let position = settingsProvider.get('window-position')
    if (position !== undefined) mainWindow.setPosition(position.x, position.y)

    if (windowMaximized)
        setTimeout(() => {
            mainWindow.send('window-is-maximized', true)
            view.setBounds(calcYTViewSize(settingsProvider, mainWindow))
            mainWindow.maximize()
        }, 700)

    mainWindow.on('closed', () => {
        view = null
        mainWindow = null
    })

    mainWindow.on('show', () => {
        mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())
    })

    mainWindow.on('reload', () => {
        view.webContents.forcefullyCrashRenderer()
        view.webContents.reload()
    })

    view.webContents.on('new-window', (event, url) => {
        event.preventDefault()
        shell.openExternal(url)
    })

    // view.webContents.openDevTools({ mode: 'detach' });
    view.webContents.on('did-navigate-in-page', () => {
        if (view.webContents.getURL().indexOf('watch?v=') === 26) {
            mainWindow.webContents.executeJavaScript(`
                document.body.setAttribute('player-open', '')
            `)
            view.webContents.executeJavaScript(`
                document.body.setAttribute('player-open', '')
            `)
        } else {
            mainWindow.webContents.executeJavaScript(`
                document.body.removeAttribute('player-open')
            `)
            view.webContents.executeJavaScript(`
                document.body.removeAttribute('player-open')
            `)
        }
        initialized = true
        view.webContents.insertCSS(`
            /* width */
            ::-webkit-scrollbar {
                width: 9px;
            }

            /* Track */
            ::-webkit-scrollbar-track {
                background: #232323;
            }

            /* Handle */
            ::-webkit-scrollbar-thumb {
                background: #555;
            }

            /* Handle on hover */
            ::-webkit-scrollbar-thumb:hover {
                background: #f44336;
            }
        `)
    })

    view.webContents.on('media-started-playing', () => {
        if (!infoPlayerProvider.hasInitialized()) {
            infoPlayerProvider.init(view)
        }

        mediaServiceProvider.init(view)

        if (isMac()) {
            global.sharedObj.paused = false
            updateStatusBar()
        }

        if (infoPlayerInterval === undefined) {
            infoPlayerInterval = setInterval(() => {
                if (global.on_the_road) {
                    updateActivity()
                }
            }, 300)
        }
    })

    view.webContents.on('did-start-navigation', (_) => {
        view.webContents
            .executeJavaScript('window.location.hostname')
            .then((hostname) => {
                if (hostname !== 'music.youtube.com') {
                    mainWindow.send('off-the-road')
                    global.on_the_road = false
                } else {
                    mainWindow.send('on-the-road')
                    global.on_the_road = true

                    loadAudioOutput()
                    loadCustomCSSPage()
                }
            })
            .catch((_) => console.log(`error did-start-navigation ${_}`))
    })

    function updateActivity() {
        const playerInfo = infoPlayerProvider.getPlayerInfo()
        const trackInfo = infoPlayerProvider.getTrackInfo()

        const progress = playerInfo.statePercent
        const seekbarCurrentPosition = playerInfo.seekbarCurrentPosition
        const trackId = trackInfo.id
        const title = trackInfo.title
        const author = trackInfo.author
        const album = trackInfo.album
        const duration = trackInfo.duration
        const cover = trackInfo.cover
        const nowPlaying = `${title} - ${author}`

        if (title && author) {
            rainmeterNowPlaying.setActivity(getAll())

            if (settingsProvider.get('settings-enable-taskbar-progressbar')) {
                mediaControl.setProgress(
                    mainWindow,
                    settingsProvider.get('settings-enable-taskbar-progressbar')
                        ? progress
                        : -1,
                    playerInfo.isPaused
                )
            }

            /**
             * Scrobble when track changes or when current track starts from the beginning
             */
            if (settingsProvider.get('settings-last-fm-scrobbler')) {
                if (
                    lastTrackId !== trackId ||
                    (lastTrackProgress > progress && progress < 0.2)
                ) {
                    if (!trackInfo.isAdvertisement) {
                        clearInterval(updateTrackInfoTimeout)
                        updateTrackInfoTimeout = setTimeout(() => {
                            scrobblerProvider.updateTrackInfo(
                                title,
                                author,
                                album
                            )
                        }, 20 * 1000)
                        scrobblerProvider.updateNowPlaying(
                            title,
                            author,
                            album,
                            duration
                        )
                    }
                }
            }

            /**
             * Update only when change seekbar
             */
            if (
                lastSeekbarCurrentPosition - seekbarCurrentPosition > 2 ||
                lastSeekbarCurrentPosition - seekbarCurrentPosition < -2
            )
                discordRPC.setActivity(getAll())

            /**
             * Update only when change track
             */
            if (lastTrackId !== trackId) {
                lastTrackId = trackId

                setTimeout(() => {
                    if (
                        settingsProvider.get('settings-skip-track-disliked') &&
                        infoPlayerProvider.getPlayerInfo().likeStatus ===
                            'DISLIKE'
                    )
                        mediaControl.nextTrack(view)

                    if (
                        infoPlayerProvider.getTrackInfo().duration <
                        parseInt(
                            settingsProvider.get(
                                'settings-skip-track-shorter-than'
                            )
                        )
                    )
                        mediaControl.nextTrack(view)
                }, 1000)

                infoPlayerProvider.updateQueueInfo()
                infoPlayerProvider.updatePlaylistInfo()
                infoPlayerProvider.isInLibrary()

                if (isMac()) {
                    global.sharedObj.title = nowPlaying
                    updateStatusBar()
                }

                mainWindow.setTitle(nowPlaying)

                tray.setTooltip(nowPlaying)

                if (
                    !mainWindow.isFocused() &&
                    settingsProvider.get('settings-show-notifications')
                )
                    tray.balloon(title, author, cover, iconDefault)

                mediaServiceProvider.setPlaybackData(
                    title,
                    author,
                    cover,
                    album
                )

                /**
                 * Update background color for Player
                 */
                Vibrant.from(getTrackInfo().cover)
                    .getPalette()
                    .then((palette) => {
                        hue = palette.DarkVibrant.getHsl()[0] * 360
                        sat = palette.DarkVibrant.getHsl()[1] === 0 ? 0 : 70
                        view.webContents.executeJavaScript(`
                            document.documentElement.style.setProperty("--ytm-album-color-muted", 'hsl(${hue}, ${sat}%, 20%)');
                            document.documentElement.style.setProperty("--ytm-album-color-vibrant", 'hsl(${hue}, ${sat}%, 30%)');
                        `)
                        mainWindow.webContents.executeJavaScript(`
                            document.documentElement.style.setProperty("--ytm-album-color-muted", 'hsl(${hue}, ${sat}%, 20%)');
                        `)
                    })

                if (sleepTimer.mode == 'counter') {
                    sleepTimer.counter -= 1
                    if (sleepTimer.counter <= 0) {
                        if (!infoPlayerProvider.getPlayerInfo().isPaused)
                            mediaControl.playPauseTrack(view)

                        sleepTimer.mode = 'off'
                    }
                }

                /**
                 * Update the saved url if settings-continue-where-left-of is enabled
                 */
                if (settingsProvider.get('settings-continue-where-left-of')) {
                    view.webContents
                        .executeJavaScript(
                            `
                        document.querySelector('.yt-uix-sessionlink').href;
                    `
                        )
                        .then((result) => {
                            if (result) {
                                const url = new URL(result)
                                // Hostname correction as the provided url is for youtube.com
                                url.hostname = 'music.youtube.com'
                                settingsProvider.set(
                                    'window-url',
                                    url.toString()
                                )
                            } else {
                                // No session link found so just default to the current url
                                settingsProvider.set(
                                    'window-url',
                                    view.webContents.getURL()
                                )
                            }
                        })
                        .catch(() => {
                            // JavaScript errored, assume no session link found and default to current url
                            settingsProvider.set(
                                'window-url',
                                view.webContents.getURL()
                            )
                        })
                }

                writeLog({ type: 'info', data: `Listen: ${title} - ${author}` })
                discordRPC.setActivity(getAll())
            }

            /**
             * Update only when change state play/pause
             */
            if (lastIsPaused !== playerInfo.isPaused) {
                lastIsPaused = playerInfo.isPaused

                discordRPC.setActivity(getAll())

                if (!isMac() && !settingsProvider.get('settings-shiny-tray')) {
                    tray.updateTrayIcon(
                        playerInfo.isPaused ? iconPause : iconPlay
                    )
                }

                mediaControl.createThumbar(
                    mainWindow,
                    infoPlayerProvider.getAllInfo()
                )

                mediaServiceProvider.setPlaybackStatus(playerInfo.isPaused)
            }

            if (activityLikeStatus !== playerInfo.likeStatus) {
                mediaControl.createThumbar(
                    mainWindow,
                    infoPlayerProvider.getAllInfo()
                )
                activityLikeStatus = playerInfo.likeStatus
            }

            lastTrackProgress = progress
            lastSeekbarCurrentPosition = seekbarCurrentPosition
        }
    }

    view.webContents.on('media-started-playing', () => {
        logDebug('Playing')
        try {
            if (isMac()) {
                updateStatusBar()
            }

            global.sharedObj.paused = false
            mediaControl.createThumbar(
                mainWindow,
                infoPlayerProvider.getAllInfo()
            )
        } catch (_) {}
    })

    view.webContents.on('media-paused', () => {
        logDebug('Paused')
        try {
            if (isMac()) {
                updateStatusBar()
            }

            global.sharedObj.paused = true
            mediaControl.createThumbar(
                mainWindow,
                infoPlayerProvider.getAllInfo()
            )
        } catch (_) {}
    })

    mainWindow.on('resize', () => {
        let windowSize = mainWindow.getSize()
        setTimeout(() => {
            view.setBounds(calcYTViewSize(settingsProvider, mainWindow))
        }, 200)

        mainWindow.send('window-is-maximized', mainWindow.isMaximized())

        settingsProvider.set('window-maximized', mainWindow.isMaximized())
        if (!mainWindow.isMaximized()) {
            settingsProvider.set('window-size', {
                width: windowSize[0],
                height: windowSize[1],
            })
        }
    })

    let storePositionTimer
    mainWindow.on('move', (_) => {
        let position = mainWindow.getPosition()
        if (storePositionTimer) {
            clearTimeout(storePositionTimer)
        }
        storePositionTimer = setTimeout(() => {
            settingsProvider.set('window-position', {
                x: position[0],
                y: position[1],
            })
        }, 500)
    })

    mainWindow.on('focus', () => {
        view.webContents.focus()
    })

    mainWindow.on('close', (e) => {
        if (settingsProvider.get('settings-keep-background')) {
            e.preventDefault()
            if (settingsProvider.get('settings-tray-icon')) {
                mainWindow.hide()
            } else {
                mainWindow.minimize()
            }
        } else {
            app.exit()
        }
    })

    // LOCAL
    electronLocalshortcut.register(
        view,
        isMac() ? 'Cmd+,' : 'CmdOrCtrl+S',
        () => ipcMain.emit('window', { command: 'show-settings' })
    )

    // GLOBAL
    ipcMain.on('change-accelerator', (dataMain, dataRenderer) => {
        if (dataMain.type !== undefined) args = dataMain
        else args = dataRenderer

        try {
            globalShortcut.unregister(args.oldValue)
        } catch (_) {}

        switch (args.type) {
            case 'media-play-pause':
                registerGlobalShortcut(args.newValue, () => {
                    checkDoubleTapPlayPause()
                })
                break

            case 'media-track-next':
                registerGlobalShortcut(args.newValue, () => {
                    mediaControl.nextTrack(view)
                })
                break

            case 'media-track-previous':
                registerGlobalShortcut(args.newValue, () => {
                    mediaControl.previousTrack(view)
                })
                break

            case 'media-track-like':
                registerGlobalShortcut(args.newValue, () => {
                    if (
                        infoPlayerProvider.getPlayerInfo().likeStatus !== 'LIKE'
                    ) {
                        mediaControl.upVote(view)
                        if (
                            settingsProvider.get('settings-show-notifications')
                        ) {
                            tray.balloonEvents({
                                title: `${songInfo().title} - ${
                                    songInfo().author
                                }`,
                                content: __.trans('LABEL_NOTIFICATION_LIKED'),
                                icon: assetsProvider.getLocal(
                                    'img/notification-thumbs-up.png'
                                ),
                            })
                        }
                    }
                })
                break

            case 'media-track-dislike':
                registerGlobalShortcut(args.newValue, () => {
                    if (
                        infoPlayerProvider.getPlayerInfo().likeStatus !==
                        'DISLIKE'
                    ) {
                        mediaControl.downVote(view)
                        if (
                            settingsProvider.get('settings-show-notifications')
                        ) {
                            tray.balloonEvents({
                                title: `${songInfo().title} - ${
                                    songInfo().author
                                }`,
                                content: __.trans(
                                    'LABEL_NOTIFICATION_DISLIKED'
                                ),
                                icon: assetsProvider.getLocal(
                                    'img/notification-thumbs-down.png'
                                ),
                            })
                        }
                    }
                })
                break

            case 'media-volume-up':
                registerGlobalShortcut(args.newValue, () => {
                    mediaControl.volumeUp(view)
                })
                break

            case 'media-volume-down':
                registerGlobalShortcut(args.newValue, () => {
                    mediaControl.volumeDown(view)
                })
                break

            case 'miniplayer-open-close':
                registerGlobalShortcut(args.newValue, () => {
                    try {
                        if (miniplayer) {
                            miniplayer.close()
                            miniplayer = undefined
                            mainWindow.show()
                        } else {
                            ipcMain.emit('window', {
                                command: 'show-miniplayer',
                            })
                        }
                    } catch (_) {
                        writeLog({
                            type: 'warn',
                            data: 'error on try open/close miniplayer',
                        })
                    }
                })
                break
        }
    })

    // Custom accelerators
    let settingsAccelerator = settingsProvider.get('settings-accelerators')

    ipcMain.emit('change-accelerator', {
        type: 'media-play-pause',
        newValue: settingsAccelerator['media-play-pause'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-track-next',
        newValue: settingsAccelerator['media-track-next'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-track-previous',
        newValue: settingsAccelerator['media-track-previous'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-track-like',
        newValue: settingsAccelerator['media-track-like'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-track-dislike',
        newValue: settingsAccelerator['media-track-dislike'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-volume-up',
        newValue: settingsAccelerator['media-volume-up'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'media-volume-down',
        newValue: settingsAccelerator['media-volume-down'],
    })

    ipcMain.emit('change-accelerator', {
        type: 'miniplayer-open-close',
        newValue: settingsAccelerator['miniplayer-open-close'],
    })

    if (
        (isWindows() &&
            (!settingsProvider.get(
                'settings-windows10-media-service-show-info'
            ) ||
                !settingsProvider.get('settings-windows10-media-service'))) ||
        isMac() ||
        isLinux()
    ) {
        let settingsAccelerator = settingsProvider.get('settings-accelerators')

        globalShortcut.register('MediaPlayPause', () => {
            checkDoubleTapPlayPause()
        })

        globalShortcut.register('MediaStop', () => {
            mediaControl.stopTrack(view)
        })

        globalShortcut.register('MediaPreviousTrack', () => {
            mediaControl.previousTrack(view)
        })

        globalShortcut.register('MediaNextTrack', () => {
            mediaControl.nextTrack(view)
        })
    }

    if (settingsProvider.get('settings-volume-media-keys')) {
        globalShortcut.register('VolumeUp', () => {
            mediaControl.volumeUp(view)
        })

        globalShortcut.register('VolumeDown', () => {
            mediaControl.volumeDown(view)
        })
    }

    ipcMain.handle('invoke-all-info', async () =>
        infoPlayerProvider.getAllInfo()
    )

    settingsProvider.onDidChange(
        'settings-shiny-tray-song-title-rollable',
        (data) => {
            console.log(data.newValue)
            global.sharedObj.rollable = data.newValue
            if (renderer_for_status_bar)
                renderer_for_status_bar.send('update-status-bar')
        }
    )

    settingsProvider.onDidChange(
        'settings-rainmeter-web-now-playing',
        (data) => {
            if (data.newValue) rainmeterNowPlaying.start()
            else rainmeterNowPlaying.stop()
        }
    )

    settingsProvider.onDidChange('settings-companion-server', (data) => {
        if (data.newValue) companionServer.start()
        else companionServer.stop()
    })

    settingsProvider.onDidChange('settings-genius-auth-server', (data) => {
        if (data.newValue) geniusAuthServer.start()
        else geniusAuthServer.stop()
    })

    settingsProvider.onDidChange('settings-enable-player-bgcolor', () => {
        updateAccentColorPref()
    })

    settingsProvider.onDidChange('settings-discord-rich-presence', (data) => {
        if (data.newValue) discordRPC.start()
        else discordRPC.stop()
    })

    settingsProvider.onDidChange('settings-custom-css-app', (data) => {
        if (data.newValue) loadCustomCSSApp()
        else removeCustomCSSApp()
    })

    settingsProvider.onDidChange('settings-custom-css-page', (data) => {
        if (data.newValue) loadCustomCSSPage()
        else removeCustomCSSPage()
    })

    settingsProvider.onDidChange('settings-page-zoom', (data) => {
        console.log(data)
        view.webContents.setZoomFactor(data.newValue / 100)
    })

    ipcMain.on('media-command', (dataMain, dataRenderer) => {
        let command, value

        if (dataMain.command !== undefined) {
            command = dataMain.command
            value = dataMain.value
        } else {
            command = dataRenderer.command
            value = dataRenderer.value
        }

        switch (command) {
            case 'media-play-pause':
                if (infoPlayerProvider.getTrackInfo().id === '')
                    infoPlayerProvider.firstPlay(view.webContents)
                mediaControl.playPauseTrack(view)
                break

            case 'media-track-next':
                mediaControl.nextTrack(view)
                break

            case 'media-track-previous':
                mediaControl.previousTrack(view)
                break

            case 'media-vote-up':
                mediaControl.upVote(view)
                break

            case 'media-vote-down':
                mediaControl.downVote(view)
                break

            case 'media-volume-up':
                mediaControl.volumeUp(view)
                break

            case 'media-volume-down':
                mediaControl.volumeDown(view)
                break

            case 'media-seekbar-forward':
                mediaControl.mediaForwardTenSeconds(view)
                break

            case 'media-seekbar-rewind':
                mediaControl.mediaRewindTenSeconds(view)
                break

            case 'media-seekbar-set':
                mediaControl.changeSeekbar(view, value)
                break

            case 'media-volume-set':
                mediaControl.changeVolume(view, value)
                break

            case 'media-queue-set':
                mediaControl.selectQueueItem(view, value)
                break

            case 'media-repeat':
                mediaControl.repeat(view)
                break

            case 'media-shuffle':
                mediaControl.shuffle(view)
                break

            case 'media-add-library':
                mediaControl.addToLibrary(view)
                break

            case 'media-add-playlist':
                mediaControl.addToPlaylist(view, value)
                break
        }
    })

    ipcMain.on('refresh-progress', () => {
        mediaControl.setProgress(mainWindow, -1, playerInfo.isPaused)
    })

    ipcMain.on('register-renderer', (event, _) => {
        renderer_for_status_bar = event.sender
        event.sender.send('update-status-bar')
        event.sender.send('is-dev', isDev)
    })

    ipcMain.on('update-tray', () => {
        if (!isMac()) return
        global.sharedObj.rollable = settingsProvider.get(
            'settings-shiny-tray-song-title-rollable'
        )
        updateStatusBar()
        tray.setShinyTray()
    })

    ipcMain.on('closed', (_) => {
        mainWindow = null
        if (process.platform !== 'darwin') {
            app.quit()
        }
    })

    ipcMain.on('show', (_) => {
        mainWindow.show()
    })

    ipcMain.on('btn-update-clicked', () => {
        updater.quitAndInstall()
    })

    ipcMain.on('window', (dataMain, dataRenderer) => {
        let command, value

        if (dataMain.command !== undefined) {
            command = dataMain.command
            value = dataMain.value
        } else {
            command = dataRenderer.command
            value = dataRenderer.value
        }

        switch (command) {
            case 'show-settings':
                windowSettings()
                break

            case 'show-miniplayer':
                windowMiniplayer()
                break

            case 'show-last-fm-login':
                windowLastFmLogin()
                break

            case 'show-editor-theme':
                windowThemeEditor()
                break

            case 'show-lyrics':
                windowLyrics()
                break

            case 'show-lyrics-hidden':
                windowLyrics()
                lyrics.hide()
                break

            case 'show-companion':
                windowCompanion()
                break

            case 'show-guest-mode':
                windowGuest()
                break

            case 'show-changelog':
                windowChangelog()
                break

            case 'restore-main-window':
                mainWindow.show()
                try {
                    miniplayer.close()
                    miniplayer = undefined
                } catch (_) {}
                break

            case 'show-discord-settings':
                windowDiscordSettings()
                break

            case 'show-shortcut-buttons-settings':
                windowShortcutButtonsSettings()
                break
        }
    })

    function checkDoubleTapPlayPause() {
        if (settingsProvider.get('settings-enable-double-tapping-show-hide')) {
            if (!doublePressPlayPause) {
                // The first press
                if (infoPlayerProvider.getTrackInfo().id === '')
                    infoPlayerProvider.firstPlay(view.webContents)

                doublePressPlayPause = true
                setTimeout(() => {
                    if (doublePressPlayPause) mediaControl.playPauseTrack(view)
                    doublePressPlayPause = false
                }, 200)
            } else {
                // The second press
                doublePressPlayPause = false
                doBehavior(mainWindow)
            }
        } else mediaControl.playPauseTrack(view)
    }

    async function windowSettings() {
        if (settings) settings.show()
        else {
            const mainWindowPosition = mainWindow.getPosition()
            const mainWindowSize = mainWindow.getSize()

            const xPos = mainWindowPosition[0] + mainWindowSize[0] / 4
            const yPos = mainWindowPosition[1] + 200

            settings = new BrowserWindow({
                title: __.trans('LABEL_SETTINGS'),
                icon: iconDefault,
                modal: false,
                frame: windowConfig.frame,
                titleBarStyle: windowConfig.titleBarStyle,
                resizable: true,
                width: 900,
                minWidth: 900,
                height: 550,
                minHeight: 550,
                x: xPos,
                y: yPos,
                autoHideMenuBar: false,
                skipTaskbar: false,
                webPreferences: {
                    nodeIntegration: true,
                    webviewTag: true,
                    enableRemoteModule: true,
                    contextIsolation: false,
                    nodeIntegrationInSubFrames: true,
                    webSecurity: false,
                    sandbox: false,
                },
            })

            await settings.loadFile(
                path.join(
                    app.getAppPath(),
                    '/src/pages/shared/window-buttons/window-buttons.html'
                ),
                {
                    search:
                        'page=settings/settings&trusted=1&icon=settings&hide=btn-minimize,btn-maximize&title=' +
                        __.trans('LABEL_SETTINGS'),
                }
            )

            if (process.env.NODE_ENV === 'development') {
                settings.webContents.openDevTools({ mode: 'detach' })
            }
        }

        settings.on('closed', () => {
            settings = null
        })
    }

    async function windowMiniplayer() {
        if (miniplayer) miniplayer.show()
        else {
            var miniplayerConfig = {
                title: __.trans('LABEL_MINIPLAYER'),
                icon: iconDefault,
                modal: false,
                frame: false,
                center: false,

                resizable: settingsProvider.get(
                    'settings-miniplayer-resizable'
                ),
                skipTaskbar: !settingsProvider.get(
                    'settings-miniplayer-show-task'
                ),
                alwaysOnTop: settingsProvider.get(
                    'settings-miniplayer-always-top'
                ),

                backgroundColor: '#232323',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: true,
                    enableRemoteModule: true,
                },
            }

            if (settingsProvider.get('settings-miniplayer-stream-config')) {
                var streamSize = settingsProvider.get(
                    'settings-miniplayer-stream-size'
                )
                if (streamSize) {
                    miniplayerConfig.width = streamSize.x
                    miniplayerConfig.height = streamSize.y
                } else {
                    miniplayerConfig.width = 500
                    miniplayerConfig.height = 100
                }

                miniplayerConfig.minWidth = 300
                miniplayerConfig.minHeight = 100

                miniplayer = new BrowserWindow(miniplayerConfig)
                await miniplayer.loadFile(
                    path.join(
                        app.getAppPath(),
                        '/src/pages/miniplayer/streamPlayer.html'
                    )
                )
            } else {
                miniplayerConfig.width = settingsProvider.get(
                    'settings-miniplayer-size'
                )
                miniplayerConfig.height = settingsProvider.get(
                    'settings-miniplayer-size'
                )
                miniplayerConfig.minWidth = 100
                miniplayerConfig.minHeight = 100

                miniplayer = new BrowserWindow(miniplayerConfig)
                await miniplayer.loadFile(
                    path.join(
                        app.getAppPath(),
                        '/src/pages/miniplayer/miniplayer.html'
                    )
                )
            }

            let miniplayerPosition = settingsProvider.get('miniplayer-position')
            if (miniplayerPosition !== undefined)
                miniplayer.setPosition(
                    miniplayerPosition.x,
                    miniplayerPosition.y
                )
            let storeMiniplayerPositionTimer
            miniplayer.on('move', () => {
                let position = miniplayer.getPosition()
                if (storeMiniplayerPositionTimer)
                    clearTimeout(storeMiniplayerPositionTimer)

                storeMiniplayerPositionTimer = setTimeout(() => {
                    settingsProvider.set('miniplayer-position', {
                        x: position[0],
                        y: position[1],
                    })
                }, 1000)
            })

            miniplayer.on('resize', (e) => {
                if (
                    !settingsProvider.get('settings-miniplayer-stream-config')
                ) {
                    // Square Miniplayer
                    try {
                        let size = Math.min(...miniplayer.getSize())
                        miniplayer.setSize(size, size)
                        settingsProvider.set('settings-miniplayer-size', size)
                        e.preventDefault()
                    } catch (_) {
                        writeLog({
                            type: 'warn',
                            data: 'error miniplayer resize',
                        })
                    }
                } else {
                    // Resized
                    try {
                        let size = miniplayer.getSize()
                        settingsProvider.set(
                            'settings-miniplayer-stream-size',
                            {
                                x: size[0],
                                y: size[1],
                            }
                        )
                    } catch (_) {
                        writeLog({
                            type: 'warn',
                            data: 'error miniplayer (stream) resize',
                        })
                    }
                }
            })

            // Devtools
            if (process.env.NODE_ENV === 'development') {
                miniplayer.openDevTools({ mode: 'detach' })
            }

            mainWindow.hide()
        }
    }

    async function windowLastFmLogin() {
        const lastfm = new BrowserWindow({
            //parent: mainWindow,
            icon: iconDefault,
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 300,
            minWidth: 300,
            height: 260,
            minHeight: 260,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                enableRemoteModule: true,
            },
        })

        await lastfm.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/sub/last-fm/last-fm-login&icon=music_note&hide=btn-minimize,btn-maximize&title=Last.FM Login',
            }
        )
    }

    async function windowThemeEditor() {
        const editor = new BrowserWindow({
            icon: iconDefault,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 700,
            height: 800,
            maxHeight: 800,
            minHeight: 800,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                enableRemoteModule: true,
            },
        })

        await editor.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=editor/editor&icon=color_lens&hide=btn-minimize,btn-maximize',
            }
        )
    }

    async function windowLyrics() {
        if (lyrics) {
            lyrics.show()
            process.env.NODE_ENV === 'development'
                ? lyrics.webContents.openDevTools({ mode: 'detach' })
                : null
        } else {
            lyrics = new BrowserWindow({
                icon: iconDefault,
                frame: windowConfig.frame,
                titleBarStyle: windowConfig.titleBarStyle,
                center: true,
                resizable: true,
                backgroundColor: '#232323',
                width: 700,
                height: 800,
                alwaysOnTop: settingsProvider.get('settings-lyrics-always-top'),
                webPreferences: {
                    nodeIntegration: true,
                    webviewTag: true,
                    enableRemoteModule: true,
                },
            })

            let lyricsPosition = settingsProvider.get('lyrics-position')
            if (lyricsPosition !== undefined)
                lyrics.setPosition(lyricsPosition.x, lyricsPosition.y)

            await lyrics.loadFile(
                path.join(
                    __dirname,
                    './src/pages/shared/window-buttons/window-buttons.html'
                ),
                {
                    search:
                        'page=lyrics/lyrics&icon=music_note&hide=btn-minimize,btn-maximize&title=' +
                        __.trans('LABEL_LYRICS'),
                }
            )

            let storeLyricsPositionTimer
            lyrics.on('move', () => {
                let position = lyrics.getPosition()
                if (storeLyricsPositionTimer)
                    clearTimeout(storeLyricsPositionTimer)

                storeLyricsPositionTimer = setTimeout(() => {
                    settingsProvider.set('lyrics-position', {
                        x: position[0],
                        y: position[1],
                    })
                }, 500)
            })

            lyrics.on('closed', () => {
                lyrics = null
                if (process.env.NODE_ENV === 'development') {
                    lyrics.webContents.closeDevTools()
                }
            })

            if (process.env.NODE_ENV === 'development') {
                lyrics.webContents.openDevTools({ mode: 'detach' })
            }
        }
    }

    async function windowCompanion() {
        await shell.openExternal(`http://localhost:9863`)
        return
        //const x = mainWindow.getPosition()[0]
        //const y = mainWindow.getPosition()[1]

        /* Commented code since the return above blocks its execution
        let size = screen.getPrimaryDisplay().workAreaSize;

        const settings = new BrowserWindow({
            // parent: mainWindow,
            icon: iconDefault,
            skipTaskbar: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            resizable: false,
            backgroundColor: '#232323',
            width: size.width - 450,
            height: size.height - 450,
            center: true,
            title: 'companionWindowTitle',
            webPreferences: {
                nodeIntegration: false,
                enableRemoteModule: true,
            },
            autoHideMenuBar: true,
        });
        await settings.loadURL('http://localhost:9863');*/
    }

    async function windowGuest() {
        const incognitoWindow = new BrowserWindow({
            icon: iconDefault,
            width: mainWindowParams.width,
            height: mainWindowParams.height,
            minWidth: 300,
            minHeight: 300,
            show: true,
            autoHideMenuBar: true,
            backgroundColor: '#232323',
            center: true,
            closable: true,
            skipTaskbar: false,
            resize: true,
            maximizable: true,
            frame: true,
            webPreferences: {
                nodeIntegration: true,
                enableRemoteModule: true,
                partition: `guest-mode-${Date.now()}`,
            },
        })

        incognitoWindow.webContents.session.setUserAgent(
            `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
        )

        await incognitoWindow.webContents.loadURL(mainWindowParams.url)
    }

    async function windowDiscordSettings() {
        const discord = new BrowserWindow({
            //parent: mainWindow,
            icon: iconDefault,
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 600,
            minWidth: 600,
            height: 220,
            minHeight: 220,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                enableRemoteModule: true,
            },
        })

        await discord.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/sub/discord/discord_settings&icon=settings&title=' +
                    __.trans('LABEL_SETTINGS_DISCORD') +
                    '&hide=btn-minimize,btn-maximize',
            }
        )
    }

    async function windowShortcutButtonsSettings() {
        const discord = new BrowserWindow({
            //parent: mainWindow,
            icon: iconDefault,
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 600,
            minWidth: 600,
            height: 220,
            minHeight: 220,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                enableRemoteModule: true,
            },
        })

        await discord.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/sub/shortcut-buttons/shortcut-buttons-settings&icon=settings&title=' +
                    __.trans('SHORTCUT_BUTTONS') +
                    '&hide=btn-minimize,btn-maximize',
            }
        )
    }

    async function windowChangelog() {
        let changelog = new BrowserWindow({
            title: __.trans('LABEL_CHANGELOG'),
            icon: iconDefault,
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: false,
            backgroundColor: '#232323',
            width: 600,
            height: 580,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
                enableRemoteModule: true,
            },
        })

        await changelog.loadFile(
            path.join(
                app.getAppPath(),
                '/src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search: `title=${__.trans(
                    'LABEL_CHANGELOG'
                )}&page=changelog/changelog&hide=btn-minimize,btn-maximize`,
            }
        )
    }

    ipcMain.on('switch-clipboard-watcher', () => {
        switchClipboardWatcher()
    })

    ipcMain.on('miniplayer-toggle-ontop', () => {
        miniplayer.setAlwaysOnTop(!miniplayer.isAlwaysOnTop())
    })

    ipcMain.on('reset-url', async () => {
        mainWindowParams.url = defaultUrl

        const options = { extraHeaders: 'pragma: no-cache\n' }
        await view.webContents.loadURL(mainWindowParams.url, options)
    })

    ipcMain.on('update-custom-css-page', () => {
        loadCustomCSSPage()
    })

    ipcMain.on('debug', (event, message) => {
        console.log(message)
    })

    ipcMain.on('bug-report', async () => {
        const os_platform = process.platform || '-'
        const os_arch = process.arch || '-'
        const os_system_version = process.getSystemVersion() || '-'

        const ytmdesktop_version = app.getVersion() || '-'

        const template = `- [ ] I understand that %2A%2AYTMDesktop have NO affiliation with Google or YouTube%2A%2A.%0A- [ ] I verified that there is no open issue for the same subject.%0A%0A %2A%2ADescribe the bug%2A%2A%0A A clear and concise description of what the bug is.%0A%0A %2A%2ATo Reproduce%2A%2A%0A Steps to reproduce the behavior:%0A 1. Go to '...'%0A 2. Click on '....'%0A 3. See error%0A%0A %2A%2AExpected behavior%2A%2A%0A A clear and concise description of what you expected to happen.%0A%0A %2A%2AScreenshots%2A%2A%0A If applicable, add screenshots to help explain your problem.%0A%0A %2A%2AEnvironment:%2A%2A%0A %2A YTMDesktop version: %2A%2A%2Av${ytmdesktop_version} ${commit_hash}%2A%2A%2A%0A %2A OS: %2A%2A%2A${os_platform}%2A%2A%2A%0A %2A OS version: %2A%2A%2A${os_system_version}%2A%2A%2A%0A %2A Arch: %2A%2A%2A${os_arch}%2A%2A%2A%0A %2A Installation way: %2A%2A%2Alike .exe or snapcraft or another way%2A%2A%2A%0A`
        await shell.openExternal(
            `https://github.com/ytmdesktop/ytmdesktop/issues/new?body=${template}`
        )
    })

    ipcMain.on('change-audio-output', (dataMain, dataRenderer) => {
        setAudioOutput(dataRenderer !== undefined ? dataRenderer : dataMain)
    })

    ipcMain.on('change-volume', (dataMain, dataRenderer) => {
        settingsProvider.set('settings-volume', dataRenderer.volume)
    })

    function setAudioOutput(audioLabel) {
        view.webContents
            .executeJavaScript(
                `
                    navigator
                    .mediaDevices
                    .enumerateDevices()
                    .then( devices => {
                        var audioDevices = devices.filter(device => device.kind === 'audiooutput');
                        var result = audioDevices.filter(deviceInfo => deviceInfo.label == "${audioLabel}");
                        if(result.length) {
                            document.querySelector('.video-stream,.html5-main-video').setSinkId(result[0].deviceId);
                        }
                    });
                `
            )
            .then((_) => {
                settingsProvider.set('settings-app-audio-output', audioLabel)
                updateTrayAudioOutputs(audioDevices)
            })
            .catch((_) =>
                writeLog({ type: 'warn', data: 'error setAudioOutput' })
            )
    }

    function loadAudioOutput() {
        if (settingsProvider.get('settings-app-audio-output'))
            setAudioOutput(settingsProvider.get('settings-app-audio-output'))
    }

    function loadCustomCSSApp() {
        const customThemeFile = path.join(
            fileSystem.getAppDataPath(app),
            '/custom/css/app.css'
        )

        if (
            settingsProvider.get('settings-custom-css-app') &&
            fileSystem.checkIfExists(customThemeFile)
        ) {
            removeCustomCssApp()
            view.webContents
                .insertCSS(fileSystem.readFile(customThemeFile).toString())
                .then((key) => {
                    customCSSAppKey = key
                })
        }
    }

    function removeCustomCSSApp() {
        if (customCSSAppKey) view.webContents.removeInsertedCSS(customCSSAppKey)
    }

    function loadCustomCSSPage() {
        const customThemeFile = path.join(
            fileSystem.getAppDataPath(app),
            '/custom/css/page.css'
        )

        if (
            settingsProvider.get('settings-custom-css-page') &&
            fileSystem.checkIfExists(customThemeFile)
        ) {
            if (customCSSPageKey) removeCustomCSSPage()

            view.webContents
                .insertCSS(fileSystem.readFile(customThemeFile).toString())
                .then((key) => {
                    customCSSPageKey = key
                })
        }
    }

    async function removeCustomCSSPage() {
        await view.webContents.removeInsertedCSS(customCSSPageKey)
    }

    function switchClipboardWatcher() {
        logDebug(
            'Switch clipboard watcher: ' +
                settingsProvider.get('settings-clipboard-read')
        )

        if (isClipboardWatcherRunning) {
            // TODO: What is this? Doesn't make much sense
            clipboardWatcher !== null && clipboardWatcher.stop()
            clipboardWatcher = null
            isClipboardWatcherRunning = false
        } else {
            if (settingsProvider.get('settings-clipboard-read')) {
                clipboardWatcher = ClipboardWatcher({
                    watchDelay: 1000,
                    onTextChange: (text) => {
                        let regExp = /(https?:\/\/)(www.)?(music.youtube|youtube|youtu.be).*/
                        let match = text.match(regExp)
                        if (match) {
                            let videoUrl = match[0]

                            if (
                                settingsProvider.get(
                                    'settings-clipboard-always-ask-read'
                                )
                            ) {
                                let options = {
                                    type: 'question',
                                    buttons: ['Yes', 'No'],
                                    defaultId: 0,
                                    title: 'YouTube Music Desktop',
                                    message: `Want to play this link?\n\n${text}`,
                                }

                                dialog
                                    .showMessageBox(mainWindow, options)
                                    .then((success) => {
                                        if (success.response === 0)
                                            loadMusicByUrl(videoUrl)
                                    })
                            } else loadMusicByUrl(videoUrl)

                            writeLog({
                                type: 'info',
                                data:
                                    'Video readed from clipboard: ' + videoUrl,
                            })
                        }
                    },
                })

                isClipboardWatcherRunning = true
            }
        }
    }

    async function loadMusicByUrl(videoUrl) {
        if (videoUrl.includes('music.youtube'))
            await view.webContents.loadURL(videoUrl)
        else {
            let regExpYoutube = /^.*(https?:\/\/)?(www.)?(music.youtube|youtube|youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\?v=)([^#&?]*).*/
            let match = videoUrl.match(regExpYoutube)
            await view.webContents.loadURL(
                'https://music.youtube.com/watch?v=' + match[4]
            )
        }
    }

    setTimeout(() => {
        ipcMain.emit('switch-clipboard-watcher')
    }, 1000)

    loadCustomAppScript()
    loadCustomPageScript()

    if (isWindows()) handleOpenUrl(process.argv.slice(1))
}

function handleOpenUrl(url) {
    const loadMusicByVideoId = ([_, video_id, list_id]) => {
        let url = 'https://music.youtube.com/watch?v=' + video_id
        if (list_id) url += '&list=' + list_id
        if (!infoPlayerProvider.getPlayerInfo().isPaused)
            mediaControl.stopTrack(view)
        view.webContents.loadURL(url).then(() => {
            updateAccentColorPref()
        })
    }
    let cmd = url.toString().split('://')[1]
    if (!cmd) return

    if (cmd.includes('settings/'))
        ipcMain.emit('window', { command: 'show-settings' })

    if (cmd.includes('play/')) {
        loadMusicByVideoId(cmd.split('/'))
        writeLog({ type: 'info', data: JSON.stringify(cmd) })
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) app.quit()
else {
    app.on('second-instance', (event, argv, _) => {
        if (isWindows()) handleOpenUrl(argv.slice(3))

        if (mainWindow) {
            if (mainWindow.isVisible())
                if (mainWindow.isMinimized()) mainWindow.restore()
                else mainWindow.show()

            mainWindow.show()
        }
    })

    app.whenReady().then(async () => {
        checkWindowPosition(
            settingsProvider.get('window-position'),
            settingsProvider.get('window-size')
        )
            .then((visiblePosition) => {
                console.log(visiblePosition)
                settingsProvider.set('window-position', visiblePosition)
            })
            .catch(() => {})

        checkWindowPosition(settingsProvider.get('lyrics-position'), {
            width: 700,
            height: 800,
        })
            .then((visiblePosition) => {
                console.log(visiblePosition)
                settingsProvider.set('lyrics-position', visiblePosition)
            })
            .catch(() => {})

        checkWindowPosition(settingsProvider.get('miniplayer-position'), {
            width: settingsProvider.get('settings-miniplayer-size'),
            height: settingsProvider.get('settings-miniplayer-size'),
        })
            .then((visiblePosition) => {
                console.log(visiblePosition)
                settingsProvider.set('miniplayer-position', visiblePosition)
            })
            .catch(() => {})

        await createWindow()

        tray.createTray(mainWindow)

        ipcMain.on('updated-tray-image', (event, payload) => {
            if (settingsProvider.get('settings-shiny-tray'))
                tray.updateImage(payload)
        })

        if (!isDev) {
            updater.checkUpdate(mainWindow, view)

            setInterval(() => {
                updater.checkUpdate(mainWindow, view)
            }, 24 * 60 * 60 * 1000)
        }

        ipcMain.emit('ready', app)
    })

    app.on('open-url', (event, url) => {
        event.preventDefault()
        handleOpenUrl(url)
    })

    app.on('browser-window-created', (e, window) => {
        window.removeMenu()
    })

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (!isMac()) app.quit()
    })

    app.on('activate', async () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) await createWindow()
        else if (mainWindow.isVisible() && !isMac()) mainWindow.hide()
        else mainWindow.show()
    })

    app.on('before-quit', () => {
        mainWindow = null
        view = null
        if (isMac()) app.exit()

        tray.quit()
    })

    app.on('quit', () => {
        mainWindow = null
        view = null
        tray.quit()
    })
}

// TODO: Should this be removed?
function logDebug(data) {
    /*
    Commented out since it's never going to be ran
    if (false)
        console.log(data);
        */
}

function songInfo() {
    return infoPlayerProvider.getTrackInfo()
}

function playerInfo() {
    return infoPlayerProvider.getPlayerInfo()
}

function getAll() {
    return {
        track: songInfo(),
        player: playerInfo(),
    }
}

// TODO: Unused function
function bytesToSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    if (bytes === 0) return '0 Byte'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i]
}

function createCustomAppDir() {
    if (!fileSystem.checkIfExists(fileSystem.getAppDataPath(app))) {
        isFirstTime = true
        fileSystem.createDir(fileSystem.getAppDataPath(app))
    } else isFirstTime = false
}

function createCustomCSSDir() {
    const dirCustomTheme = path.join(
        fileSystem.getAppDataPath(app),
        '/custom/css'
    )

    if (!fileSystem.checkIfExists(dirCustomTheme))
        fileSystem.createDir(dirCustomTheme, { recursive: true })
}

function createCustomCSSPageFile() {
    const oldCustomThemeFile = path.join(
        fileSystem.getAppDocumentsPath(app),
        '/custom/css/page.css'
    )

    const customThemeFile = path.join(
        fileSystem.getAppDataPath(app),
        '/custom/css/page.css'
    )

    if (!fileSystem.checkIfExists(customThemeFile))
        if (fileSystem.checkIfExists(oldCustomThemeFile))
            fileSystem.writeFile(
                customThemeFile,
                fileSystem.readFile(oldCustomThemeFile)
            )
        else
            fileSystem.writeFile(
                customThemeFile,
                `/** \n * Custom css for page \n*/\n\nhtml, body { background: #1D1D1D !important; }`
            )
}

function loadCustomAppScript() {
    const customAppScriptFile = path.join(
        fileSystem.getAppDataPath(app),
        'custom/js/app.js'
    )

    if (fileSystem.checkIfExists(customAppScriptFile))
        try {
            require(customAppScriptFile)
        } catch (_) {}
}

async function loadCustomPageScript() {
    const customPageScriptFile = path.join(
        fileSystem.getAppDataPath(app),
        'custom/js/page.js'
    )

    if (fileSystem.checkIfExists(customPageScriptFile)) {
        try {
            await view.webContents.executeJavaScript(
                fileSystem.readFile(customPageScriptFile).toString()
            )
        } catch (_) {
            writeLog({ type: 'warn', data: 'Failed to execute page.js' })
        }
    }
}

function registerGlobalShortcut(value, fn) {
    if (value !== 'disabled') {
        try {
            globalShortcut.register(`${value}`, fn)
        } catch (_) {
            writeLog({
                type: 'warn',
                data: `Failed to register global shortcut ${value}`,
            })
        }
    }
}

function updateTrayAudioOutputs(data) {
    try {
        let audioOutputs = JSON.parse(data)
        let selectedAudio = settingsProvider.get('settings-app-audio-output')
        let result = [
            {
                label: __.trans(
                    'LABEL_SETTINGS_TAB_GENERAL_AUDIO_NO_DEVICES_FOUND'
                ),
                enabled: false,
            },
        ]

        if (audioOutputs.length) {
            audioOutputs.forEach((value, index) => {
                audioOutputs[index] = {
                    label: value.label,
                    type: 'radio',
                    checked: value.label === selectedAudio,
                    click: () => {
                        ipcMain.emit('change-audio-output', value.label)
                    },
                }
            })
            result = audioOutputs
        }

        tray.updateTray({ type: 'audioOutputs', data: result })
    } catch (error) {
        writeLog({
            type: 'warn',
            data: 'Failed to updateTrayAudioOutputs ' + error,
        })
    }
}

function updateStatusBar() {
    if (renderer_for_status_bar != null)
        renderer_for_status_bar.send('update-status-bar')
}

function writeLog(log) {
    switch (log.type) {
        case 'info':
            electronLog.info(log.data)
            break

        case 'warn':
            electronLog.warn(log.data)
            break
    }
}

ipcMain.on('log', (dataMain, dataRenderer) => {
    if (dataMain.type !== undefined) writeLog(dataMain)
    else writeLog(dataRenderer)
})

if (settingsProvider.get('settings-companion-server') && gotTheLock)
    companionServer.start()

if (settingsProvider.get('settings-genius-auth-server') && gotTheLock) {
    geniusAuthServer.start()
}

if (settingsProvider.get('settings-rainmeter-web-now-playing'))
    rainmeterNowPlaying.start()

if (settingsProvider.get('settings-discord-rich-presence')) discordRPC.start()

ipcMain.on('set-audio-output-list', (_, data) => {
    updateTrayAudioOutputs(data)
    try {
        // FIXME: For some reason neither the emit/send doesn't work
        if (settingsRendererIPC) {
            settingsRendererIPC.send('update-audio-output-devices', data)
        }
    } catch (e) {}
    audioDevices = data
})

ipcMain.on('set-sleep-timer', (_, data) => {
    let counter = parseInt(data.value)
    const clearSleepTimer = () => {
        if (sleepTimer.mode == 'time') clearInterval(sleepTimer.interval)
        sleepTimer.interval = 0
        sleepTimer.mode = 'off'
    }
    if (counter == 0) {
        clearSleepTimer()
    } else {
        sleepTimer.counter = counter
        if (data.value[data.value.length - 1] == 'c') {
            sleepTimer.mode = 'counter'
        } else {
            sleepTimer.mode = 'time'
            clearInterval(sleepTimer.interval)
            sleepTimer.interval = setInterval(() => {
                sleepTimer.counter -= 1
                if (sleepTimer.counter <= 0) {
                    if (!infoPlayerProvider.getPlayerInfo().isPaused)
                        mediaControl.playPauseTrack(view)
                    clearSleepTimer()
                }
            }, 60 * 1000)
        }
    }
})

ipcMain.on('retrieve-sleep-timer', (e) => {
    e.sender.send('sleep-timer-info', sleepTimer.mode, sleepTimer.counter)
})

ipcMain.handle('get-audio-output-list', (e) => {
    settingsRendererIPC = e.sender
    return audioDevices
})

powerMonitor.on('suspend', () => {
    if (settingsProvider.get('settings-pause-on-suspend')) {
        if (!infoPlayerProvider.getPlayerInfo().isPaused)
            mediaControl.playPauseTrack(view)
    }
})

if (!settingsProvider.get('settings-disable-analytics')) {
    const analytics = require('./src/providers/analyticsProvider')
    analytics.setEvent(
        'main',
        'start',
        'v' + app.getVersion(),
        app.getVersion()
    )
    analytics.setEvent('main', 'os', process.platform, process.platform)
    analytics.setScreen('main')
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require('./src/providers/mediaProvider')
const tray = require('./src/providers/trayProvider')
const updater = require('./src/providers/updateProvider')
const { getTrackInfo } = require('./src/providers/infoPlayerProvider')
const { ipcRenderer } = require('electron/renderer')
//const {UpdaterSignal} = require('electron-updater');
