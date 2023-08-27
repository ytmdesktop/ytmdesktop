const settingsProvider = require('../../../../providers/settingsProvider')
const __ = require('../../../../providers/translateProvider')
const {
    handleWindowButtonsInit,
    updateWindowTitle,
} = require('../../../../utils/window')

var shortcutSettings = null

__.loadi18n()

handleWindowButtonsInit()
updateWindowTitle()

function loadSettings() {
    shortcutSettings = settingsProvider.get('settings-shortcut-buttons')
    document.getElementById('settings-shortcut-show-miniplayer').checked =
        shortcutSettings.miniplayer
    document.getElementById('settings-shortcut-show-lyrics').checked =
        shortcutSettings.lyrics
    document.getElementById('settings-shortcut-show-add-to-library').checked =
        shortcutSettings['add-to-library']
    document.getElementById('settings-shortcut-show-add-to-playlist').checked =
        shortcutSettings['add-to-playlist']
}

function save() {
    settingsProvider.set('settings-shortcut-buttons', {
        miniplayer: document.getElementById('settings-shortcut-show-miniplayer')
            .checked,
        lyrics: document.getElementById('settings-shortcut-show-lyrics')
            .checked,
        'add-to-library': document.getElementById(
            'settings-shortcut-show-add-to-library'
        ).checked,
        'add-to-playlist': document.getElementById(
            'settings-shortcut-show-add-to-playlist'
        ).checked,
    })
}

document.addEventListener('DOMContentLoaded', function () {
    loadSettings()
})

document.querySelectorAll('input').forEach((input) => {
    input.addEventListener('click', () => save())
})
