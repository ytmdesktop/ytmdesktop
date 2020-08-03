const {
    MediaPlaybackStatus,
    MediaPlaybackType,
    SystemMediaTransportControlsButton,
} = require('@nodert-win10/windows.media')
const {
    BackgroundMediaPlayer,
} = require('@nodert-win10/windows.media.playback')
const {
    RandomAccessStreamReference,
} = require('@nodert-win10/windows.storage.streams')
const { Uri } = require('@nodert-win10/windows.foundation')

const mediaControl = require('../providers/mediaProvider')

class windowsMediaProvider {
    constructor() {
        this._webContents
        this._isInitialized = false
        this._controls =
            BackgroundMediaPlayer.current.systemMediaTransportControls

        this._controls.isChannelDownEnabled = false
        this._controls.isChannelUpEnabled = false
        this._controls.isFastForwardEnabled = false
        this._controls.isRecordEnabled = false
        this._controls.isRewindEnabled = false

        this._controls.isEnabled = true
        this._controls.isNextEnabled = true
        this._controls.isPauseEnabled = true
        this._controls.isPlayEnabled = true
        this._controls.isPreviousEnabled = true

        this._controls.playbackStatus = MediaPlaybackStatus.closed
        this._controls.displayUpdater.type = MediaPlaybackType.music

        this._controls.displayUpdater.musicProperties.title = 'YouTube Music'
        this._controls.displayUpdater.musicProperties.artist = '-'
        this._controls.displayUpdater.update()

        this._controls.on('buttonpressed', (sender, eventArgs) => {
            switch (eventArgs.button) {
                case SystemMediaTransportControlsButton.play:
                    mediaControl.playPauseTrack(this._webContents)
                    break
                case SystemMediaTransportControlsButton.pause:
                    mediaControl.playPauseTrack(this._webContents)
                    break
                case SystemMediaTransportControlsButton.next:
                    mediaControl.nextTrack(this._webContents)
                    break
                case SystemMediaTransportControlsButton.previous:
                    mediaControl.previousTrack(this._webContents)
                    break
                default:
                    break
            }
        })
    }

    init(view) {
        this._webContents = view.webContents
        this._isInitialized = true
    }

    setPlaybackStatus(status) {
        if (this._isInitialized) {
            if (status) {
                this._controls.playbackStatus = MediaPlaybackStatus.paused
            } else {
                this._controls.playbackStatus = MediaPlaybackStatus.playing
            }
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
