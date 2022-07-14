const { app, Menu, Tray, ipcMain } = require('electron')
const mediaControl = require('./mediaProvider')
const nativeImage = require('electron').nativeImage
const settingsProvider = require('./settingsProvider')
const __ = require('./translateProvider')
const { doBehavior } = require('../utils/window')
const systemInfo = require('../utils/systemInfo')
const imageToBase64 = require('image-to-base64')
const { popUpMenu } = require('./templateProvider')
const assetsProvider = require('./assetsProvider')
const { Notification } = require('electron')

let tray = null
let saved_mainWindow = null
let contextMenu = null
let iconTray = assetsProvider.getIcon('trayTemplate')

function setTooltip(tooltip) {
    try {
        if (tray) tray.setToolTip(tooltip)
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to setTooltip: ${error}`,
        })
    }
}

let initVanillaTray = () => {
    try {
        setTooltip('YouTube Music Desktop App')
        tray.removeAllListeners()
        tray.setContextMenu(contextMenu)
        nativeImageIcon = buildTrayIcon(iconTray)
        tray.setImage(nativeImageIcon)
        tray.addListener('click', () => {
            doBehavior(saved_mainWindow)
        })

        tray.addListener('balloon-click', function () {
            doBehavior(saved_mainWindow)
        })
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to initVanillaTray: ${error}`,
        })
    }
}

function createTray(mainWindow) {
    if (settingsProvider.get('settings-tray-icon')) {
        nativeImageIcon = buildTrayIcon(iconTray)
        tray = new Tray(nativeImageIcon)

        if (mainWindow) {
            saved_mainWindow = mainWindow

            contextMenu = Menu.buildFromTemplate(
                popUpMenu(__, saved_mainWindow, mediaControl, app)
            )
        }

        if (!systemInfo.isMac()) initVanillaTray()
    }
    if (systemInfo.isMac()) setShinyTray()
}

function updateTray(data) {
    try {
        if (tray) {
            const template = popUpMenu(__, saved_mainWindow, mediaControl, app)

            if (data.type === 'audioOutputs') template[11].submenu = data.data

            contextMenu = Menu.buildFromTemplate(template)

            if (!settingsProvider.get('settings-shiny-tray'))
                tray.setContextMenu(contextMenu)
        }
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to updateTray: ${error}`,
        })
    }
}

function updateTrayIcon(icon) {
    try {
        if (tray) {
            nativeImageIcon = buildTrayIcon(icon)
            tray.setImage(nativeImageIcon)
        }
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to updateTrayIcon: ${error}`,
        })
    }
}

function buildTrayIcon(icon) {
    return nativeImage.createFromPath(icon)
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

function balloonEvents(data) {
    _doNotification(data.title, data.content, data.icon)
}

function _doNotification(title, content, icon) {
    try {
        if (title && content) {
            if (systemInfo.isWindows()) {
                if (!settingsProvider.get('settings-tray-icon')) {
                    nativeImageIcon = buildTrayIcon(iconTray)
                    tray = new Tray(nativeImageIcon)
                }
                tray.displayBalloon({
                    icon: icon,
                    title: title,
                    content: content,
                    noSound: true,
                })
                if (!settingsProvider.get('settings-tray-icon'))
                    setTimeout(() => {
                        quit()
                    }, 7 * 1000)
            }
            // create a system notification and send it
            else
                new Notification({
                    title: title,
                    body: content,
                    silent: true,
                    icon: icon,
                    urgency: 'low',
                }).show()
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
        if (systemInfo.isMac()) {
            app.dock.setMenu(contextMenu)
        } else {
            // Shiny tray disabled ||| on onther platform
            tray.removeAllListeners()
            initVanillaTray()
            console.log('initVanillaTray')
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
        if (!settingsProvider.get('settings-shiny-tray') || !tray) return
        const img =
            typeof nativeImage.createFromDataURL === 'function'
                ? nativeImage.createFromDataURL(payload) // electron v0.36+
                : nativeImage.createFromDataUrl(payload) // electron v0.30
        tray.setImage(img)
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Failed to updateImage: ${error}`,
        })
    }
}

module.exports = {
    setTooltip: setTooltip,
    createTray: createTray,
    updateTray: updateTray,
    balloon: balloon,
    balloonEvents: balloonEvents,
    quit: quit,
    setShinyTray: setShinyTray,
    updateImage: updateImage,
    updateTrayIcon: updateTrayIcon,
}
