const { ipcRenderer } = require('electron')
const app = require('electron').remote.app
const path = require('electron').remote.require('path')

const __ = require('../../../src/providers/translateProvider')
const fileSystem = require('../../../src/utils/fileSystem')

const params = new URL(window.location).searchParams
var mode = params.get('mode')

let customCssDir, fileEdit
switch (mode) {
    case 'app':
        customCssDir = path.join(fileSystem.getAppDataPath(app), '/custom/css')
        fileEdit = path.join(customCssDir, 'app.css')
        break

    case 'page':
    default:
        customCssDir = path.join(fileSystem.getAppDataPath(app), '/custom/css')
        fileEdit = path.join(customCssDir, 'page.css')
}

const textEditor = document.getElementById('editor')
const btnSave = document.getElementById('btn-save')

let editor

__.loadi18n()

if (fileSystem.checkIfExists(fileEdit))
    textEditor.innerHTML = fileSystem.readFile(fileEdit).toString()

if (btnSave)
    btnSave.addEventListener('click', () => {
        const code = editor.getValue()
        fileSystem.writeFile(fileEdit, code)

        switch (mode) {
            case 'app':
                ipcRenderer.send('update-custom-css-app')
                break

            case 'page':
            default:
                ipcRenderer.send('update-custom-css-page')
        }
    })

document.addEventListener('DOMContentLoaded', () => {
    editor = ace.edit('editor')
    editor.setTheme('ace/theme/twilight')
    editor.session.setMode('ace/mode/css')
})
