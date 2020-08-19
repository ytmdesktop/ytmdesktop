const { remote, ipcRenderer: ipc, shell } = require('electron')
const settingsProvider = require('../../providers/settingsProvider')
const __ = require('../../providers/translateProvider')
const { isLinux, isMac, isWindows } = require('../../utils/systemInfo')
const fs = require('fs')

const elementSettingsCompanionApp = document.getElementById(
    'COMPANION_SERVER_INFO'
)
const elementRangeZoom = document.getElementById('range-zoom')
const elementBtnAppRelaunch = document.getElementById('btn-relaunch')
const elementBtnOpenPageEditor = document.getElementById(
    'btn-editor-custom-css-page'
)
const elementBtnLastFmLogin = document.getElementById('btn-last-fm-login')
const elementBtnOpenCompanionServer = document.getElementById(
    'btn-open-companion-server'
)
const elementBtnDiscordSettings = document.getElementById('btn-discord-setting')

if (isLinux()) {
    document
        .getElementById(
            'i18n_LABEL_SETTINGS_TAB_GENERAL_SELECT_TITLEBAR_TYPE_NICE'
        )
        .remove()
}

const audioOutputSelect = document.querySelector('#settings-app-audio-output')

let settingsAccelerators = settingsProvider.get('settings-accelerators')

let typeAcceleratorSelected, keyBindings

ipc.invoke('get-audio-output-list').then((devices) => {
    devices = JSON.parse(devices)

    if (devices.length) {
        devices.forEach((deviceInfo) => {
            let option = document.createElement('option')
            option.text =
                deviceInfo.label || `speaker ${audioOutputSelect.length + 1}`
            option.value = deviceInfo.label
            audioOutputSelect.appendChild(option)
        })

        initElement('settings-app-audio-output', 'change', function () {
            ipc.send('change-audio-output', audioOutputSelect.value)
        })

        const defaultOuput = devices.find(
            (audio) => audio.deviceId == 'default'
        )
        if (!audioOutputSelect.value.length) {
            audioOutputSelect.value = defaultOuput.label
        }
    } else {
        let option = document.createElement('option')
        option.text = __.trans(
            'LABEL_SETTINGS_TAB_GENERAL_AUDIO_NO_DEVICES_FOUND'
        )
        option.value = 0
        audioOutputSelect.appendChild(option)
        audioOutputSelect.disabled = true
    }

    mInit()
})

function checkCompanionStatus() {
    if (settingsProvider.get('settings-companion-server')) {
        document
            .getElementById('companion-server-protect')
            .classList.remove('hide')
    } else {
        document
            .getElementById('companion-server-protect')
            .classList.add('hide')
    }
}

function checkWindows10ServiceStatus() {
    if (settingsProvider.get('settings-windows10-media-service')) {
        document.getElementById('windows-10-show-info').classList.remove('hide')
    } else {
        document.getElementById('windows-10-show-info').classList.add('hide')
    }
}

checkCompanionStatus()
checkWindows10ServiceStatus()

document.addEventListener('DOMContentLoaded', function () {
    initElement('settings-keep-background', 'click')
    initElement('settings-show-notifications', 'click')
    initElement('settings-start-on-boot', 'click')
    initElement('settings-start-minimized', 'click')
    initElement('settings-companion-server', 'click', () => {
        checkCompanionStatus()
    })
    initElement('settings-companion-server-protect', 'click')
    initElement('settings-continue-where-left-of', 'click')
    initElement('settings-windows10-media-service', 'click', () => {
        checkWindows10ServiceStatus(), showRelaunchButton()
    })
    initElement('settings-windows10-media-service-show-info', 'click', () => {
        showRelaunchButton()
    })
    initElement('settings-shiny-tray', 'click', () => {
        ipc.send('update-tray')
    })
    initElement('settings-discord-rich-presence', 'click')
    initElement('settings-app-language', 'change', showRelaunchButton)
    initElement('settings-clipboard-read', 'click', () => {
        ipc.send('switch-clipboard-watcher')
    })
    initElement('titlebar-type', 'change', showRelaunchButton)
    initElement('settings-custom-css-page', 'click')
    initElement('settings-last-fm-scrobbler', 'click', () => {
        var login = settingsProvider.get('last-fm-login')
        if (login.username == '') {
            ipc.send('window', { command: 'show-last-fm-login' })
        }
    })
    initElement('settings-rainmeter-web-now-playing', 'click')
    initElement('settings-enable-double-tapping-show-hide', 'click')
    initElement(
        'settings-disable-hardware-acceleration',
        'click',
        showRelaunchButton
    )

    initElement('settings-miniplayer-always-top', 'click')
    initElement('settings-miniplayer-resizable', 'click')
    initElement('settings-miniplayer-show-task', 'click')
    initElement('settings-miniplayer-always-show-controls', 'click')
    initElement('settings-miniplayer-paint-controls', 'click')
    initElement('settings-enable-taskbar-progressbar', 'click')

    mInit()

    document.getElementById('content').classList.remove('hide')
})

/*if (elementSettingsCompanionApp) {
    elementSettingsCompanionApp.addEventListener('click', function() {
        window.open(companionUrl, companionWindowTitle, companionWindowSettings)
    })
}*/

if (elementRangeZoom) {
    elementRangeZoom.addEventListener('input', function () {
        document.getElementById('range-zoom-value').innerText = this.value
        settingsProvider.set('settings-page-zoom', this.value)
        ipc.send('settings-value-changed', {
            key: 'settings-changed-zoom',
            value: this.value,
        })
    })
}

if (elementBtnOpenPageEditor) {
    elementBtnOpenPageEditor.addEventListener('click', function () {
        ipc.send('window', { command: 'show-editor-theme' })
    })
}

if (elementBtnLastFmLogin) {
    elementBtnLastFmLogin.addEventListener('click', function () {
        ipc.send('window', { command: 'show-last-fm-login' })
    })
}

if (elementBtnDiscordSettings) {
    elementBtnDiscordSettings.addEventListener('click', function () {
        ipc.send('window', { command: 'show-discord-settings' })
    })
}

if (elementBtnOpenCompanionServer) {
    elementBtnOpenCompanionServer.addEventListener('click', function () {
        shell.openExternal(`http://localhost:9863`)
    })
}

if (elementBtnAppRelaunch) {
    elementBtnAppRelaunch.addEventListener('click', function () {
        relaunch()
    })
}

if (!isMac()) {
    const macSpecificNodes = document.getElementsByClassName('macos-specific')
    for (let i = 0; i < macSpecificNodes.length; i++) {
        macSpecificNodes.item(i).classList.add('hide')
    }
}

if (!isWindows()) {
    const windowsSpecificNodes = document.getElementsByClassName(
        'windows-specific'
    )
    for (let i = 0; i < windowsSpecificNodes.length; i++) {
        windowsSpecificNodes.item(i).classList.add('hide')
    }
}

if (isWindows()) {
    const os = require('os')
    if (!os.release().startsWith('10.')) {
        const windows10SpecificNodes = document.getElementsByClassName(
            'windows10-specific'
        )
        for (let i = 0; i < windows10SpecificNodes.length; i++) {
            windows10SpecificNodes.item(i).classList.add('hide')
        }
    }
}

loadSettings()
__.loadi18n()
loadCustomKeys()

function showRelaunchButton() {
    elementBtnAppRelaunch.classList.remove('hide')
}

/**
 * Initialize element and create listener for it
 * @param {*} elementName
 * @param {*} eventType
 * @param {*} fn
 */
function initElement(elementName, eventType, fn) {
    if (fn === undefined) {
        fn = () => {}
    }
    const element = document.getElementById(elementName)

    if (element) {
        loadValue(element, elementName, eventType)
        createListener(element, elementName, eventType, fn)
    }
}

/**
 *
 * @param {*} element
 * @param {*} settingsName
 * @param {*} eventType
 * @param {*} fn
 */
function createListener(element, settingsName, eventType, fn) {
    element.addEventListener(eventType, function () {
        switch (eventType) {
            case 'click':
                settingsProvider.set(settingsName, this.checked)
                ipc.send('settings-value-changed', {
                    key: settingsName,
                    value: this.checked,
                })
                break

            case 'change':
                settingsProvider.set(settingsName, this.value)
                ipc.send('settings-value-changed', {
                    key: settingsName,
                    value: this.value,
                })
                break
        }
        fn()
    })
}

function loadValue(element, settingsName, eventType) {
    switch (eventType) {
        case 'click':
            element.checked = settingsProvider.get(settingsName, false)
            break

        case 'change':
            element.value = settingsProvider.get(settingsName)
            break
    }
}

function loadSettings() {
    // readLocales();

    if (settingsProvider.get('settings-page-zoom')) {
        document.getElementById('range-zoom').value = settingsProvider.get(
            'settings-page-zoom'
        )
        document.getElementById(
            'range-zoom-value'
        ).innerText = settingsProvider.get('settings-page-zoom')
    }

    document.getElementById('app-version').innerText = remote.app.getVersion()

    document.getElementById(
        'label-settings-companion-server-token'
    ).innerText = settingsProvider.get('settings-companion-server-token')

    // Disable unsupported platforms which may get an API later
    if (!['darwin', 'win32'].includes(process.platform)) {
        const startOnBootEl = document.getElementById('settings-start-on-boot')
        startOnBootEl.checked = false
        startOnBootEl.setAttribute('disabled', 'disabled')
    }
}

function relaunch() {
    remote.app.relaunch()
    remote.app.exit(0)
}

function readLocales() {
    fs.readdir(__dirname, (err, files) => {
        console.log(files)
    })
}

function mInit() {
    M.FormSelect.init(document.querySelectorAll('select'), {})
    M.Tabs.init(document.getElementsByClassName('tabs')[0], {})

    var elems = document.querySelectorAll('.modal')
    M.Modal.init(elems, {})
}

function replaceAcceleratorText(text) {
    text = text.replace(/\+/g, ' + ')

    if (text.indexOf('CmdOrCtrl') != -1) {
        if (isMac()) {
            text = text.replace('CmdOrCtrl', 'Cmd')
        } else {
            text = text.replace('CmdOrCtrl', 'Ctrl')
        }
    }

    text = text.replace('numadd', '+')

    text = text.replace('numsub', '-')

    text = text.replace('nummult', '*')

    text = text.replace('numdiv', '/')

    return text
}

function validateKey(e) {
    console.log(e)

    if (e.key == ' ') return 'Space'

    if (e.code == 'NumpadEnter') return 'Enter'

    if (e.code == 'NumpadAdd') return 'numadd'

    if (e.code == 'NumpadSubtract') return 'numsub'

    if (e.code == 'NumpadDecimal') return 'numdec'

    if (e.code == 'NumpadMultiply') return 'nummult'

    if (e.code == 'NumpadDivide') return 'numdiv'

    if (e.code == 'ArrowUp') return 'Up'

    if (e.code == 'ArrowDown') return 'Down'

    if (e.code == 'ArrowLeft') return 'Left'

    if (e.code == 'ArrowRight') return 'Right'

    if (e.keyCode >= 65 && e.keyCode <= 90) {
        return e.key.toUpperCase()
    }

    return e.key
}

function preventSpecialKeys(e) {
    return !(
        e.key == 'Command' ||
        e.key == 'Control' ||
        e.key == 'Alt' ||
        e.key == 'Shift' ||
        e.key == 'AltGraph' ||
        e.key == 'MediaPlayPause' ||
        e.key == 'MediaTrackPrevious' ||
        e.key == 'MediaTrackNext' ||
        e.key == 'MediaStop'
    )
}

document
    .querySelector('#modalEditAccelerator')
    .addEventListener('keyup', function (e) {
        if (preventSpecialKeys(e)) {
            keyBindings = ''

            if (e.ctrlKey) {
                keyBindings += 'CmdOrCtrl+'
            }

            if (e.altKey) {
                keyBindings += 'Alt+'
            }

            if (e.shiftKey) {
                keyBindings += 'Shift+'
            }

            keyBindings += validateKey(e)
            document.querySelector(
                '#modalEditAcceleratorKeys'
            ).innerText = replaceAcceleratorText(keyBindings)
        }
    })

function loadCustomKeys() {
    document.querySelector(
        '#settings-accelerators_media-play-pause'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-play-pause']
    )
    document.querySelector(
        '#settings-accelerators_media-track-next'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-track-next']
    )
    document.querySelector(
        '#settings-accelerators_media-track-previous'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-track-previous']
    )
    document.querySelector(
        '#settings-accelerators_media-track-like'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-track-like']
    )
    document.querySelector(
        '#settings-accelerators_media-track-dislike'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-track-dislike']
    )

    document.querySelector(
        '#settings-accelerators_media-volume-up'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-volume-up']
    )
    document.querySelector(
        '#settings-accelerators_media-volume-down'
    ).innerText = replaceAcceleratorText(
        settingsAccelerators['media-volume-down']
    )
}

function resetAcceleratorsText() {
    document.querySelector('#modalEditAcceleratorKeys').innerText = `${__.trans(
        'LABEL_SETTINGS_TAB_SHORTCUTS_PRESS_ANY_KEYS'
    )}...`
}

document
    .querySelector('#btn-accelerator-media-play-pause')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-play-pause'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-track-next')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-track-next'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-track-previous')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-track-previous'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-track-like')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-track-like'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-track-dislike')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-track-dislike'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-volume-up')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-volume-up'
        resetAcceleratorsText()
    })

document
    .querySelector('#btn-accelerator-media-volume-down')
    .addEventListener('click', () => {
        typeAcceleratorSelected = 'media-volume-down'
        resetAcceleratorsText()
    })

document.querySelector('#saveAccelerator').addEventListener('click', () => {
    ipc.send('change-accelerator', {
        type: typeAcceleratorSelected,
        oldValue: settingsAccelerators[typeAcceleratorSelected],
        newValue: keyBindings,
    })

    settingsAccelerators[typeAcceleratorSelected] = keyBindings

    settingsProvider.set('settings-accelerators', settingsAccelerators)

    loadCustomKeys()
})

document.querySelector('#disableAccelerator').addEventListener('click', () => {
    ipc.send('change-accelerator', {
        type: typeAcceleratorSelected,
        oldValue: settingsAccelerators[typeAcceleratorSelected],
        newValue: 'disabled',
    })

    settingsAccelerators[typeAcceleratorSelected] = 'disabled'

    settingsProvider.set('settings-accelerators', settingsAccelerators)

    loadCustomKeys()
})

document.querySelector('#release-notes').addEventListener('click', () => {
    ipc.send('window', { command: 'show-changelog' })
})
