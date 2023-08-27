const { ipcRenderer } = require('electron')
const path = require('path')
const electronStore = require('electron-store')
const store = new electronStore()
const {
    handleWindowButtonsInit,
    updateWindowTitle,
} = require('../../utils/window')

const __ = require('../../../src/providers/translateProvider')
const fileSystem = require('../../../src/utils/fileSystem')

handleWindowButtonsInit()
updateWindowTitle()
updateForTitlebar()

function updateForTitlebar() {
    // Specifically add margins for the 'nice' titlebar
    const contentElem = document.getElementById('content')

    contentElem.style.marginTop = ''
    contentElem.classList.add(
        store.get('titlebar-type', 'nice') == 'nice'
            ? 'content-with-titlebar'
            : 'content-with-default-titlebar'
    )
}

const appDataPath = window.process.argv
    .filter((val) => val.includes('--app-path'))
    .map((val) => val.substring('--app-path='.length))[0]

const customCssDir = path.join(appDataPath, '/custom/css')
const filePage = path.join(customCssDir, 'page.css')

const textEditor = document.getElementById('editor')
const btnSave = document.getElementById('btn-save')

let editor

__.loadi18n()

if (fileSystem.checkIfExists(customCssDir))
    textEditor.innerHTML = fileSystem.readFile(filePage).toString()

if (btnSave)
    btnSave.addEventListener('click', () => {
        if (!fileSystem.checkIfExists(customCssDir)) {
            fileSystem.createDir(customCssDir)
        }

        const code = editor.getValue()
        fileSystem.writeFile(filePage, code)
        ipcRenderer.send('update-custom-css-page')
    })

document.addEventListener('DOMContentLoaded', () => {
    editor = ace.edit('editor')
    editor.setTheme('ace/theme/twilight')
    editor.session.setMode('ace/mode/css')
})
