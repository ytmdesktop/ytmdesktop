const { autoUpdater } = require('electron-updater')
const settingsProvider = require('./settingsProvider')

function checkUpdate(mainWindow, view) {
    autoUpdater.checkForUpdates().catch((_) => console.log('Error on update'))

    autoUpdater.on('checking-for-update', () => {
        // tray.balloon( 'Auto Update', 'Checking for update...' );
        // mainWindow.send( 'downloaded-new-update', true );
    })

    autoUpdater.on('update-available', (info) => {
        // tray.balloon( 'Update Available', 'Auto Update' );
        mainWindow.send('have-new-update')
    })

    autoUpdater.on('update-not-available', (info) => {
        // tray.balloon( 'Update not available.', 'Auto Update' );
    })

    autoUpdater.on('error', (err) => {
        // tray.balloon( 'Error in auto-updater.', 'Auto Update' );
    })

    autoUpdater.on('update-downloaded', (info) => {
        // tray.balloon( 'Update downloaded', 'Auto Update' );
        view.webContents.send('downloaded-new-update', true)
        settingsProvider.set('has-updated', true)
    })
}

function quitAndInstall() {
    autoUpdater.quitAndInstall()
}

module.exports = {
    checkUpdate: checkUpdate,
    quitAndInstall: quitAndInstall,
}
