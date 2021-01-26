const clientId = '495666957501071390'
const RPC = require('discord-rpc')
const settingsProvider = require('./settingsProvider')

let client
let _isStarted

function isStarted() {
    return _isStarted
}

function _setIsStarted(value) {
    _isStarted = value
}

function start() {
    client = new RPC.Client({ transport: 'ipc' })

    client.on('ready', () => _setIsStarted(true))

    client.login({ clientId }).catch(() => {
        if (!isStarted()) {
            setTimeout(() => {
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

async function setActivity(info) {
    if (isStarted() && info.track.title) {
        const now = Date.now()
        const activity = {}
        const discordSettings = settingsProvider.get('discord-presence-settings')

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
        if (discordSettings.details) {
            activity.buttons = [
                {
                    label: 'Play on YouTube Music',
                    url: 'https://music.youtube.com/watch?v=' + info.track.id,
                },
            ]
        }

        if (!discordSettings.hideIdle && info.player.isPaused) {
            await client.clearActivity()
        } else {
            // As of writing this discord-rpc was not updated to support buttons with setActivity
            await client.request('SET_ACTIVITY', {
                pid: process.pid,
                activity: {
                    state: activity.state,
                    details: activity.details,
                    timestamps: {
                        start: activity.startTimestamp,
                        end: activity.endTimestamp,
                    },
                    assets: {
                        large_image: activity.largeImageKey,
                        large_text: activity.largeImageText,
                        small_image: activity.smallImageKey,
                        small_text: activity.smallImageText,
                    },
                    instance: activity.instance,
                    buttons: activity.buttons,
                },
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
