const { ipcRenderer } = require('electron')
const { handleWindowButtonsInit } = require('../../../utils/window')

handleWindowButtonsInit()

let webview = document.querySelector('webview')

ipcRenderer.on('window-is-maximized', (_, isMaximized) => {
    if (isMaximized) {
        document.getElementById('icon_maximize').classList.add('hide')
        document.getElementById('icon_restore').classList.remove('hide')
    } else {
        document.getElementById('icon_restore').classList.add('hide')
        document.getElementById('icon_maximize').classList.remove('hide')
    }
})

document.addEventListener('DOMContentLoaded', () => {
    checkUrlParams()

    let btnMinimize = document.getElementById('btn-minimize')
    let btnMaximize = document.getElementById('btn-maximize')
    let btnClose = document.getElementById('btn-close')

    if (btnMinimize)
        btnMinimize.addEventListener('click', () => {
            ipcRenderer.send('window-button-action-minimize')
        })

    if (btnMaximize)
        btnMaximize.addEventListener('click', () => {
            ipcRenderer.send('window-button-action-maximize')
        })

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            ipcRenderer.send('window-button-action-close')
        })
    }

    if (document.getElementById('loading'))
        document.getElementById('loading').classList.add('hide')
})

// ENABLE FOR DEBUG
// webview.addEventListener("did-start-loading", () => { webview.openDevTools({ mode: 'detach'}); });

function checkUrlParams() {
    const params = new URL(window.location).searchParams

    let page = params.get('page')
    let icon = params.get('icon')
    let title = params.get('title')
    let hide = params.get('hide')
    let trusted = params.get('trusted')
    let script = params.get('script')

    if (trusted) {
        webview.classList.add('hide')
        webview = document.getElementById('iframe')
        webview.classList.remove('hide')
    }

    if (page) {
        webview.src = `../../${page}.html`
    }

    if (script) {
        script = script.split(',')

        script.forEach((src) => {
            script_block = document.createElement('script')
            script_block.src = `./${src}.js`
            document.body.append(script_block)
        })
    }

    if (icon) {
        let elIcon = document.getElementById('icon')
        if (elIcon) elIcon.innerText = icon
    }

    if (title) {
        let elTitle = document.getElementById('window-title')
        if (elTitle) elTitle.innerText = title

        document.title = title
    }

    if (hide) {
        hide = hide.split(',')

        hide.forEach((element) => {
            let elHide = document.getElementById(element)
            if (elHide) elHide.classList.add('hide')
        })
    }
}
