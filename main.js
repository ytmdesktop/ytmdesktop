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
} = require('electron')
const path = require('path')
const isDev = require('electron-is-dev')
const ClipboardWatcher = require('electron-clipboard-watcher')
const electronLocalshortcut = require('electron-localshortcut')

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

const { calcYTViewSize } = require('./src/utils/calcYTViewSize')
const { isWindows, isMac, isLinux } = require('./src/utils/systemInfo')
const { checkWindowPosition, doBehavior } = require('./src/utils/window')
const fileSystem = require('./src/utils/fileSystem')

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
    doublePressPlayPause,
    updateTrackInfoTimeout

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

createDocumentsAppDir()

createCustomCSSDir()
createCustomCSSPageFile()

if (settingsProvider.get('settings-companion-server')) {
    companionServer.start()
}

if (settingsProvider.get('settings-rainmeter-web-now-playing')) {
    rainmeterNowPlaying.start()
}

if (settingsProvider.get('settings-discord-rich-presence')) {
    discordRPC.start()
}

if (settingsProvider.get('has-updated')) {
    setTimeout(() => {
        console.log('has-updated')
        ipcMain.emit('window', { command: 'show-changelog' })
    }, 2000)
    settingsProvider.set('has-updated', false)
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
            if (renderer_for_status_bar)
                renderer_for_status_bar.send('update-status-bar')
        }
    )
    const menu = Menu.buildFromTemplate(statusBarMenu)
    Menu.setApplicationMenu(menu)
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
    mainWindow.webContents.session.setUserAgent(
        'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0'
    )
    view = new BrowserView({
        webPreferences: {
            nodeIntegration: true,
            webviewTag: true,
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

    mainWindow.on('ready-to-show', () => {
        console.log('show')
    })

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null
    })

    mainWindow.on('show', function () {
        globalShortcut.unregister('CmdOrCtrl+M')

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
            mprisProvider.setRealPlayer(infoPlayerProvider) //this lets us keep track of the current time in playback.
        }

        if (isMac()) {
            global.sharedObj.paused = false
            renderer_for_status_bar.send('update-status-bar')
        }

        if (infoPlayerInterval === undefined) {
            infoPlayerInterval = setInterval(() => {
                if (global.on_the_road) {
                    updateActivity()
                }
            }, 500)
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
        var trackInfo = infoPlayerProvider.getTrackInfo()
        var playerInfo = infoPlayerProvider.getPlayerInfo()
        var trackId = trackInfo.id
        var title = trackInfo.title
        var author = trackInfo.author
        var album = trackInfo.album
        var duration = trackInfo.duration
        var progress = trackInfo.statePercent
        var cover = trackInfo.cover
        var nowPlaying = `${title} - ${author}`
        logDebug(nowPlaying)

        if (title && author) {
            discordRPC.setActivity(getAll())
            rainmeterNowPlaying.setActivity(getAll())
            mprisProvider.setActivity(getAll())

            mediaControl.createThumbar(
                mainWindow,
                infoPlayerProvider.getAllInfo()
            )

            mediaControl.setProgress(
                mainWindow,
                settingsProvider.get('settings-enable-taskbar-progressbar')
                    ? trackInfo.statePercent
                    : -1,
                playerInfo.isPaused
            )

            /**
             * Srobble when track changes or when current track starts from the beginning
             */
            if (settingsProvider.get('settings-last-fm-scrobbler')) {
                if (
                    lastTrackId !== trackId ||
                    (lastTrackProgress > progress && progress < 0.01)
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
             * Update only when change track
             */
            if (lastTrackId !== trackId) {
                lastTrackId = trackId

                if (isMac()) {
                    global.sharedObj.title = nowPlaying
                    renderer_for_status_bar.send('update-status-bar')
                }

                mainWindow.setTitle(nowPlaying)
                tray.setTooltip(nowPlaying)

                if (
                    !mainWindow.isFocused() &&
                    settingsProvider.get('settings-show-notifications')
                ) {
                    tray.balloon(title, author, cover, iconDefault)
                }
            }

            if (!isMac() && !settingsProvider.get('settings-shiny-tray')) {
                if (playerInfo.isPaused) {
                    tray.updateTrayIcon(iconPause)
                } else {
                    tray.updateTrayIcon(iconPlay)
                }
            }

            lastTrackProgress = progress
        }
    }

    view.webContents.on('media-started-playing', function () {
        logDebug('Playing')
        try {
            if (isMac()) {
                renderer_for_status_bar.send('update-status-bar')
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
                renderer_for_status_bar.send('update-status-bar')
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
            mainWindow.hide()
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

    electronLocalshortcut.register(view, 'CmdOrCtrl+M', () => {
        ipcMain.emit('window', { command: 'show-miniplayer' })
    })

    // GLOBAL
    globalShortcut.register('MediaPlayPause', function () {
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

    globalShortcut.register('CmdOrCtrl+Shift+Space', function () {
        mediaControl.playPauseTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+PageUp', function () {
        mediaControl.nextTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+PageDown', function () {
        mediaControl.previousTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+numadd', function () {
        mediaControl.upVote(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+numsub', function () {
        mediaControl.downVote(view)
    })

    ipcMain.on('restore-main-window', function () {
        mainWindow.show()
    })

    ipcMain.handle('invoke-all-info', async (event, args) => {
        return infoPlayerProvider.getAllInfo()
    })

    ipcMain.on('settings-value-changed', (e, data) => {
        switch (data.key) {
            case 'settings-rainmeter-web-now-playing':
                if (data.value) {
                    rainmeterNowPlaying.start()
                } else {
                    rainmeterNowPlaying.stop()
                }
                break

            case 'settings-companion-server':
                if (data.value) {
                    companionServer.start()
                } else {
                    companionServer.stop()
                }
                break

            case 'settings-discord-rich-presence':
                if (data.value) {
                    discordRPC.start()
                } else {
                    discordRPC.stop()
                }
                break

            case 'settings-custom-css-app':
                if (data.value) {
                    loadCustomCSSApp()
                } else {
                    removeCustomCSSApp()
                }
                break

            case 'settings-custom-css-page':
                if (data.value) {
                    loadCustomCSSPage()
                } else {
                    removeCustomCSSPage()
                }
                break

            case 'settings-changed-zoom':
                view.webContents.zoomFactor = data.value / 100
                break
        }
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
        }
    })

    ipcMain.on('register-renderer', (event, arg) => {
        renderer_for_status_bar = event.sender
        event.sender.send('update-status-bar')
        event.sender.send('is-dev', isDev)
    })

    ipcMain.on('update-tray', () => {
        if (isMac()) {
            renderer_for_status_bar.send('update-status-bar')
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
                break

            case 'show-discord-settings':
                windowDiscordSettings()
                break
        }
    })

    function windowSettings() {
        if (settings) {
            settings.show()
        } else {
            settings = new BrowserWindow({
                title: __.trans('LABEL_SETTINGS'),
                icon: iconDefault,
                modal: false,
                frame: windowConfig.frame,
                titleBarStyle: windowConfig.titleBarStyle,
                center: true,
                resizable: true,
                backgroundColor: '#232323',
                width: 900,
                minWidth: 900,
                height: 550,
                minHeight: 550,
                autoHideMenuBar: false,
                skipTaskbar: false,
                webPreferences: {
                    nodeIntegration: true,
                    webviewTag: true,
                },
            })

            settings.loadFile(
                path.join(
                    app.getAppPath(),
                    '/src/pages/shared/window-buttons/window-buttons.html'
                ),
                {
                    search:
                        'page=settings/settings&icon=settings&hide=btn-minimize,btn-maximize',
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
                resizable: false,
                alwaysOnTop: settingsProvider.get(
                    'settings-miniplayer-always-top'
                ),
                backgroundColor: '#000000',
                minWidth: 100,
                minHeight: 100,
                autoHideMenuBar: true,
                skipTaskbar: false,
                webPreferences: {
                    nodeIntegration: true,
                },
            })

            miniplayer.loadFile(
                path.join(
                    app.getAppPath(),
                    '/src/pages/miniplayer/miniplayer.html'
                )
            )

            switch (settingsProvider.get('settings-miniplayer-size')) {
                case '1':
                    miniplayer.setSize(170, 170)
                    break

                case '2':
                    miniplayer.setSize(200, 200)
                    break

                case '3':
                    miniplayer.setSize(230, 230)
                    break

                case '4':
                    miniplayer.setSize(260, 260)
                    break

                case '5':
                    miniplayer.setSize(290, 290)
                    break

                case '6':
                    miniplayer.setSize(320, 320)
                    break

                default:
                    miniplayer.setSize(200, 200)
                    break
            }

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

            mainWindow.hide()

            globalShortcut.register('CmdOrCtrl+M', function () {
                miniplayer.close()
                miniplayer = null
                mainWindow.show()
            })
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
            },
        })

        lastfm.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/last-fm-login&icon=music_note&hide=btn-minimize,btn-maximize',
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
                        'page=lyrics/lyrics&icon=music_note&hide=btn-minimize,btn-maximize',
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
        const x = mainWindow.getPosition()[0]
        const y = mainWindow.getPosition()[1]
        const width = 800
        const settings = new BrowserWindow({
            // parent: mainWindow,
            icon: iconDefault,
            skipTaskbar: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            x: x + width / 2,
            y,
            resizable: false,
            backgroundColor: '#232323',
            width: 800,
            title: 'companionWindowTitle',
            webPreferences: {
                nodeIntegration: false,
            },
            autoHideMenuBar: true,
        })
        settings.loadURL('companionUrl')
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
                partition: `guest-mode-${Date.now()}`,
            },
        })

        incognitoWindow.webContents.session.setUserAgent(
            'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0'
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
            },
        })

        discord.loadFile(
            path.join(
                __dirname,
                './src/pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/discord_settings&icon=settings&title=' +
                    __.trans('LABEL_SETTINGS_DISCORD') +
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
            width: 460,
            height: 650,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
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

        var template = `- [ ] I understand that %2A%2AYTMDesktop have NO affiliation with Google or YouTube%2A%2A.%0A- [ ] I verified that there is no open issue for the same subject.%0A%0A %2A%2ADescribe the bug%2A%2A%0A A clear and concise description of what the bug is.%0A%0A %2A%2ATo Reproduce%2A%2A%0A Steps to reproduce the behavior:%0A 1. Go to '...'%0A 2. Click on '....'%0A 3. See error%0A%0A %2A%2AExpected behavior%2A%2A%0A A clear and concise description of what you expected to happen.%0A%0A %2A%2AScreenshots%2A%2A%0A If applicable, add screenshots to help explain your problem.%0A%0A %2A%2AEnvironment (please complete the following information):%2A%2A%0A %2A YTMDesktop version: %2A%2A%2Av${ytmdesktop_version}%2A%2A%2A%0A %2A OS: %2A%2A%2A${os_platform}%2A%2A%2A%0A %2A OS version: %2A%2A%2A${os_system_version}%2A%2A%2A%0A %2A Arch: %2A%2A%2A${os_arch}%2A%2A%2A%0A %2A Installation way: %2A%2A%2Alike .exe or snapcraft or another way%2A%2A%2A%0A`
        shell.openExternal(
            `https://github.com/ytmdesktop/ytmdesktop/issues/new?body=${template}`
        )
    })

    ipcMain.on('change-audio-output', (event, data) => {
        setAudioOutput(data)
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
            .then((_) => {})
            .catch((_) => console.log('error setAudioOutput'))
    }

    function loadAudioOutput() {
        if (settingsProvider.get('settings-app-audio-output')) {
            setAudioOutput(settingsProvider.get('settings-app-audio-output'))
        }
    }

    function loadCustomCSSApp() {
        const customThemeFile = path.join(
            fileSystem.getAppDocumentsPath(app),
            '/custom/css/app.css'
        )

        if (settingsProvider.get('settings-custom-css-app')) {
            if (fileSystem.checkIfExists(customThemeFile)) {
                if (customCSSAppKey) {
                    removeCustomCssApp()
                }
                view.webContents
                    .insertCSS(fileSystem.readFile(customThemeFile).toString())
                    .then((key) => {
                        customCSSAppKey = key
                    })
            }
        }
    }

    function removeCustomCSSApp() {
        view.webContents.removeInsertedCSS(customCSSAppKey)
    }

    function loadCustomCSSPage() {
        const customThemeFile = path.join(
            fileSystem.getAppDocumentsPath(app),
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
                    onImageChange: function (nativeImage) {},
                    onTextChange: function (text) {
                        let regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\?v=)([^#\&\?]*).*/
                        let match = text.match(regExp)
                        if (match && match[2].length == 11) {
                            let videoId = match[2]
                            logDebug('Video readed from clipboard: ' + videoId)
                            loadMusicByVideoId(videoId)
                        }
                    },
                })

                isClipboardWatcherRunning = true
            }
        }
    }

    function loadMusicByVideoId(videoId) {
        view.webContents.loadURL('https://music.youtube.com/watch?v=' + videoId)
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

    switch (cmd) {
        case 'settings/':
            ipcMain.emit('window', { command: 'show-settings' })
            break
    }
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

    app.whenReady().then(function () {
        checkWindowPosition(settingsProvider.get('window-position')).then(
            (visiblePosition) => {
                settingsProvider.set('window-position', visiblePosition)
            }
        )

        checkWindowPosition(settingsProvider.get('lyrics-position')).then(
            (visiblePosition) => {
                settingsProvider.set('lyrics-position', visiblePosition)
            }
        )

        createWindow()

        tray.createTray(mainWindow, iconTray)

        ipcMain.on('updated-tray-image', function (event, payload) {
            if (settingsProvider.get('settings-shiny-tray'))
                tray.updateImage(payload)
        })

        if (!isDev) {
            updater.checkUpdate(mainWindow, view)

            setInterval(function () {
                updater.checkUpdate(mainWindow, view)
            }, 6 * 60 * 60 * 1000)
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
        if (isMac()) {
            app.exit()
        }
        tray.quit()
    })

    app.on('quit', function () {
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

function createDocumentsAppDir() {
    if (!fileSystem.checkIfExists(fileSystem.getAppDocumentsPath(app))) {
        isFirstTime = true
        fileSystem.createDir(fileSystem.getAppDocumentsPath(app))
    } else {
        isFirstTime = false
    }
}

function createCustomCSSDir() {
    const dirCustomTheme = path.join(
        fileSystem.getAppDocumentsPath(app),
        '/custom/css'
    )

    if (!fileSystem.checkIfExists(dirCustomTheme)) {
        fileSystem.createDir(dirCustomTheme, { recursive: true })
    }
}

function createCustomCSSPageFile() {
    const customThemeFile = path.join(
        fileSystem.getAppDocumentsPath(app),
        '/custom/css/page.css'
    )

    if (!fileSystem.checkIfExists(customThemeFile)) {
        fileSystem.writeFile(
            customThemeFile,
            `/** \n * Custom css for page \n*/\n\nhtml, body { background: #1D1D1D !important; }`
        )
    }
}

function loadCustomAppScript() {
    const customAppScriptFile = path.join(
        fileSystem.getAppDocumentsPath(app),
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
        fileSystem.getAppDocumentsPath(app),
        'custom/js/page.js'
    )

    if (fileSystem.checkIfExists(customPageScriptFile)) {
        try {
            view.webContents.executeJavaScript(
                fileSystem.readFile(customPageScriptFile).toString()
            )
        } catch {
            console.log('Failed to execute page.js')
        }
    }
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require('./src/providers/mediaProvider')
const tray = require('./src/providers/trayProvider')
const updater = require('./src/providers/updateProvider')
const analytics = require('./src/providers/analyticsProvider')

analytics.setEvent('main', 'start', 'v' + app.getVersion(), app.getVersion())
analytics.setEvent('main', 'os', process.platform, process.platform)
analytics.setScreen('main')
