const clientId = '495666957501071390'
const RPC = require('discord-rpc')
const settingsProvider = require('./settingsProvider')

let client
let _isStarted
let discordActivity

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
        const discordSettings = settingsProvider.get(
            'discord-presence-settings'
        )

        if (discordSettings.default) {
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
                        (info.track.duration -
                            info.player.seekbarCurrentPosition) *
                            1000
                }
            }

            // activity.largeImageKey = 'ytm_logo_512'
            activity.largeImageKey = info.track.cover
            activity.smallImageKey = info.player.isPaused
                ? 'discordrpc-pause'
                : 'discordrpc-play'
            activity.largeImageText = 'YouTube Music'
            activity.smallImageText = info.player.isPaused
                ? 'Paused'
                : 'Playing'
            activity.instance = false
            if (discordSettings.details) {
                activity.buttons = [
                    {
                        label: 'Play on YouTube Music',
                        url:
                            'https://music.youtube.com/watch?v=' +
                            info.track.id,
                    },
                ]
            }
        } else {
            if (discordSettings.details)
                activity.details = `${info.track.title} - ${info.track.author}`
            if (discordSettings.state) {
                const progressBarD = {
                    fill: '═',
                    base: '─',
                    currentTime: '⬤',
                }

                const numberOfBars = 10

                const progress = Math.floor(
                    (info.player.seekbarCurrentPosition / info.track.duration) *
                        numberOfBars
                )

                let status = ''
                let replacer = ''

                for (let index = 0; index < numberOfBars; index++) {
                    if (index == progress) replacer = progressBarD.currentTime
                    else if (index < progress) replacer = progressBarD.fill
                    else replacer = progressBarD.base
                    status += replacer
                }

                activity.state = status
            }

            if (discordSettings.time) {
                if (info.player.isPaused) {
                    delete activity.startTimestamp
                    delete activity.endTimestamp
                } else {
                    activity.startTimestamp =
                        now + info.player.seekbarCurrentPosition * 1000
                    activity.endTimestamp =
                        now +
                        (info.track.duration -
                            info.player.seekbarCurrentPosition) *
                            1000
                }
            }

            // activity.largeImageKey = 'ytm_logo_512'
            activity.largeImageKey = info.track.cover
            activity.smallImageKey = info.player.isPaused
                ? 'discordrpc-pause'
                : 'discordrpc-play'
            activity.largeImageText = 'YouTube Music'
            activity.smallImageText = info.player.isPaused
                ? 'Paused'
                : 'Playing'
            activity.instance = false
            if (discordSettings.details) {
                activity.buttons = [
                    {
                        label: 'Play on YouTube Music',
                        url:
                            'https://music.youtube.com/watch?v=' +
                            info.track.id,
                    },
                ]
            }
        }

        if (
            (!discordSettings.hideIdle && info.player.isPaused) ||
            info.track.isAdvertisement
        ) {
            await client.clearActivity()
        } else {
            discordActivity = {
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
            }
        }
    }
}

setInterval(async () => {
    await client?.request('SET_ACTIVITY', {
        pid: process.pid,
        activity: discordActivity,
    })
}, 5000)

module.exports = {
    isStarted: isStarted,
    start: start,
    stop: stop,
    setActivity: setActivity,
}
