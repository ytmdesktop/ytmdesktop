const xosms = require('xosms')

const mediaControl = require('../providers/mediaProvider')
const settingsProvider = require('./settingsProvider')

class windowsMediaProvider {
    constructor() {
        this._view = null
        this._isInitialized = false
        this._controls = new xosms.MediaServiceProvider()

        if (!settingsProvider.get('settings-windows10-media-service-show-info'))
            this._controls.isEnabled = false
        else this._controls.isEnabled = true

        this._controls.nextButtonEnabled = true
        this._controls.pauseButtonEnabled = true
        this._controls.playButtonEnabled = true
        this._controls.previousButtonEnabled = true

        this._controls.playbackStatus = xosms.PlaybackStatus.Closed
        this._controls.mediaType = xosms.MediaType.Music

        this._controls.title = 'YouTube Music'
        this._controls.artist = ''
        this._controls.SetThumbnail(
            xosms.ThumbnailType.Uri,
            'https://avatars1.githubusercontent.com/u/48072485?s=500'
        )

        this._controls.buttonPressed = (button) => {
            switch (button) {
                case 'play':
                    mediaControl.playPauseTrack(this._view)
                    break
                case 'pause':
                    mediaControl.playPauseTrack(this._view)
                    break
                case 'next':
                    mediaControl.nextTrack(this._view)
                    break
                case 'previous':
                    mediaControl.previousTrack(this._view)
                    break
                default:
                    break
            }
        }
    }

    init(view) {
        this._view = view
        this._isInitialized = true
    }

    setPlaybackStatus(status) {
        if (this._isInitialized) {
            if (status)
                this._controls.playbackStatus = xosms.PlaybackStatus.Paused
            else this._controls.playbackStatus = xosms.PlaybackStatus.Playing
        }
    }

    setPlaybackData(title, author, cover, album) {
        if (this._isInitialized) {
            this._controls.title = title
            this._controls.artist = author
            this._controls.SetThumbnail(xosms.ThumbnailType.Uri, cover)
            this._controls.albumTitle = album
        }
    }
}

module.exports = new windowsMediaProvider()
