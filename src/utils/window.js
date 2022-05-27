const { screen, ipcMain } = require('electron')
const { isWindows, isMac } = require('./systemInfo')

function create() {
    // for create window
}

async function checkWindowPosition(windowPosition, windowSize) {
    return new Promise((resolve, reject) => {
        try {
            if (!windowPosition || !windowSize) {
                reject(false)
                return
            }

            let nearestDisplay = screen.getDisplayMatching({
                x: windowPosition.x,
                y: windowPosition.y,
                width: windowSize.width,
                height: windowSize.height,
            })
            let nearestDisplayBounds = nearestDisplay.bounds

            var adjustedWindow = {
                position: {
                    x: windowPosition.x,
                    y: windowPosition.y,
                },
                size: {
                    width: windowSize.width,
                    height: windowSize.height,
                },
            }

            // The reason for + 64 in window sizes is because 1px inside nearest display is considered visible but not user friendly as it's quite well hidden and could prevent dragging
            if (
                windowPosition.x + (windowSize.width - 64) >
                nearestDisplayBounds.width
            )
                adjustedWindow.position.x =
                    nearestDisplayBounds.width - (windowSize.width + 64)

            if (windowPosition.x < nearestDisplayBounds.x)
                adjustedWindow.position.x = nearestDisplayBounds.x + 64

            if (windowSize.width > nearestDisplayBounds.width)
                windowSize.width = nearestDisplay.width - 64 * 2

            if (
                windowPosition.y + (windowSize.height + 64) >
                nearestDisplayBounds.height
            )
                adjustedWindow.position.y =
                    nearestDisplayBounds.height -
                    (windowSize.height + 64 + (isWindows() ? 50 : 0))

            if (windowPosition.y < nearestDisplayBounds.y)
                adjustedWindow.position.y =
                    nearestDisplayBounds.y + 64 + (isMac() ? 36 : 0)

            if (adjustedWindow.size.height > nearestDisplayBounds.height)
                adjustedWindow.size.height = nearestDisplay.height - 64 * 2

            resolve(adjustedWindow)
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

module.exports = {
    create: create,
    checkWindowPosition: checkWindowPosition,
    doBehavior: doBehavior,
}
