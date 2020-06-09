const fs = require('fs')
const path = require('path')

function _createDir(path) {
    fs.mkdirSync(path, { recursive: true })
}

function _getDir(path) {
    return fs.readdirSync(path)
}

function _writeFile(path, data) {
    fs.writeFileSync(path, data, { flag: 'w+' })
}

function _readFile(path) {
    return fs.readFileSync(path)
}

function _checkIfExists(path) {
    return fs.existsSync(path)
}

function _getAppDocumentsPath(app) {
    return path.join(app.getPath('documents'), app.name)
}

module.exports = {
    createDir: _createDir,
    getDir: _getDir,
    writeFile: _writeFile,
    readFile: _readFile,
    checkIfExists: _checkIfExists,
    getAppDocumentsPath: _getAppDocumentsPath,
}
