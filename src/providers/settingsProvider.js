const electronStore = require('electron-store')
const store = new electronStore()

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
    if (get(settingName) === undefined) {
        set(settingName, initialValue)
    }
}

module.exports = {
    get: get,
    set: set,
    setInitialValue: setInitialValue,
}
