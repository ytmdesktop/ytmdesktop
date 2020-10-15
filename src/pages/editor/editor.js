const { ipcRenderer } = require('electron')
const app = require('electron').remote.app
const path = require('electron').remote.require('path')

const __ = require('../../../src/providers/translateProvider')
const fileSystem = require('../../../src/utils/fileSystem')

const customCssDir = path.join(fileSystem.getAppDataPath(app), '/custom/css')
const filePage = path.join(customCssDir, 'page.css')

const textEditor = document.getElementById('editor')
const btnSave = document.getElementById('btn-save')

let editor

__.loadi18n()

if (fileSystem.checkIfExists(customCssDir))
    textEditor.innerHTML = fileSystem.readFile(filePage).toString()

if (btnSave)
    btnSave.addEventListener('click', () => {
        const code = editor.getValue()
        fileSystem.writeFile(filePage, code)
        ipcRenderer.send('update-custom-css-page')
    })

document.addEventListener('DOMContentLoaded', () => {
    editor = ace.edit('editor')
    editor.setTheme('ace/theme/twilight')
    editor.session.setMode('ace/mode/css')
})
