const MediaService = require('electron-media-service');
const mediaControl = require('../providers/mediaProvider')

class MacMediaProvider {
    constructor() {
        this.view = null;
        this.mediaService = new MediaService();
        this.lastObj = {};

        this.mediaService.on('play', () => {
            if (this.lastObj.state === 'paused' && !this.attemptedAction) {
                mediaControl.playPauseTrack(this.view);
                this.attemptedAction = true;
            }
        });

        this.mediaService.on('pause', () => {
            if (this.lastObj.state === 'playing' && !this.attemptedAction) {
                mediaControl.playPauseTrack(this.view);
                this.attemptedAction = true;
            }
        })

        this.mediaService.on('playPause', () => {
            if (!this.attemptedAction) {
                mediaControl.playPauseTrack(this.view);
                this.attemptedAction = true;
            }
        })

        this.mediaService.on('next', () => {
            if (!this.attemptedAction) {
                mediaControl.nextTrack(this.view);
                this.attemptedAction = true;
            }
        });

        this.mediaService.on('previous', () => {
            if (!this.attemptedAction) {
                mediaControl.previousTrack(this.view);
                this.attemptedAction = true;
            }
        });

        this.mediaService.on('seek', (to) => {
            if (!this.attemptedAction) {
                mediaControl.changeSeekbar(this.view, to / 1000);
                this.attemptedAction = true;
            }
        });
    }

    init(view) {
        this.view = view;
        this.mediaService.startService();
    }

    setPlaybackData(title, artist, cover, album, time, duration, playing) {
        if (this.lastTime == time) {
            return;
        }

        this.lastObj = {
            title,
            artist,
            album,
            state: playing ? 'playing' : 'paused',
            albumArt: cover,
            id: this.hashCode(title),
            currentTime: time * 1000,
            duration: duration * 1000 
        };
        this.attemptedAction = false;
        this.mediaService.setMetaData(this.lastObj);
    }

    hashCode(str) {
        var hash = 0, i, chr;
        for (i = 0; i < str.length; i++) {
          chr   = str.charCodeAt(i);
          hash  = ((hash << 5) - hash) + chr;
          hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }
}

module.exports = new MacMediaProvider();