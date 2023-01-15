const { ipcRenderer: ipc, ipcRenderer } = require('electron')
const electronStore = require('electron-store')
const store = new electronStore()
const { isWindows, isMac, isLinux } = require('../../../utils/systemInfo')

const winElement = document.getElementById('win')
const macElement = document.getElementById('mac')

let webview = document.querySelector('webview')

if (store.get('titlebar-type', 'nice') !== 'nice') {
    document.getElementById('nice-titlebar').style.height = '15px'
    document
        .getElementById('nice-titlebar')
        .removeChild(document.getElementById('nice-titlebar').firstChild)

    document.getElementById('webview').style.height = '100vh'
    document.getElementById('iframe').style.height = '100vh'
} else {
    if (isMac()) {
        winElement.remove()
        macElement.classList.remove('hide')
    } else if (isWindows()) {
        macElement.remove()
        winElement.classList.remove('hide')
    } else if (isLinux()) {
        winElement.remove()
        macElement.remove()
    }
    document.getElementById('webview').style.height = '95vh'
    document.getElementById('iframe').style.height = '95vh'
    document.getElementById('content').style.marginTop = '5vh'
}

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

    document.getElementById('loading').classList.add('hide')
})

// ENABLE FOR DEBUG
// webview.addEventListener("did-start-loading", () => { webview.openDevTools(); });

function checkUrlParams() {
    const params = new URL(window.location).searchParams

    console.log('checkUrlParams')

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

    if (page) webview.src = `../../${page}.html`

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
