const { remote, ipcRenderer: ipc } = require('electron')
const electronStore = require('electron-store')
const store = new electronStore()
const { isWindows, isMac, isLinux } = require('../../../utils/systemInfo')
const currentWindow = remote.getCurrentWindow()

const winElement = document.getElementById('win')
const macElement = document.getElementById('mac')

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

if (store.get('titlebar-type', 'nice') !== 'nice') {
    document.getElementById('nice-titlebar').style.display = 'none'
    document.getElementById('nice-titlebar').style.height = 0

    document.getElementById('webview').style.height = '100vh'
} else {
    document.getElementById('webview').style.height = '95vh'
    document.getElementById('content').style.marginTop = '29px'
}

ipc.on('window-is-maximized', function(_, value) {
    if (value) {
        document.getElementById('icon_maximize').classList.add('hide')
        document.getElementById('icon_restore').classList.remove('hide')
    } else {
        document.getElementById('icon_restore').classList.add('hide')
        document.getElementById('icon_maximize').classList.remove('hide')
    }
})

document.addEventListener('DOMContentLoaded', function() {
    checkUrlParams()

    document
        .getElementById('btn-minimize')
        .addEventListener('click', function() {
            currentWindow.minimize()
        })

    document
        .getElementById('btn-maximize')
        .addEventListener('click', function() {
            if (!currentWindow.isMaximized()) {
                currentWindow.maximize()
            } else {
                currentWindow.unmaximize()
            }
        })

    document.getElementById('btn-close').addEventListener('click', function() {
        currentWindow.close()
    })
})

// ENABLE FOR DEBUG
// document.getElementById("webview").addEventListener("dom-ready", function(){ webview.openDevTools(); });

function checkUrlParams() {
    const params = new URL(window.location).searchParams

    let page = params.get('page')
    let icon = params.get('icon')
    let title = params.get('title')
    let hide = params.get('hide')

    if (page) {
        document.getElementById('webview').src = `../../${page}.html`
    }

    if (icon) {
        document.getElementById('icon').innerText = icon
    }

    if (title) {
        document.getElementById('music-title').innerText = title
    }

    if (hide) {
        hide = hide.split(',')

        hide.forEach(element => {
            document.getElementById(element).classList.add('hide')
        })
    }
}
