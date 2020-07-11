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
const { popUpMenu } = require('./templateProvider')

let tray = null
let saved_mainWindow = null
let contextMenu = null

function setTooltip(tooltip) {
    tray.setToolTip(tooltip)
}

let init_tray = () => {
    setTooltip('YouTube Music Desktop App')
    tray.setContextMenu(contextMenu)

    tray.addListener('click', () => {
        doBehavior(saved_mainWindow)
    })

    tray.addListener('balloon-click', function () {
        doBehavior(saved_mainWindow)
    })
}

function createTray(mainWindow, icon) {
    nativeImageIcon = buildTrayIcon(icon)
    tray = new Tray(nativeImageIcon)

    saved_mainWindow = mainWindow

    contextMenu = Menu.buildFromTemplate(
        popUpMenu(__, saved_mainWindow, mediaControl, BrowserWindow, path, app)
    )
    if (!systemInfo.isMac()) {
        init_tray()
    } else {
        // on Mac OS X
        setShinyTray()
    }
}

function updateTrayIcon(icon) {
    nativeImageIcon = buildTrayIcon(icon)
    tray.setImage(nativeImageIcon)
}

function buildTrayIcon(icon) {
    let nativeImageIcon = nativeImage.createFromPath(icon)
    return nativeImageIcon
}

function balloon(title, content, cover, icon) {
    if (title && content && cover) {
        imageToBase64(cover)
            .then((response) => {
                _doNotification(
                    title,
                    content,
                    nativeImage.createFromDataURL(
                        `data:image/jpeg;base64,${response}`
                    )
                )
            })
            .catch((_) => {
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
        if (systemInfo.isWindows()) {
            tray.displayBalloon({
                icon: image,
                title: title,
                content: content,
                noSound: true,
            })
        } else {
            new Notification(title, {
                body: content,
                silent: true,
                icon: image,
            })
        }
    }
}

function quit() {
    tray.destroy()
}

function setShinyTray() {
    if (settingsProvider.get('settings-shiny-tray') && systemInfo.isMac()) {
        tray.setContextMenu(null)
        tray.removeAllListeners()
        tray.on('right-click', (event, bound, position) => {
            tray.popUpContextMenu(contextMenu)
        })
        tray.on('click', (event, bound, position) => {
            if (position.x < 32) {
                saved_mainWindow.show()
            } else if (position.x > 130) {
                mediaControl.playPauseTrack(saved_mainWindow.getBrowserView())
            }
        })
    } else {
        // Shiny tray disabled ||| on onther platform
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
