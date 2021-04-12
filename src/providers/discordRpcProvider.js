const clientId = '495666957501071390'
const RPC = require('discord-rpc')
const settingsProvider = require('./settingsProvider')
const __ = require('./translateProvider')
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

        if (!discordSettings.hideIdle && info.player.isPaused) {
            client.clearActivity()
        } else {
            client.request('SET_ACTIVITY', {
                pid: process.pid,
                activity: {
                    details: info.track.title,
                    state: info.track.author,
                    timestamps: {
                        start: now + info.player.seekbarCurrentPosition * 1000,
                        end:
                            now +
                            (info.track.duration -
                                info.player.seekbarCurrentPosition) *
                                1000,
                    },
                    assets: {
                        large_image: 'ytm_logo_512', // large image key from developer portal > rich presence > art assets
                        large_text: 'Youtube Music',
                        small_image: info.player.isPaused
                            ? 'discordrpc-pause'
                            : 'discordrpc-play',
                        small_text: info.player.isPaused ? 'Paused' : 'Playing',
                    },
                    buttons: [
                        {
                            label: __.trans('RPC_PLAY_ON_YOUTUBE_MUSIC'),
                            url: info.track.url,
                        },
                    ],
                },
            })
            /*
            client.setActivity(activity).catch((err) => {
                console.log(err)
            })
            */
        }
    }
}

module.exports = {
    isStarted: isStarted,
    start: start,
    stop: stop,
    setActivity: setActivity,
}
