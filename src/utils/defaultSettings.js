const settingsProvider = require('../providers/settingsProvider')
const { isLinux } = require('./systemInfo')
const { app } = require('electron')

if (isLinux()) settingsProvider.setInitialValue('titlebar-type', 'system')
// With system title bar
else settingsProvider.setInitialValue('titlebar-type', 'nice') // Without system title bar

settingsProvider.setInitialValue('settings-page-zoom', 100) // 100

settingsProvider.setInitialValue('last-fm-login', {
    username: '',
    password: '',
}) // Empty user and pass

settingsProvider.setInitialValue('settings-app-language', 'en') // English

settingsProvider.setInitialValue('settings-miniplayer-size', '200') // Normal size

settingsProvider.setInitialValue('settings-miniplayer-resizable', false) // Not resizable

settingsProvider.setInitialValue('settings-miniplayer-show-task', false) // hide from taskbar

settingsProvider.setInitialValue('settings-miniplayer-always-top', false) // show on top always

settingsProvider.setInitialValue('settings-miniplayer-stream-config', false) // use base miniplayer

settingsProvider.setInitialValue('settings-lyrics-provider', '1') // OVH

settingsProvider.setInitialValue('settings-lyrics-always-top', false) // show on top always

settingsProvider.setInitialValue('settings-companion-server-protect', true) // Yes

settingsProvider.setInitialValue('settings-enable-player-bgcolor', false)

settingsProvider.setInitialValue(
    // Random token
    'settings-companion-server-token',
    Math.random().toString(36).substr(2, 5).toUpperCase()
)

settingsProvider.setInitialValue(
    'settings-enable-double-tapping-show-hide',
    true
) // Yes

settingsProvider.setInitialValue('settings-enable-taskbar-progressbar', true) // Yes

settingsProvider.setInitialValue('settings-accelerators', {
    'media-play-pause': 'CmdOrCtrl+Shift+Space',
    'media-track-next': 'CmdOrCtrl+Shift+PageUp',
    'media-track-previous': 'CmdOrCtrl+Shift+PageDown',
    'media-track-like': 'CmdOrCtrl+Shift+L',
    'media-track-dislike': 'CmdOrCtrl+Shift+D',
    'media-volume-up': 'CmdOrCtrl+Shift+Up',
    'media-volume-down': 'CmdOrCtrl+Shift+Down',
})

let accelerators = settingsProvider.get('settings-accelerators')
if (!accelerators['media-volume-up']) {
    accelerators['media-volume-up'] = 'CmdOrCtrl+Shift+Up'
    accelerators['media-volume-down'] = 'CmdOrCtrl+Shift+Down'
    settingsProvider.set('settings-accelerators', accelerators)
}

if (!accelerators['miniplayer-open-close']) {
    accelerators['miniplayer-open-close'] = 'CmdOrCtrl+Shift+M'
    settingsProvider.set('settings-accelerators', accelerators)
}

settingsProvider.setInitialValue('has-updated', false)

settingsProvider.setInitialValue('discord-presence-settings', {
    details: true,
    state: true,
    time: true,
    hideIdle: true,
})

settingsProvider.setInitialValue(
    'settings-disable-hardware-acceleration',
    false
)

settingsProvider.setInitialValue('settings-windows10-media-service', false)

settingsProvider.setInitialValue(
    'settings-windows10-media-service-show-info',
    false
)

settingsProvider.setInitialValue('settings-shortcut-buttons', {
    miniplayer: true,
    lyrics: true,
    'add-to-library': true,
    'add-to-playlist': true,
})

settingsProvider.setInitialValue('settings-skip-track-disliked', false)

settingsProvider.setInitialValue('settings-skip-track-shorter-than', '0')

settingsProvider.setInitialValue('settings-clipboard-always-ask-read', true)

settingsProvider.setInitialValue('settings-tray-icon', true)

settingsProvider.setInitialValue('settings-volume', 100)

settingsProvider.setInitialValue('settings-volume-media-keys', false)

settingsProvider.setInitialValue('settings-decibel-volume', true)

settingsProvider.setInitialValue(
    'settings-shiny-tray-song-title-rollable',
    true
)
settingsProvider.setInitialValue(
    'settings-locales-path',
    app.getPath('userData')
)

settingsProvider.setInitialValue('settings-pause-on-suspend', false)

settingsProvider.setInitialValue('settings-disable-analytics', false)

settingsProvider.setInitialValue('settings-surround-sound', false)

// Please note that this is a setting which is not displayed to the user, but will be used in the application.
settingsProvider.setInitialValue(
    'user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0'
)

// Update the User agent in the future via the Application side.
// if (settingsProvider.get('user-agent') === 'previous-useragent') {
// settingsProvider.setInitialValue('user-agent', 'Updated Useragent');
// }
