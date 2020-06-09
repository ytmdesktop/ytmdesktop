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
                label: 'Home(YTMusic)',
                accelerator: 'CmdOrCtrl+H',
                click(item, focusedWindow) {
                    if (focusedWindow)
                        focusedWindow
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
                click() {
                    require('electron').shell.openExternal(
                        'http://electron.atom.io'
                    )
                },
            },
        ],
    },
]
statusBarMenu.unshift({
    label: 'YTMDesktop',
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

const popUpMenu = (
    __,
    saved_mainWindow,
    mediaControl,
    BrowserWindow,
    path,
    app
) => {
    return [
        {
            label: 'YTMD App',
            type: 'normal',
            click: function() {
                doBehavior(saved_mainWindow)
            },
        },

        { type: 'separator' },

        {
            label: __.trans('MEDIA_CONTROL_PLAY_PAUSE'),
            type: 'normal',
            click: function() {
                mediaControl.playPauseTrack(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_PREVIOUS'),
            type: 'normal',
            click: function() {
                mediaControl.previousTrack(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_NEXT'),
            type: 'normal',
            click: function() {
                mediaControl.nextTrack(saved_mainWindow.getBrowserView())
            },
        },

        { type: 'separator' },

        {
            label: __.trans('MEDIA_CONTROL_THUMBS_UP'),
            type: 'normal',
            click: function() {
                mediaControl.upVote(saved_mainWindow.getBrowserView())
            },
        },

        {
            label: __.trans('MEDIA_CONTROL_THUMBS_DOWN'),
            type: 'normal',
            click: function() {
                mediaControl.downVote(saved_mainWindow.getBrowserView())
            },
        },

        { type: 'separator' },

        {
            label: __.trans('LABEL_MINIPLAYER'),
            type: 'normal',
            click: function() {
                ipcMain.emit('window', { command: 'show-miniplayer' })
            },
        },

        {
            label: __.trans('LABEL_LYRICS'),
            type: 'normal',
            click: function() {
                ipcMain.emit('window', { command: 'show-lyrics' })
            },
        },

        {
            label: __.trans('LABEL_SETTINGS'),
            type: 'normal',
            click: function() {
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
            click: function() {
                app.exit()
            },
        },
    ]
}

module.exports = {
    statusBarMenu: statusBarMenu,
    popUpMenu: popUpMenu,
}
