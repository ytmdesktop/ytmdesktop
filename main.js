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
    session,
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

const __ = require('./src/providers/translateProvider')
const assetsProvider = require('./src/providers/assetsProvider')
const scrobblerProvider = require('./src/providers/scrobblerProvider')
const { statusBarMenu } = require('./src/providers/templateProvider')
const settingsProvider = require('./src/providers/settingsProvider')
const infoPlayerProvider = require('./src/providers/infoPlayerProvider')
const rainmeterNowPlaying = require('./src/providers/rainmeterNowPlaying')
const companionServer = require('./src/providers/companionServer')
const discordRPC = require('./src/providers/discordRpcProvider')
const mprisProvider = require('./src/providers/mprisProvider')
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
    windowsMediaProvider,
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

global.sharedObj = { title: 'N/A', paused: true }

let iconDefault = assetsProvider.getIcon('favicon')
let iconTray = assetsProvider.getIcon('trayTemplate')
let iconPlay = assetsProvider.getIcon('favicon_play')
let iconPause = assetsProvider.getIcon('favicon_pause')
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

/* First checks ========================================================================= */
app.commandLine.appendSwitch('disable-features', 'MediaSessionService') //This keeps chromium from trying to launch up it's own mpris service, hence stopping the double service.

app.setAsDefaultProtocolClient('ytmd', process.execPath)

createCustomAppDir()

createCustomCSSDir()
createCustomCSSPageFile()

if (settingsProvider.get('has-updated') == true) {
    setTimeout(() => {
        writeLog({ type: 'info', data: 'YTMDesktop updated' })
        ipcMain.emit('window', { command: 'show-changelog' })
    }, 2000)
}

if (
    isWindows() &&
    os.release().startsWith('10.') &&
    settingsProvider.get('settings-windows10-media-service')
) {
    try {
        windowsMediaProvider = require('./src/providers/windowsMediaProvider')
    } catch (error) {
        console.log('error windowsMediaProvider > ' + error)
    }
}

if (isLinux()) {
    mprisProvider.start()
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

if (settingsProvider.get('settings-disable-hardware-acceleration')) {
    app.disableHardwareAcceleration()
}

/* Functions ============================================================================= */
function createWindow() {
    if (isMac() || isWindows()) {
        const execApp = path.basename(process.execPath)
        const startArgs = ['--processStart', `"${execApp}"`]
        const startOnBoot = settingsProvider.get('settings-start-on-boot')
        if (startOnBoot) {
            app.setLoginItemSettings({
                openAtLogin: true,
                path: process.execPath,
                args: startArgs,
            })
        } else {
            app.setLoginItemSettings({
                openAtLogin: false,
                args: startArgs,
            })
        }
    }
    windowSize = settingsProvider.get('window-size')
    windowMaximized = settingsProvider.get('window-maximized')
    windowMinimized = settingsProvider.get('settings-start-minimized')

    if (windowSize) {
        mainWindowParams.width = windowSize.width
        mainWindowParams.height = windowSize.height
    } else {
        let electronScreen = screen
        let size = electronScreen.getPrimaryDisplay().workAreaSize

        mainWindowParams.width = size.width - 150
        mainWindowParams.height = size.height - 150
    }

    browserWindowConfig = {
        icon: iconDefault,
        width: mainWindowParams.width,
        height: mainWindowParams.height,
        minWidth: 300,
        minHeight: 300,
        show: windowMinimized ? false : true,
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
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0',
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

    mainWindow.loadFile(
        path.join(
            app.getAppPath(),
            '/src/pages/shared/window-buttons/window-buttons.html'
        ),
        { search: 'page=home/home' }
    )

    mainWindow.addBrowserView(view)

    view.setBounds(calcYTViewSize(settingsProvider, mainWindow))

    if (
        settingsProvider.get('settings-continue-where-left-of') &&
        settingsProvider.get('window-url')
    ) {
        mainWindowParams.url = settingsProvider.get('window-url')
    }

    view.webContents.loadURL(mainWindowParams.url)

    // Open the DevTools.
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
    // view.webContents.openDevTools({ mode: 'detach' })

    mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())

    if (windowMaximized) {
        setTimeout(function () {
            mainWindow.send('window-is-maximized', true)
            view.setBounds(calcYTViewSize(settingsProvider, mainWindow))
            mainWindow.maximize()
        }, 700)
    } else {
        let position = settingsProvider.get('window-position')
        if (position != undefined) {
            mainWindow.setPosition(position.x, position.y)
        }
    }

    mainWindow.on('closed', function () {
        view = null
        mainWindow = null
    })

    mainWindow.on('show', function () {
        mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())
    })

    view.webContents.on('new-window', function (event, url) {
        event.preventDefault()
        shell.openExternal(url)
    })

    // view.webContents.openDevTools({ mode: 'detach' });
    view.webContents.on('did-navigate-in-page', function () {
        initialized = true
        settingsProvider.set('window-url', view.webContents.getURL())
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

    view.webContents.on('media-started-playing', function () {
        if (!infoPlayerProvider.hasInitialized()) {
            infoPlayerProvider.init(view)
            if (isLinux()) {
                mprisProvider.setRealPlayer(infoPlayerProvider) //this lets us keep track of the current time in playback.
            }
        }

        if (
            isWindows() &&
            os.release().startsWith('10.') &&
            settingsProvider.get('settings-windows10-media-service') &&
            windowsMediaProvider != undefined
        ) {
            windowsMediaProvider.init(view)
        }

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
                if (hostname != 'music.youtube.com') {
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
        var playerInfo = infoPlayerProvider.getPlayerInfo()
        var trackInfo = infoPlayerProvider.getTrackInfo()

        var progress = playerInfo.statePercent
        var seekbarCurrentPosition = playerInfo.seekbarCurrentPosition
        var trackId = trackInfo.id
        var title = trackInfo.title
        var author = trackInfo.author
        var album = trackInfo.album
        var duration = trackInfo.duration
        var cover = trackInfo.cover
        var nowPlaying = `${title} - ${author}`

        if (title && author) {
            rainmeterNowPlaying.setActivity(getAll())
            mprisProvider.setActivity(getAll())

            mediaControl.setProgress(
                mainWindow,
                settingsProvider.get('settings-enable-taskbar-progressbar')
                    ? progress
                    : -1,
                playerInfo.isPaused
            )

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
            ) {
                discordRPC.setActivity(getAll())
            }

            /**
             * Update only when change track
             */
            if (lastTrackId !== trackId) {
                lastTrackId = trackId

                setTimeout(() => {
                    if (
                        settingsProvider.get('settings-skip-track-disliked') &&
                        infoPlayerProvider.getPlayerInfo().likeStatus ==
                            'DISLIKE'
                    ) {
                        mediaControl.nextTrack(view)
                    }

                    if (
                        infoPlayerProvider.getTrackInfo().duration <
                        parseInt(
                            settingsProvider.get(
                                'settings-skip-track-shorter-than'
                            )
                        )
                    ) {
                        mediaControl.nextTrack(view)
                    }
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
                ) {
                    tray.balloon(title, author, cover, iconDefault)
                }

                if (
                    isWindows() &&
                    os.release().startsWith('10.') &&
                    settingsProvider.get('settings-windows10-media-service') &&
                    windowsMediaProvider != undefined
                ) {
                    windowsMediaProvider.setPlaybackData(
                        title,
                        author,
                        cover,
                        album
                    )
                }

                writeLog({ type: 'info', data: `Listen: ${title} - ${author}` })
                discordRPC.setActivity(getAll())
            }

            /**
             * Update only when change state play/pause
             */
            if (lastIsPaused != playerInfo.isPaused) {
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

                if (
                    isWindows() &&
                    os.release().startsWith('10.') &&
                    settingsProvider.get('settings-windows10-media-service') &&
                    windowsMediaProvider != undefined
                ) {
                    windowsMediaProvider.setPlaybackStatus(playerInfo.isPaused)
                }
            }

            if (activityLikeStatus != playerInfo.likeStatus) {
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

    view.webContents.on('media-started-playing', function () {
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
        } catch {}
    })

    view.webContents.on('media-paused', function () {
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
        } catch {}
    })

    mainWindow.on('resize', function () {
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
    mainWindow.on('move', function (e) {
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

    mainWindow.on('close', function (e) {
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
        return
    })

    // LOCAL
    electronLocalshortcut.register(
        view,
        isMac() ? 'Cmd+,' : 'CmdOrCtrl+S',
        () => {
            ipcMain.emit('window', { command: 'show-settings' })
        }
    )

    // GLOBAL
    ipcMain.on('change-accelerator', (dataMain, dataRenderer) => {
        if (dataMain.type != undefined) {
            args = dataMain
        } else {
            args = dataRenderer
        }

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
                        infoPlayerProvider.getPlayerInfo().likeStatus != 'LIKE'
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
                        infoPlayerProvider.getPlayerInfo().likeStatus !=
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
                    } catch {
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

    globalShortcut.register('MediaPlayPause', function () {
        checkDoubleTapPlayPause()
    })

    globalShortcut.register('MediaStop', function () {
        mediaControl.stopTrack(view)
    })

    globalShortcut.register('MediaPreviousTrack', function () {
        mediaControl.previousTrack(view)
    })

    globalShortcut.register('MediaNextTrack', function () {
        mediaControl.nextTrack(view)
    })

    ipcMain.handle('invoke-all-info', async (event, args) => {
        return infoPlayerProvider.getAllInfo()
    })

    settingsProvider.onDidChange(
        'settings-rainmeter-web-now-playing',
        (data) => {
            if (data.newValue) {
                rainmeterNowPlaying.start()
            } else {
                rainmeterNowPlaying.stop()
            }
        }
    )

    settingsProvider.onDidChange('settings-companion-server', (data) => {
        if (data.newValue) {
            companionServer.start()
        } else {
            companionServer.stop()
        }
    })

    settingsProvider.onDidChange('settings-discord-rich-presence', (data) => {
        if (data.newValue) {
            discordRPC.start()
        } else {
            discordRPC.stop()
        }
    })

    settingsProvider.onDidChange('settings-custom-css-app', (data) => {
        if (data.newValue) {
            loadCustomCSSApp()
        } else {
            removeCustomCSSApp()
        }
    })

    settingsProvider.onDidChange('settings-custom-css-page', (data) => {
        if (data.newValue) {
            loadCustomCSSPage()
        } else {
            removeCustomCSSPage()
        }
    })

    settingsProvider.onDidChange('settings-page-zoom', (data) => {
        view.webContents.zoomFactor = data.newValue / 100
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
                if (infoPlayerProvider.getTrackInfo().id == '') {
                    infoPlayerProvider.firstPlay(view.webContents)
                }
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

    ipcMain.on('register-renderer', (event, arg) => {
        renderer_for_status_bar = event.sender
        event.sender.send('update-status-bar')
        event.sender.send('is-dev', isDev)
    })

    ipcMain.on('update-tray', () => {
        if (isMac()) {
            updateStatusBar()
            tray.setShinyTray()
        }
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
                } catch {}
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
                if (infoPlayerProvider.getTrackInfo().id == '') {
                    infoPlayerProvider.firstPlay(view.webContents)
                }

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
        } else {
            mediaControl.playPauseTrack(view)
        }
    }

    function windowSettings() {
        if (settings) {
            settings.show()
        } else {
            var mainWindowPosition = mainWindow.getPosition()
            var mainWindowSize = mainWindow.getSize()

            var xPos = mainWindowPosition[0] + mainWindowSize[0] / 4
            var yPos = mainWindowPosition[1] + 200

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
                },
            })

            settings.loadFile(
                path.join(
                    app.getAppPath(),
                    '/src/pages/shared/window-buttons/window-buttons.html'
                ),
                {
                    search:
                        'page=settings/settings&icon=settings&hide=btn-minimize,btn-maximize&title=' +
                        __.trans('LABEL_SETTINGS'),
                }
            )
        }

        settings.on('closed', function () {
            settings = null
        })
    }

    function windowMiniplayer() {
        if (miniplayer) {
            miniplayer.show()
        } else {
            miniplayer = new BrowserWindow({
                title: __.trans('LABEL_MINIPLAYER'),
                icon: iconDefault,
                modal: false,
                frame: false,
                center: false,
                resizable: settingsProvider.get(
                    'settings-miniplayer-resizable'
                ),
                alwaysOnTop: settingsProvider.get(
                    'settings-miniplayer-always-top'
                ),
                width: settingsProvider.get('settings-miniplayer-size'),
                height: settingsProvider.get('settings-miniplayer-size'),
                backgroundColor: '#232323',
                minWidth: 100,
                minHeight: 100,
                autoHideMenuBar: true,
                skipTaskbar: !settingsProvider.get(
                    'settings-miniplayer-show-task'
                ),
                webPreferences: {
                    nodeIntegration: true,
                    enableRemoteModule: true,
                },
            })

            miniplayer.loadFile(
                path.join(
                    app.getAppPath(),
                    '/src/pages/miniplayer/miniplayer.html'
                )
            )

            let miniplayerPosition = settingsProvider.get('miniplayer-position')
            if (miniplayerPosition != undefined) {
                miniplayer.setPosition(
                    miniplayerPosition.x,
                    miniplayerPosition.y
                )
            }

            let storeMiniplayerPositionTimer
            miniplayer.on('move', function (e) {
                let position = miniplayer.getPosition()
                if (storeMiniplayerPositionTimer) {
                    clearTimeout(storeMiniplayerPositionTimer)
                }
                storeMiniplayerPositionTimer = setTimeout(() => {
                    settingsProvider.set('miniplayer-position', {
                        x: position[0],
                        y: position[1],
                    })
                }, 1000)
            })

            let storeMiniplayerSizeTimer
            miniplayer.on('resize', function (e) {
                try {
                    let size = miniplayer.getSize()
                    if (storeMiniplayerSizeTimer) {
                        clearTimeout(storeMiniplayerSizeTimer)
                    }
                    storeMiniplayerSizeTimer = setTimeout(() => {
                        settingsProvider.set(
                            'settings-miniplayer-size',
                            Math.min(...size)
                        )
                        miniplayer.setSize(Math.min(...size), Math.min(...size))
                    }, 500)
                } catch {
                    writeLog({ type: 'warn', data: 'error miniplayer resize' })
                }
            })

            mainWindow.hide()
        }
    }

    function windowLastFmLogin() {
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

        lastfm.loadFile(
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

    function windowThemeEditor() {
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

        editor.loadFile(
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

    function windowLyrics() {
        if (lyrics) {
            lyrics.show()
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
                webPreferences: {
                    nodeIntegration: true,
                    webviewTag: true,
                    enableRemoteModule: true,
                },
            })

            let lyricsPosition = settingsProvider.get('lyrics-position')
            if (lyricsPosition != undefined) {
                lyrics.setPosition(lyricsPosition.x, lyricsPosition.y)
            }

            lyrics.loadFile(
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
            lyrics.on('move', function (e) {
                let position = lyrics.getPosition()
                if (storeLyricsPositionTimer) {
                    clearTimeout(storeLyricsPositionTimer)
                }
                storeLyricsPositionTimer = setTimeout(() => {
                    settingsProvider.set('lyrics-position', {
                        x: position[0],
                        y: position[1],
                    })
                }, 500)
            })

            lyrics.on('closed', function () {
                lyrics = null
            })

            // lyrics.webContents.openDevTools();
        }
    }

    function windowCompanion() {
        shell.openExternal(`http://localhost:9863`)
        return
        //const x = mainWindow.getPosition()[0]
        //const y = mainWindow.getPosition()[1]

        let size = screen.getPrimaryDisplay().workAreaSize

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
        })
        settings.loadURL('http://localhost:9863')
    }

    function windowGuest() {
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

        incognitoWindow.webContents.loadURL(mainWindowParams.url)
    }

    function windowDiscordSettings() {
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

        discord.loadFile(
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

    function windowShortcutButtonsSettings() {
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

        discord.loadFile(
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

    function windowChangelog() {
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

        changelog.loadFile(
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

    ipcMain.on('miniplayer-toggle-ontop', function () {
        miniplayer.setAlwaysOnTop(!miniplayer.isAlwaysOnTop())
    })

    ipcMain.on('reset-url', () => {
        mainWindowParams.url = defaultUrl

        const options = { extraHeaders: 'pragma: no-cache\n' }
        view.webContents.loadURL(mainWindowParams.url, options)
    })

    ipcMain.on('update-custom-css-page', function () {
        loadCustomCSSPage()
    })

    ipcMain.on('debug', (event, message) => {
        console.log(message)
    })

    ipcMain.on('bug-report', (event, message) => {
        var os_platform = process.platform || '-'
        var os_arch = process.arch || '-'
        var os_system_version = process.getSystemVersion() || '-'

        var ytmdesktop_version = app.getVersion() || '-'

        var template = `- [ ] I understand that %2A%2AYTMDesktop have NO affiliation with Google or YouTube%2A%2A.%0A- [ ] I verified that there is no open issue for the same subject.%0A%0A %2A%2ADescribe the bug%2A%2A%0A A clear and concise description of what the bug is.%0A%0A %2A%2ATo Reproduce%2A%2A%0A Steps to reproduce the behavior:%0A 1. Go to '...'%0A 2. Click on '....'%0A 3. See error%0A%0A %2A%2AExpected behavior%2A%2A%0A A clear and concise description of what you expected to happen.%0A%0A %2A%2AScreenshots%2A%2A%0A If applicable, add screenshots to help explain your problem.%0A%0A %2A%2AEnvironment:%2A%2A%0A %2A YTMDesktop version: %2A%2A%2Av${ytmdesktop_version}%2A%2A%2A%0A %2A OS: %2A%2A%2A${os_platform}%2A%2A%2A%0A %2A OS version: %2A%2A%2A${os_system_version}%2A%2A%2A%0A %2A Arch: %2A%2A%2A${os_arch}%2A%2A%2A%0A %2A Installation way: %2A%2A%2Alike .exe or snapcraft or another way%2A%2A%2A%0A`
        shell.openExternal(
            `https://github.com/ytmdesktop/ytmdesktop/issues/new?body=${template}`
        )
    })

    ipcMain.on('change-audio-output', (dataMain, dataRenderer) => {
        setAudioOutput(dataRenderer !== undefined ? dataRenderer : dataMain)
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
        if (settingsProvider.get('settings-app-audio-output')) {
            setAudioOutput(settingsProvider.get('settings-app-audio-output'))
        }
    }

    function loadCustomCSSApp() {
        const customThemeFile = path.join(
            fileSystem.getAppDataPath(app),
            '/custom/css/app.css'
        )

        if (settingsProvider.get('settings-custom-css-app')) {
            if (fileSystem.checkIfExists(customThemeFile)) {
                removeCustomCssApp()
                view.webContents
                    .insertCSS(fileSystem.readFile(customThemeFile).toString())
                    .then((key) => {
                        customCSSAppKey = key
                    })
            }
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

        if (settingsProvider.get('settings-custom-css-page')) {
            if (fileSystem.checkIfExists(customThemeFile)) {
                if (customCSSPageKey) {
                    removeCustomCSSPage()
                }
                view.webContents
                    .insertCSS(fileSystem.readFile(customThemeFile).toString())
                    .then((key) => {
                        customCSSPageKey = key
                    })
            }
        }
    }

    function removeCustomCSSPage() {
        view.webContents.removeInsertedCSS(customCSSPageKey)
    }

    function switchClipboardWatcher() {
        logDebug(
            'Switch clipboard watcher: ' +
                settingsProvider.get('settings-clipboard-read')
        )

        if (isClipboardWatcherRunning) {
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
                                        if (success.response == 0) {
                                            loadMusicByUrl(videoUrl)
                                        }
                                    })
                            } else {
                                loadMusicByUrl(videoUrl)
                            }
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

    function loadMusicByUrl(videoUrl) {
        if (videoUrl.includes('music.youtube')) {
            view.webContents.loadUrl(videoUrl)
        } else {
            let regExpYoutube = /^.*(https?:\/\/)?(www.)?(music.youtube|youtube|youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\?v=)([^#\&\?]*).*/
            let match = videoUrl.match(regExpYoutube)
            view.webContents.loadURL(
                'https://music.youtube.com/watch?v=' + match[4]
            )
        }
    }

    setTimeout(function () {
        ipcMain.emit('switch-clipboard-watcher')
    }, 1000)

    loadCustomAppScript()
    loadCustomPageScript()

    if (isWindows()) {
        handleOpenUrl(process.argv.slice(1))
    }
}

function handleOpenUrl(url) {
    let cmd = url.toString().split('://')[1]

    if (cmd) {
        if (cmd.includes('settings/')) {
            ipcMain.emit('window', { command: 'show-settings' })
        }

        if (cmd.includes('play/')) {
            loadMusicByVideoId(cmd.split('/')[1])
            writeLog({ type: 'info', data: JSON.stringify(cmd) })
        }
    }
}

function loadAdExtension(name) {
    if (!name) throw new Error('Unprovided extension folder name.')

    const extensionPath = isDev
        ? path.resolve(app.getAppPath(), 'src', name)
        : path.resolve(app.getAppPath(), '..', name)

    session.defaultSession.loadExtension(extensionPath).then((data) => {
        writeLog({
            type: 'info',
            data: `Auto skip extension loaded. ID: ${data.id}`,
        })
    })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, argv, workingDirectory) => {
        if (isWindows()) {
            handleOpenUrl(argv.slice(3))
        }
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore()
                }
            } else {
                mainWindow.show()
            }
            mainWindow.focus()
        }
    })

    app.whenReady().then(async function () {
        if (settingsProvider.get('settings-auto-skipad'))
            loadAdExtension('adblock')

        checkWindowPosition(settingsProvider.get('window-position')).then(
            (visiblePosition) => {
                console.log(visiblePosition)
                settingsProvider.set('window-position', visiblePosition)
            }
        )

        checkWindowPosition(settingsProvider.get('lyrics-position')).then(
            (visiblePosition) => {
                console.log(visiblePosition)
                settingsProvider.set('lyrics-position', visiblePosition)
            }
        )

        createWindow()

        tray.createTray(mainWindow)

        ipcMain.on('updated-tray-image', function (event, payload) {
            if (settingsProvider.get('settings-shiny-tray'))
                tray.updateImage(payload)
        })

        if (!isDev) {
            updater.checkUpdate(mainWindow, view)

            setInterval(function () {
                updater.checkUpdate(mainWindow, view)
            }, 24 * 60 * 60 * 1000)
        }

        ipcMain.emit('ready', app)
    })

    app.on('open-url', function (event, url) {
        event.preventDefault()
        handleOpenUrl(url)
    })

    app.on('browser-window-created', function (e, window) {
        window.removeMenu()
    })

    // Quit when all windows are closed.
    app.on('window-all-closed', function () {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (!isMac()) {
            app.quit()
        }
    })

    app.on('activate', function () {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) {
            createWindow()
        } else {
            mainWindow.isVisible() && !isMac()
                ? mainWindow.hide()
                : mainWindow.show()
        }
    })

    app.on('before-quit', function (e) {
        mainWindow = null
        view = null
        if (isMac()) {
            app.exit()
        }
        tray.quit()
    })

    app.on('quit', function () {
        mainWindow = null
        view = null
        tray.quit()
    })
}

function logDebug(data) {
    if (false) {
        console.log(data)
    }
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

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    if (bytes == 0) return '0 Byte'
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)))
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i]
}

function createCustomAppDir() {
    if (!fileSystem.checkIfExists(fileSystem.getAppDataPath(app))) {
        isFirstTime = true
        fileSystem.createDir(fileSystem.getAppDataPath(app))
    } else {
        isFirstTime = false
    }
}

function createCustomCSSDir() {
    const dirCustomTheme = path.join(
        fileSystem.getAppDataPath(app),
        '/custom/css'
    )

    if (!fileSystem.checkIfExists(dirCustomTheme)) {
        fileSystem.createDir(dirCustomTheme, { recursive: true })
    }
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

    if (!fileSystem.checkIfExists(customThemeFile)) {
        if (fileSystem.checkIfExists(oldCustomThemeFile)) {
            fileSystem.writeFile(
                customThemeFile,
                fileSystem.readFile(oldCustomThemeFile)
            )
        } else {
            fileSystem.writeFile(
                customThemeFile,
                `/** \n * Custom css for page \n*/\n\nhtml, body { background: #1D1D1D !important; }`
            )
        }
    }
}

function loadCustomAppScript() {
    const customAppScriptFile = path.join(
        fileSystem.getAppDataPath(app),
        'custom/js/app.js'
    )

    if (fileSystem.checkIfExists(customAppScriptFile)) {
        try {
            require(customAppScriptFile)
        } catch {}
    }
}

function loadCustomPageScript() {
    const customPageScriptFile = path.join(
        fileSystem.getAppDataPath(app),
        'custom/js/page.js'
    )

    if (fileSystem.checkIfExists(customPageScriptFile)) {
        try {
            view.webContents.executeJavaScript(
                fileSystem.readFile(customPageScriptFile).toString()
            )
        } catch {
            writeLog({ type: 'warn', data: 'Failed to execute page.js' })
        }
    }
}

function registerGlobalShortcut(value, fn) {
    if (value != 'disabled') {
        try {
            globalShortcut.register(`${value}`, fn)
        } catch {
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
                    checked: value.label == selectedAudio ? true : false,
                    click: function () {
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
    if (renderer_for_status_bar != null) {
        renderer_for_status_bar.send('update-status-bar')
    }
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
    if (dataMain.type !== undefined) {
        writeLog(dataMain)
    } else {
        writeLog(dataRenderer)
    }
})

if (settingsProvider.get('settings-companion-server')) {
    companionServer.start()
}

if (settingsProvider.get('settings-rainmeter-web-now-playing')) {
    rainmeterNowPlaying.start()
}

if (settingsProvider.get('settings-discord-rich-presence')) {
    discordRPC.start()
}

ipcMain.on('set-audio-output-list', (_, data) => {
    updateTrayAudioOutputs(data)
    audioDevices = data
})

ipcMain.handle('get-audio-output-list', (event, someArgument) => {
    return audioDevices
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require('./src/providers/mediaProvider')
const tray = require('./src/providers/trayProvider')
const updater = require('./src/providers/updateProvider')
const analytics = require('./src/providers/analyticsProvider')

analytics.setEvent('main', 'start', 'v' + app.getVersion(), app.getVersion())
analytics.setEvent('main', 'os', process.platform, process.platform)
analytics.setScreen('main')
