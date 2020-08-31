const { screen, ipcMain } = require('electron')

function create() {
    // for create window
}

function checkWindowPosition(windowPosition) {
    return new Promise((resolve, reject) => {
        try {
            let displays = screen.getAllDisplays()
            let externalDisplay = displays.find((display) => {
                return display.bounds.x !== 0 || display.bounds.y !== 0
            })

            if (externalDisplay === undefined) {
                primaryDisplayPosition = displays[0].bounds

                if (
                    windowPosition &&
                    windowPosition.x > primaryDisplayPosition.width
                ) {
                    var position = {
                        x: windowPosition.x - primaryDisplayPosition.width,
                        y: windowPosition.y,
                    }
                    resolve(position)
                }
            }
        } catch {
            console.log('error -> checkWindowPosition')
            reject(false)
        }
    })
}

function doBehavior(mainWindow) {
    if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
            mainWindow.hide()
        } else {
            mainWindow.focus()
        }
    } else {
        if (mainWindow.isFocused()) {
            ipcMain.emit('window', { command: 'restore-main-window' })
        } else {
            ipcMain.emit('window', { command: 'restore-main-window' })
        }
    }
}

module.exports = {
    create: create,
    checkWindowPosition: checkWindowPosition,
    doBehavior: doBehavior,
}
