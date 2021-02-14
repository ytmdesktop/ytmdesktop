const clientId = '495666957501071390'
const RPC = require('discord-rpc')
const settingsProvider = require('./settingsProvider')

var client
var _isStarted

function isStarted() {
    return _isStarted
}

function _setIsStarted(value) {
    _isStarted = value
}

function start() {
    client = new RPC.Client({ transport: 'ipc' })

    client.on('ready', () => {
        _setIsStarted(true)
    })

    client.login({ clientId }).catch(() => {
        if (!isStarted()) {
            setTimeout(function () {
                start()
            }, 10000)
        }
    })

    client.on('disconnected', () => {
        _setIsStarted(false)
        start()
    })
}

function stop() {
    client.destroy()
    _setIsStarted(false)
}

function setActivity(info) {
    if (isStarted() && info.track.title) {
        var now = Date.now()
        var activity = {}
        var discordSettings = settingsProvider.get('discord-presence-settings')

        if (discordSettings.details) activity.details = info.track.title

        if (discordSettings.state) activity.state = info.track.author

        if (discordSettings.time) {
            if (info.player.isPaused) {
                delete activity.startTimestamp
                delete activity.endTimestamp
            } else {
                activity.startTimestamp =
                    now + info.player.seekbarCurrentPosition * 1000
                activity.endTimestamp =
                    now +
                    (info.track.duration - info.player.seekbarCurrentPosition) *
                        1000
            }
        }

        activity.largeImageKey = 'ytm_logo_512'
        activity.smallImageKey = info.player.isPaused
            ? 'discordrpc-pause'
            : 'discordrpc-play'
        activity.largeImageText = 'YouTube Music'
        activity.smallImageText = info.player.isPaused ? 'Paused' : 'Playing'
        activity.instance = false
        if (
            (!discordSettings.hideIdle && info.player.isPaused) ||
            info.track.isAdvertisement
        ) {
            client.clearActivity()
        } else {
            client.setActivity(activity).catch((err) => {
                console.log(err)
            })
        }
    }
}

module.exports = {
    isStarted: isStarted,
    start: start,
    stop: stop,
    setActivity: setActivity,
}
