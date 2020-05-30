const { ipcRenderer } = require('electron')
const app = require('electron').remote.app
const path = require('electron').remote.require('path')

const __ = require('../../providers/translateProvider')
const fileSystem = require('../../utils/fileSystem')

const themePath = path.join(
    fileSystem.getAppDocumentsPath(app),
    '/custom-theme'
)
const file = path.join(themePath, 'styles.css')

const textEditor = document.getElementById('editor')
const btnSave = document.getElementById('btn-save')

var editor

__.loadi18n()

if (fileSystem.checkIfExists(themePath)) {
    textEditor.innerHTML = fileSystem.readFile(file).toString()
}

if (btnSave) {
    btnSave.addEventListener('click', function() {
        var code = editor.getValue()
        fileSystem.writeFile(file, code)
        ipcRenderer.send('update-custom-theme')
    })
}

document.addEventListener('DOMContentLoaded', function() {
    editor = ace.edit('editor')
    editor.setTheme('ace/theme/twilight')
    editor.session.setMode('ace/mode/css')
})
