const { app } = require('electron')
const path = require('path')

const systemInfo = require('../utils/systemInfo')

/**
 * Get local asset
 * @param {*} asset
 */
function getLocal(asset) {
    return path.join('assets', `${asset}`)
}

function getIcon(assetPath) {
    let localAsset = path.join('assets', `${assetPath}`)

    if (systemInfo.isWindows()) {
        return `${localAsset}.ico`
    } else {
        return `${localAsset}.png`
    }
}

function getExternal() {}

module.exports = {
    getLocal: getLocal,
    getExternal: getExternal,
    getIcon: getIcon,
}
