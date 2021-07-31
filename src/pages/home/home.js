const { ipcRenderer: ipc } = require('electron')
const electronStore = require('electron-store')
const store = new electronStore()
const status = require('@electron/remote').getGlobal('sharedObj')

ipc.on('is-dev', (event, args) => {
    if (args) document.title = document.title + ' DEV'
})

document.addEventListener('DOMContentLoaded', () => {
    let isOnline = navigator.onLine

    if (isOnline) {
        document.querySelector('#is-offline').classList.add('hide')
        document.querySelector('#center-loading').classList.remove('hide')
    } else {
        document.querySelector('#is-offline').classList.remove('hide')
        document.querySelector('#center-loading').classList.add('hide')
    }
})

/*document.querySelector('#btn-reload')
    .addEventListener('click', () => {
        window.location.reload()
    })*/
