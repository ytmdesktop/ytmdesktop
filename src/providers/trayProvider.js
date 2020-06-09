const { app, Menu, Tray, BrowserWindow } = require('electron')
const path = require('path')
const mediaControl = require('./mediaProvider')
const nativeImage = require('electron').nativeImage
const settingsProvider = require('./settingsProvider')
const __ = require('./translateProvider')
const Notification = require('electron-native-notification')
const { doBehavior } = require('../utils/window')
const systemInfo = require('../utils/systemInfo')
const imageToBase64 = require('image-to-base64')

let tray = null
let saved_icon = null
let saved_mainWindow = null

function setTooltip(tooltip) {
    tray.setToolTip(tooltip)
}

let init_tray = () => {
    const { popUpMenu } = require('./templateProvider')
    const contextMenu = Menu.buildFromTemplate(
        popUpMenu(__, saved_mainWindow, mediaControl, BrowserWindow, path, app)
    )

    setTooltip('YouTube Music Desktop App')
    tray.setContextMenu(contextMenu)

    tray.addListener('click', () => {
        doBehavior(saved_mainWindow)
    })

    tray.addListener('balloon-click', function() {
        doBehavior(saved_mainWindow)
    })
}

let popUpMenu = null

function createTray(mainWindow, icon) {
    let nativeImageIcon = nativeImage.createFromPath(icon)
    tray = new Tray(nativeImageIcon)

    saved_mainWindow = mainWindow
    if (!systemInfo.isMac()) {
        init_tray()
    } else {
        // on Mac OS X
        setShinyTray()
    }
}

function updateTrayIcon(icon) {
    let nativeImageIcon = nativeImage.createFromPath(icon)
    if (systemInfo.isMac()) {
        nativeImageIcon = nativeImageIcon.resize({
            height: 18,
            width: 18,
            quality: 'best',
        })
    }
    tray.setImage(nativeImageIcon)
}

function balloon(title, content, cover, icon) {
    if (title && content && cover) {
        imageToBase64(cover)
            .then(
                response => {
                    _doNotification(
                        title,
                        content,
                        nativeImage.createFromDataURL(
                            `data:image/jpeg;base64,${response}`
                        )
                    )
                },
                _ => {
                    _doNotification(
                        title,
                        content,
                        nativeImage.createFromPath(icon)
                    )
                }
            )
            .catch(_ => {
                _doNotification(
                    title,
                    content,
                    nativeImage.createFromPath(icon)
                )
            })
    }
}

function _doNotification(title, content, image) {
    if (title && content) {
        if (process.platform == 'win32') {
            tray.displayBalloon({
                icon: image,
                title: title,
                content: content,
            })
        } else {
            new Notification(title, {
                body: content,
                icon: image,
            })
        }
    }
}

function quit() {
    tray.destroy()
}

function setShinyTray() {
    if (
        settingsProvider.get('settings-shiny-tray') &&
        process.platform === 'darwin'
    ) {
        // Shiny tray enabled
        tray.setContextMenu(null)
        tray.removeAllListeners()
        tray.on('right-click', (event, bound, position) => {
            // console.log('right_clicked', bound);
            if (!popUpMenu.isVisible()) {
                popUpMenu.setPosition(bound.x, bound.y + bound.height + 1)
                popUpMenu.show()
            } else {
                popUpMenu.hide()
            }
        })
        tray.on('click', (event, bound, position) => {
            // console.log(position);
            if (position.x < 32) {
                doBehavior(saved_mainWindow)
            } else if (position.x > 130) {
                mediaControl.playPauseTrack(saved_mainWindow.getBrowserView())
            }
        })
        popUpMenu = new BrowserWindow({
            frame: false,
            center: true,
            alwaysOnTop: true,
            autoHideMenuBar: true,
            resizable: false,
            backgroundColor: '#232323',
            width: 160,
            height: 277,
            webPreferences: { nodeIntegration: true },
        })
        popUpMenu.loadFile(
            path.join(__dirname, '../pages/settings/mac_shiny.html')
        )
        popUpMenu.setVisibleOnAllWorkspaces(true)
        popUpMenu.hide()
        popUpMenu.on('blur', () => {
            popUpMenu.hide()
        })
    } else {
        // Shiny tray disabled ||| on onther platform
        tray.setImage(saved_icon)
        tray.removeAllListeners()
        init_tray()
    }
}

function updateImage(payload) {
    if (!settingsProvider.get('settings-shiny-tray')) return
    var img =
        typeof nativeImage.createFromDataURL === 'function'
            ? nativeImage.createFromDataURL(payload) // electron v0.36+
            : nativeImage.createFromDataUrl(payload) // electron v0.30
    tray.setImage(img)
}

module.exports = {
    setTooltip: setTooltip,
    createTray: createTray,
    balloon: balloon,
    quit: quit,
    setShinyTray: setShinyTray,
    updateImage: updateImage,
    updateTrayIcon: updateTrayIcon,
}
