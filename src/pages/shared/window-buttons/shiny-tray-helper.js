const { remote, ipcRenderer: ipc } = require('electron')
const electronStore = require('electron-store')
const store = new electronStore()
const status = remote.getGlobal('sharedObj')
const icons = require('../../../assets/icons_for_shiny_tray')

let icon_set = icons.bright

const canvas = document.createElement('canvas')
canvas.height = 32
canvas.width = 150
const ctx = canvas.getContext('2d')

let saved_title = ''
let elapsed = 0
let textWidth = 0
let rollInterval = null

function render_tray() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '14px Arial'
    if (store.get('settings-shiny-tray-dark', false)) {
        ctx.fillStyle = 'white'
        icon_set = icons.dark
    } else {
        ctx.fillStyle = 'black'
        icon_set = icons.bright
    }
    if (saved_title != status.title) {
        saved_title = status.title
        elapsed = 0
    }
    textWidth = ctx.measureText(saved_title + '    ').width
    if (status.rollable && textWidth > 105) {
        // 105 comes from 135 - 30

        elapsed += 3
        ctx.fillText(saved_title + '    ' + saved_title, 30 - elapsed, 21)
        ctx.clearRect(0, 0, 30, canvas.height)
        ctx.clearRect(135, 0, canvas.width - 135, canvas.height)
        if (elapsed > textWidth) elapsed = 0
        if (!rollInterval) {
            rollInterval = setInterval(() => {
                render_tray()
            }, 200)
        }
    } else {
        if (rollInterval) clearInterval(rollInterval)
        rollInterval = null
        ctx.fillText(cutstr(status.title, 14), 30, 21)
        elapsed = 0
    }

    // console.log(arg)
    ctx.drawImage(icon_set.icons, 8, 8, 16, 16)
    if (status.paused) ctx.drawImage(icon_set.play, 135, 6, 20, 20)
    else ctx.drawImage(icon_set.pause, 135, 6, 20, 20)

    ipc.send('updated-tray-image', canvas.toDataURL('image/png', 1))
}

ipc.on('update-status-bar', () => {
    render_tray()
})

setTimeout(() => {
    ipc.send('register-renderer')
}, 1000)

ipc.on('is-dev', (event, args) => {
    if (args) document.title = document.title + ' DEV'
})

function cutstr(str, len) {
    let str_length = 0
    let str_len
    let str_cut = String()
    str_len = str.length
    for (let i = 0; i < str_len; i++) {
        const a = str.charAt(i)
        str_length++
        if (escape(a).length > 4) {
            str_length++
        }
        str_cut = str_cut.concat(a)
        if (str_length >= len) {
            str_cut = str_cut.concat('...')
            return str_cut
        }
    }
    if (str_length < len) return str
}
