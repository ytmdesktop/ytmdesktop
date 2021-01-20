const { app } = require('electron')
const path = require('path')

const systemInfo = require('../utils/systemInfo')

/**
 * Get local asset
 * @param {*} asset
 */
function getLocal(asset) {
    return path.join(app.getAppPath(), 'src/assets', `${asset}`)
}

function getIcon(assetPath) {
    let localAsset = path.join(app.getAppPath(), 'src/assets', `${assetPath}`)

    return systemInfo.isWindows() ? `${localAsset}.ico` : `${localAsset}.png`
}

function getExternal() {}

module.exports = {
    getLocal: getLocal,
    getExternal: getExternal,
    getIcon: getIcon,
}
