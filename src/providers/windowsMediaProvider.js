const {
    MediaPlaybackStatus,
    MediaPlaybackType,
    SystemMediaTransportControlsButton,
} = require('@nodert-win10-rs4/windows.media')
const { BackgroundMediaPlayer } = require('windows.media.playback')
const {
    RandomAccessStreamReference,
} = require('@nodert-win10-rs4/windows.storage.streams')
const { Uri } = require('@nodert-win10-rs4/windows.foundation')

const mediaControl = require('../providers/mediaProvider')
const settingsProvider = require('./settingsProvider')

class windowsMediaProvider {
    constructor() {
        this._view = null
        this._isInitialized = false
        this._controls =
            BackgroundMediaPlayer.current.systemMediaTransportControls

        if (!settingsProvider.get('settings-windows10-media-service-show-info'))
            this._controls.isEnabled = false

        this._controls.isChannelDownEnabled = false
        this._controls.isChannelUpEnabled = false
        this._controls.isFastForwardEnabled = false
        this._controls.isRecordEnabled = false
        this._controls.isRewindEnabled = false
        this._controls.isNextEnabled = true
        this._controls.isPauseEnabled = true
        this._controls.isPlayEnabled = true
        this._controls.isPreviousEnabled = true

        this._controls.playbackStatus = MediaPlaybackStatus.closed
        this._controls.displayUpdater.type = MediaPlaybackType.music

        this._controls.displayUpdater.musicProperties.title = 'YouTube Music'
        this._controls.displayUpdater.musicProperties.artist = ''
        this._controls.displayUpdater.thumbnail = RandomAccessStreamReference.createFromUri(
            new Uri('https://avatars1.githubusercontent.com/u/48072485?s=500')
        )

        this._controls.displayUpdater.update()

        this._controls.on('buttonpressed', (sender, eventArgs) => {
            switch (eventArgs.button) {
                case SystemMediaTransportControlsButton.play:
                    mediaControl.playPauseTrack(this._view)
                    break
                case SystemMediaTransportControlsButton.pause:
                    mediaControl.playPauseTrack(this._view)
                    break
                case SystemMediaTransportControlsButton.next:
                    mediaControl.nextTrack(this._view)
                    break
                case SystemMediaTransportControlsButton.previous:
                    mediaControl.previousTrack(this._view)
                    break
                default:
                    break
            }
        })
    }

    init(view) {
        this._view = view
        this._isInitialized = true
    }

    setPlaybackStatus(status) {
        if (this._isInitialized) {
            if (status)
                this._controls.playbackStatus = MediaPlaybackStatus.paused
            else this._controls.playbackStatus = MediaPlaybackStatus.playing

            this._controls.displayUpdater.update()
        }
    }

    setPlaybackData(title, author, cover, album) {
        if (this._isInitialized) {
            this._controls.displayUpdater.musicProperties.title = title
            this._controls.displayUpdater.musicProperties.artist = author
            this._controls.displayUpdater.thumbnail = RandomAccessStreamReference.createFromUri(
                new Uri(cover)
            )
            this._controls.displayUpdater.musicProperties.albumTitle = album
            this._controls.displayUpdater.update()
        }
    }
}

module.exports = new windowsMediaProvider()
