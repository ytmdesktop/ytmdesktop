const { screen, ipcMain } = require('electron')

function create() {
    // for create window
}

function checkWindowPosition(windowPosition, windowSize) {
    return new Promise((resolve, reject) => {
        try {
            let nearestDisplay = screen.getDisplayMatching({
                x: windowPosition.x,
                y: windowPosition.y,
                width: windowSize.width,
                height: windowSize.height,
            })
            let nearestDisplayBounds = nearestDisplay.bounds

            var position = {
                x: windowPosition.x,
                y: windowPosition.y,
            }

            // The reason for + 64 in window sizes is because 1px inside nearest display is considered visible but not user friendly as it's quite well hidden and could prevent dragging
            if (
                windowPosition &&
                windowSize &&
                windowPosition.x - (windowSize.width + 64) >
                    nearestDisplayBounds.x
            ) {
                position.x = windowPosition.x - nearestDisplayBounds.width
            }

            if (
                windowPosition &&
                windowSize &&
                windowPosition.x + (windowSize.width + 64) <
                    nearestDisplayBounds.x
            ) {
                position.x = windowPosition.x + nearestDisplayBounds.width
            }

            if (
                windowPosition &&
                windowSize &&
                windowPosition.y - (windowSize.height + 64) >
                    nearestDisplayBounds.y
            ) {
                position.y = windowPosition.y - nearestDisplayBounds.height
            }

            if (
                windowPosition &&
                windowSize &&
                windowPosition.y + (windowSize.height + 64) <
                    nearestDisplayBounds.y
            ) {
                position.y = windowPosition.y + nearestDisplayBounds.height
            }

            resolve(position)
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
