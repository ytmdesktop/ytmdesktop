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
    if (!store.has(settingName)) {
        set(settingName, initialValue)
    }
}

function onDidChange(key, callback) {
    store.onDidChange(key, (newValue, oldValue) => {
        callback({ newValue: newValue, oldValue: oldValue })
    })
}

module.exports = {
    onDidChange: onDidChange,
    get: get,
    set: set,
    setInitialValue: setInitialValue,
}
