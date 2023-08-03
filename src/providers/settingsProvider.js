const { ipcMain, webContents } = require('electron')
const electronStore = require('electron-store')
const store = new electronStore({ watch: true })

/**
 * Get setting value
 * @param {string} settingName
 */
function get(settingName) {
    return store.get(settingName)
}

/**
 * Set setting value
 * @param {string} settingName
 * @param {*} value
 */
function set(settingName, value) {
    store.set(settingName, value)
}

/**
 * Set initial value for setting if it not setted
 * @param {string} settingName
 * @param {*} initialValue
 */
function setInitialValue(settingName, initialValue) {
    if (!store.has(settingName)) set(settingName, initialValue)
}

function onDidChange(key, callback) {
    return store.onDidChange(key, (newValue, oldValue) =>
        callback({ newValue, oldValue })
    )
}

function proxyCallbackToSender(id, key) {
    return ({ newValue, oldValue }) => {
        const sender = webContents.fromId(id)
        if (!sender) return
        sender.send(`SETTINGS_NOTIFY_${key}`, newValue, oldValue)
    }
}

// In the browser process
if (ipcMain) {
    ipcMain.on('SETTINGS_GET', (e, settingName) => {
        e.returnValue = get(settingName)
    })

    const subscriptions = new Map()

    // TODO: Support unsubscribing over IPC, would need to decrement counter
    // no use case yet so left unimplemented
    ipcMain.on('SETTINGS_SUBSCRIBE', (e, settingName) => {
        let existingSubs = subscriptions.get(e.sender.id)
        if (!existingSubs) {
            existingSubs = {}
            subscriptions.set(e.sender.id, existingSubs)
        }
        if (existingSubs[settingName]) existingSubs[settingName]++
        else {
            existingSubs[settingName] = 1
            const unsub = onDidChange(
                settingName,
                proxyCallbackToSender(e.sender.id, settingName)
            )
            e.sender.on('destroyed', unsub)
        }
    })
}

module.exports = {
    onDidChange: onDidChange,
    get: get,
    set: set,
    setInitialValue: setInitialValue,
}
