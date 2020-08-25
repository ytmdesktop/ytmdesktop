const { app, Menu, Tray, BrowserWindow, ipcMain } = require('electron')
const mediaControl = require('./mediaProvider')
const nativeImage = require('electron').nativeImage
const settingsProvider = require('./settingsProvider')
const __ = require('./translateProvider')
const { doBehavior } = require('../utils/window')
const systemInfo = require('../utils/systemInfo')
const imageToBase64 = require('image-to-base64')
const { popUpMenu } = require('./templateProvider')
const assetsProvider = require('./assetsProvider')

let tray = null
let saved_mainWindow = null
let contextMenu = null
let iconTray = assetsProvider.getIcon('trayTemplate')

function setTooltip(tooltip) {
    try {
        if (tray) {
            tray.setToolTip(tooltip)
        }
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

        if (!systemInfo.isMac()) {
            init_tray()
        } else {
            setShinyTray()
        }
    }
}

function updateTray(data) {
    try {
        if (tray) {
            var template = popUpMenu(__, saved_mainWindow, mediaControl, app)

            if (data.type == 'audioOutputs') {
                template[11]['submenu'] = data.data
            }

            contextMenu = Menu.buildFromTemplate(template)

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
                if (!settingsProvider.get('settings-tray-icon')) {
                    setTimeout(() => {
                        quit()
                    }, 7 * 1000)
                }
            } else {
                let Notification = require('electron-native-notification')

                new Notification(title, {
                    body: content,
                    silent: true,
                    icon: icon,
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
    updateTray: updateTray,
    balloon: balloon,
    balloonEvents: balloonEvents,
    quit: quit,
    setShinyTray: setShinyTray,
    updateImage: updateImage,
    updateTrayIcon: updateTrayIcon,
}
