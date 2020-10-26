const { ipcMain } = require('electron')
const mpris = require('mpris-service')

class Mpris {
    constructor() {
        this._isInitialized = false
        this.player = undefined
        this._realPlayer = undefined //we'll need the infoPlayer later to be better able to track the time.
    }

    start() {
        this.player = new mpris({
            name: 'youtube-music-desktop-app',
            identity: 'Youtube Music',
            supportedUriSchemes: ['file'],
            supportedMimeTypes: ['audio/mpeg', 'application/ogg'],
            supportedInterfaces: ['player'],
        })

        this._setInitialEvents()

        this._isInitialized = true
    }

    setRealPlayer(infoPlayer) {
        if (this.player) {
            this._realPlayer = infoPlayer
            //Overriding this method makes it a lot easier to be able to controll the playback position.
            this.player.getPosition = () =>
                this._realPlayer.getPlayerInfo().seekbarCurrentPosition *
                1000 *
                1000
        }
    }

    setActivity(info) {
        if (this._isInitialized) {
            this.player.metadata = {
                'mpris:trackid': this.player
                    .objectPath('track/0')
                    .replaceAll('-', '_'), // replacing -'s in name with _ to meet dbus object name spec
                'mpris:length': info.track.duration * 1000 * 1000, // In microseconds
                'mpris:artUrl': info.track.cover,
                'xesam:title': info.track.title,
                'xesam:album': info.track.album,
                'xesam:artist': [info.track.author],
            }
            this.player.playbackStatus = info.player.isPaused
                ? mpris.PLAYBACK_STATUS_PAUSED
                : mpris.PLAYBACK_STATUS_PLAYING
        }
    }

    _setInitialEvents() {
        const events = {
            quit: () => process.exit(0),
            previous: 'media-track-previous',
            next: 'media-track-next',
            pause: 'media-play-pause',
            play: 'media-play-pause',
            playpause: 'media-play-pause', //KDE Connect only sends this event it looked like.
        }

        for (let [event, action] of Object.entries(events)) {
            if (typeof action === 'string')
                this.player.on(event, () => {
                    ipcMain.emit('media-command', {
                        command: action,
                        value: true,
                    })
                })
            else if (typeof action === 'function') this.player.on(event, action)
        }
        this.player.on('position', (args) => {
            // the position event sends through {trackId : ###, position : ###}
            ipcMain.emit('media-command', {
                command: 'media-seekbar-set',
                value: args.position / (1000 * 1000),
            })
        })

        this.player.on('seek', (offset) => {
            // the seek event sends through the difference from where we should be in microseconds, positive forward, negative backward
            ipcMain.emit('media-command', {
                command: 'media-seekbar-set',
                value: (this.player.getPosition() + offset) / (1000 * 1000),
            })
        })
    }
}

module.exports = new Mpris()
