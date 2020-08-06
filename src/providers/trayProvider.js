const { app, Menu, Tray, BrowserWindow, ipcMain } = require('electron')
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
    try {
        tray.setToolTip(tooltip)
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to setTooltip: ${error}`,
        })
    }
}

let init_tray = () => {
    try {
        setTooltip('YouTube Music Desktop App')
        tray.setContextMenu(contextMenu)

        tray.addListener('click', () => {
            doBehavior(saved_mainWindow)
        })

        tray.addListener('balloon-click', function () {
            doBehavior(saved_mainWindow)
        })
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to init_tray: ${error}`,
        })
    }
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
        setShinyTray()
    }
}

function updateTrayIcon(icon) {
    try {
        nativeImageIcon = buildTrayIcon(icon)
        tray.setImage(nativeImageIcon)
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to updateTrayIcon: ${error}`,
        })
    }
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
    try {
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
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to _doNotification: ${error}`,
        })
    }
}

function quit() {
    tray.destroy()
}

function setShinyTray() {
    try {
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
                    mediaControl.playPauseTrack(
                        saved_mainWindow.getBrowserView()
                    )
                }
            })
        } else {
            // Shiny tray disabled ||| on onther platform
            tray.removeAllListeners()
            init_tray()
        }
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to setShinyTray: ${error}`,
        })
    }
}

function updateImage(payload) {
    try {
        if (!settingsProvider.get('settings-shiny-tray')) return
        var img =
            typeof nativeImage.createFromDataURL === 'function'
                ? nativeImage.createFromDataURL(payload) // electron v0.36+
                : nativeImage.createFromDataUrl(payload) // electron v0.30
        tray.setImage(img)
    } catch {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to updateImage: ${error}`,
        })
    }
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
