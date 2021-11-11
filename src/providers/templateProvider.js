const { ipcMain } = require('electron')
const { doBehavior } = require('../utils/window')

let statusBarMenu = [
    {
        label: 'Edit',
        submenu: [
            {
                role: 'undo',
            },
            {
                role: 'redo',
            },
            {
                type: 'separator',
            },
            {
                role: 'cut',
            },
            {
                role: 'copy',
            },
            {
                role: 'paste',
            },
            {
                role: 'pasteandmatchstyle',
            },
            {
                role: 'delete',
            },
            {
                role: 'selectall',
            },
            {
                type: 'separator',
            },
            {
                label: 'Speech',
                submenu: [
                    {
                        role: 'startspeaking',
                    },
                    {
                        role: 'stopspeaking',
                    },
                ],
            },
        ],
    },
    {
        label: 'View',
        submenu: [
            {
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
                click(item, focusedWindow) {
                    focusedWindow.emit('reload')
                    if (focusedWindow) focusedWindow.reload()
                },
            },
            {
                label: 'Toggle Developer Tools',
                accelerator:
                    process.platform === 'darwin'
                        ? 'Alt+Command+I'
                        : 'Ctrl+Shift+I',
                click(item, focusedWindow) {
                    if (focusedWindow)
                        focusedWindow.webContents.toggleDevTools()
                },
            },
            {
                type: 'separator',
            },
            {
                role: 'resetzoom',
            },
            {
                role: 'zoomin',
            },
            {
                role: 'zoomout',
            },
            {
                type: 'separator',
            },
            {
                role: 'togglefullscreen',
            },
        ],
    },
    {
        label: 'History',
        submenu: [
            {
                label: 'Home(YouTube Music)',
                accelerator: 'CmdOrCtrl+H',
                async click(item, focusedWindow) {
                    if (focusedWindow)
                        await focusedWindow
                            .getBrowserView()
                            .webContents.loadURL('https://music.youtube.com')
                },
            },
            {
                type: 'separator',
            },
            {
                label: 'Back',
                accelerator: 'CmdOrCtrl+[',
                click(item, focusedWindow) {
                    if (focusedWindow)
                        if (
                            focusedWindow
                                .getBrowserView()
                                .webContents.canGoBack()
                        )
                            focusedWindow.getBrowserView().webContents.goBack()
                },
            },
            {
                label: 'Forward',
                accelerator: 'CmdOrCtrl+]',
                click(item, focusedWindow) {
                    if (focusedWindow)
                        if (
                            focusedWindow
                                .getBrowserView()
                                .webContents.canGoForward()
                        )
                            focusedWindow
                                .getBrowserView()
                                .webContents.goForward()
                },
            },
        ],
    },
    {
        role: 'window',
        submenu: [
            {
                label: 'Close',
                accelerator: 'CmdOrCtrl+W',
                role: 'close',
            },
            {
                label: 'Minimize',
                accelerator: 'CmdOrCtrl+M',
                role: 'minimize',
            },
            {
                label: 'Zoom',
                role: 'zoom',
            },
            {
                type: 'separator',
            },
            {
                label: 'Bring All to Front',
                role: 'front',
            },
        ],
    },
    {
        role: 'help',
        submenu: [
            {
                label: 'Learn More',
                async click() {
                    await require('electron').shell.openExternal(
                        'http://electron.atom.io'
                    )
                },
            },
        ],
    },
]
statusBarMenu.unshift({
    label: 'YouTube Music Desktop',
    submenu: [
        {
            role: 'about',
        },
        {
            type: 'separator',
        },
        {
            role: 'services',
            submenu: [],
        },
        {
            type: 'separator',
        },
        {
            role: 'hide',
        },
        {
            role: 'hideothers',
        },
        {
            role: 'unhide',
        },
        {
            type: 'separator',
        },
        {
            role: 'quit',
        },
    ],
})

const popUpMenu = (__, saved_mainWindow, mediaControl, app) => {
    return [
        {
            label: 'YouTube Music Desktop',
            type: 'normal',
            click: () => {
                doBehavior(saved_mainWindow)
            },
        },

        { type: 'separator' },

        {
            label: __.trans('MEDIA_CONTROL_PLAY_PAUSE'),
            type: 'normal',
            click: () => {
                mediaControl.playPauseTrack(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_PREVIOUS'),
            type: 'normal',
            click: () => {
                mediaControl.previousTrack(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_NEXT'),
            type: 'normal',
            click: () => {
                mediaControl.nextTrack(saved_mainWindow.getBrowserView())
            },
        },

        { type: 'separator' },

        {
            label: __.trans('MEDIA_CONTROL_THUMBS_UP'),
            type: 'normal',
            click: () => {
                mediaControl.upVote(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_THUMBS_DOWN'),
            type: 'normal',
            click: () => {
                mediaControl.downVote(saved_mainWindow.getBrowserView())
            },
        },

        { type: 'separator' },

        {
            label: __.trans('LABEL_MINIPLAYER'),
            type: 'normal',
            click: () => {
                ipcMain.emit('window', { command: 'show-miniplayer' })
            },
        },

        {
            label: __.trans('LABEL_LYRICS'),
            type: 'normal',
            click: () => {
                ipcMain.emit('window', { command: 'show-lyrics' })
            },
        },

        {
            label: __.trans('LABEL_SETTINGS_TAB_GENERAL_SELECT_AUDIO_OUTPUT'),
            type: 'submenu',
            submenu: [],
        },

        {
            label: __.trans('LABEL_SETTINGS'),
            type: 'normal',
            click: () => {
                ipcMain.emit('window', { command: 'show-settings' })
            },
        },

        { type: 'separator' },

        {
            label: __.trans('LABEL_GUEST'),
            type: 'normal',
            click: () => {
                ipcMain.emit('window', { command: 'show-guest-mode' })
            },
        },

        { type: 'separator' },

        {
            label: __.trans('LABEL_EXIT'),
            type: 'normal',
            click: () => {
                app.exit()
            },
        },
    ]
}

module.exports = {
    statusBarMenu: statusBarMenu,
    popUpMenu: popUpMenu,
}
