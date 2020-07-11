const { remote, ipcRenderer: ipc, shell } = require('electron')
const settingsProvider = require('../../providers/settingsProvider')
const __ = require('../../providers/translateProvider')

//var, because we have to re-assign the variable
var discordSettings = null
let buttonSave = document.getElementById('btn-save')

__.loadi18n()

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

document.addEventListener('DOMContentLoaded', function () {
    loadSettings()
})

buttonSave.addEventListener('click', function () {
    settingsProvider.set('discord-presence-settings', {
        details: document.getElementById('settings-discord-show-title').checked,
        state: document.getElementById('settings-discord-show-artist').checked,
        time: document.getElementById('settings-discord-show-time').checked,
        hideIdle: document.getElementById('settings-discord-show-idle').checked,
    })
    loadSettings()
    buttonSave.innerText = __.trans('LABEL_SAVED')
})
