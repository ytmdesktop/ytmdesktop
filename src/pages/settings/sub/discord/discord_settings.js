const settingsProvider = require('../../../../providers/settingsProvider')
const __ = require('../../../../providers/translateProvider')
const {
    handleWindowButtonsInit,
    updateWindowTitle,
} = require('../../../../utils/window')

//var, because we have to re-assign the variable
var discordSettings = null

__.loadi18n()

handleWindowButtonsInit()
updateWindowTitle()

function loadSettings() {
    discordSettings = settingsProvider.get('discord-presence-settings')
    document.getElementById('settings-discord-show-title').checked =
        discordSettings.details
    document.getElementById('settings-discord-show-artist').checked =
        discordSettings.state
    document.getElementById('settings-discord-show-time').checked =
        discordSettings.time
    document.getElementById('settings-discord-show-idle').checked =
        discordSettings.hideIdle
}

function save() {
    settingsProvider.set('discord-presence-settings', {
        details: document.getElementById('settings-discord-show-title').checked,
        state: document.getElementById('settings-discord-show-artist').checked,
        time: document.getElementById('settings-discord-show-time').checked,
        hideIdle: document.getElementById('settings-discord-show-idle').checked,
    })
}

document.addEventListener('DOMContentLoaded', function () {
    loadSettings()
})

document.querySelectorAll('input').forEach((input) => {
    input.addEventListener('click', () => save())
})
