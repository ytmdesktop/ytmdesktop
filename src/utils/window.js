const { screen, ipcMain } = require('electron')
const { isWindows, isMac, isLinux } = require('./systemInfo')
const electronStore = require('electron-store')
const store = new electronStore()
const __ = require('../providers/translateProvider')

function create() {
    // for create window
}

// lifted code from: https://dev.to/craftzdog/how-to-check-if-a-browser-window-is-inside-of-screens-on-electron-1eme
function getMiniplayerWindowBounds(windowPosition, windowSize) {
    return new Promise((resolve, reject) => {
        try {
            const displays = screen.getAllDisplays()
            const isWithinDisplayBounds = displays.reduce((result, display) => {
                const area = display.workArea
                if (
                    windowPosition === undefined ||
                    windowPosition[0] == null ||
                    windowPosition[1] == null
                ) {
                    return false
                } else {
                    return (
                        result ||
                        (windowPosition[0] >= area.x &&
                            windowPosition[1] >= area.y &&
                            windowPosition[0] < area.x + area.width &&
                            windowPosition[1] < area.y + area.height)
                    )
                }
            }, false)

            if (!isWithinDisplayBounds) {
                const primaryScreenBounds = screen.getPrimaryDisplay().bounds
                const x = Math.floor(
                    (primaryScreenBounds.width - windowSize) / 2
                )
                const y = Math.floor(
                    (primaryScreenBounds.height - windowSize) / 2
                )

                resolve({
                    x: x,
                    y: y,
                })
            } else {
                reject('display is within bounds')
            }
        } catch (err) {
            console.log('error -> getMiniplayerWindowBounds', err)
            reject(null)
        }
    })
}

function checkWindowPosition(windowPosition, windowSize) {
    return new Promise((resolve, reject) => {
        try {
            if (!windowPosition || !windowSize) {
                reject(false)
                return
            }

            const displays = screen.getAllDisplays()
            const isWithinDisplayBounds = displays.reduce((result, display) => {
                const area = display.workArea
                if (
                    windowPosition === undefined ||
                    windowPosition.x == null ||
                    windowPosition.y == null
                ) {
                    return false
                } else {
                    return (
                        result ||
                        (windowPosition.x >= area.x &&
                            windowPosition.y >= area.y &&
                            windowPosition.x < area.x + area.width &&
                            windowPosition.y < area.y + area.height)
                    )
                }
            }, false)

            if (!isWithinDisplayBounds) {
                const primaryScreenBounds = screen.getPrimaryDisplay().bounds
                const x = Math.floor(
                    (primaryScreenBounds.width - windowSize.width) / 2
                )
                const y = Math.floor(
                    (primaryScreenBounds.height - windowSize.height) / 2
                )

                resolve({
                    x: x,
                    y: y,
                })
            } else {
                resolve(windowPosition)
            }
        } catch (err) {
            console.log('error -> checkWindowPosition', err)
            reject(false)
        }
    })
}

function doBehavior(mainWindow) {
    if (mainWindow.isVisible())
        if (mainWindow.isFocused()) mainWindow.hide()
        else mainWindow.show()
    else if (mainWindow.isFocused())
        ipcMain.emit('window', { command: 'restore-main-window' })
    else ipcMain.emit('window', { command: 'restore-main-window' })
}

function handleWindowButtonsInit() {
    const winElement = document.getElementById('win')
    const macElement = document.getElementById('mac')

    let webviewElem = document.getElementById('webview')
    let iframeElem = document.getElementById('iframe')
    let contentElem = document.getElementById('content')

    if (store.get('titlebar-type', 'nice') !== 'nice') {
        document.getElementById('nice-titlebar').style.display = 'none'

        if (webviewElem) webviewElem.style.height = '100vh'
        if (iframeElem) iframeElem.style.height = '100vh'
    } else {
        if (isMac()) {
            if (winElement) winElement.remove()
            if (macElement) macElement.classList.remove('hide')
        } else if (isWindows()) {
            if (macElement) macElement.remove()
            if (winElement) winElement.classList.remove('hide')
        } else if (isLinux()) {
            if (winElement) winElement.remove()
            if (macElement) macElement.remove()
        }
        if (webviewElem) webviewElem.style.height = '95vh'
        if (iframeElem) iframeElem.style.height = '95vh'
        if (contentElem) contentElem.style.marginTop = '10vh'
    }
}

function updateWindowTitle() {
    let windowTitleElem = document.getElementById('window-title')
    let windowTitleLabel = windowTitleElem.innerText
    let translatedTitle = __.trans(windowTitleLabel)
    windowTitleElem.innerText = translatedTitle
}

module.exports = {
    create: create,
    checkWindowPosition: checkWindowPosition,
    doBehavior: doBehavior,
    getMiniplayerWindowBounds: getMiniplayerWindowBounds,
    handleWindowButtonsInit: handleWindowButtonsInit,
    updateWindowTitle: updateWindowTitle,
}
