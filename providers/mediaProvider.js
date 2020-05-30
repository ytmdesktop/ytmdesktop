const __ = require('./translateProvider')
const systemInfo = require('../utils/systemInfo')
const infoPlayerProvider = require('../providers/infoPlayerProvider')
const path = require('path')

function mediaPlayPauseTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: ';' })
    console.log('mediaPlayPause')
}

function mediaStopTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: ';' })
    console.log('mediaStop')
}

function mediaNextTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'j' })
    console.log('mediaNext')
}

function mediaPreviousTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'k' })
    console.log('mediaPrevious')
}

function mediaUpVote(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '+' })
    console.log('mediaUpVote')
}

function mediaDownVote(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '_' })
    console.log('mediaDownVote')
}

function mediaVolumeUp(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '=' })
    console.log('mediaVolumeUp')
}

function mediaVolumeDown(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '-' })
    console.log('mediaVolumeDown')
}

function mediaForwardTenSeconds(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'l' })
    console.log('mediaForward10Seconds')
}

function mediaRewindTenSeconds(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'h' })
    console.log('mediaRewindXSeconds')
}

function mediaRepeat(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'r' })
    console.log('mediaRepeat')
}

function mediaShuffle(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 's' })
    console.log('mediaShuffle')
}

function mediaChangeSeekbar(mainWindow, time) {
    infoPlayerProvider.setSeekbar(mainWindow.webContents, time)
}

function mediaChangeVolume(mainWindow, time) {
    infoPlayerProvider.setVolume(mainWindow.webContents, time)
}

function createThumbar(mainWindow, mediaInfo) {
    let isPaused = mediaInfo.player.isPaused
    let likeStatus = mediaInfo.player.likeStatus
    let hasId = mediaInfo.track.id

    let thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png'
    let thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png'
    let thumbsReverse = ''

    switch (likeStatus) {
        case 'LIKE':
            thumbsUp = '../assets/img/controls/thumbs-up-button.png'
            thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png'
            thumbsReverse = 'INDIFFERENT'
            break

        case 'DISLIKE':
            thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png'
            thumbsDown = '../assets/img/controls/thumbs-down-button.png'
            thumbsReverse = 'INDIFFERENT'
            break

        case 'INDIFFERENT':
            thumbsUp = '../assets/img/controls/thumbs-up-button-outline.png'
            thumbsDown = '../assets/img/controls/thumbs-down-button-outline.png'
            thumbsReverse = likeStatus == 'LIKE' ? 'DISLIKE' : 'LIKE'
            break
    }

    playOrPause = {
        tooltip: __.trans('MEDIA_CONTROL_PLAY'),
        icon: path.join(__dirname, '../assets/img/controls/play-button.png'),
        click: function() {
            mediaPlayPauseTrack(mainWindow.getBrowserView())
        },
    }

    if (isPaused == false) {
        playOrPause.tooltip = __.trans('MEDIA_CONTROL_PAUSE')
        playOrPause.icon = path.join(
            __dirname,
            '../assets/img/controls/pause-button.png'
        )
    }

    try {
        mainWindow.setThumbarButtons([
            {
                tooltip: __.trans('MEDIA_CONTROL_THUMBS_DOWN'),
                icon: path.join(__dirname, thumbsDown),
                click: function() {
                    mediaDownVote(
                        mainWindow.getBrowserView(),
                        createThumbar(mainWindow, mediaInfo)
                    )
                },
                flags: !hasId ? ['disabled'] : [],
            },
            {
                icon: path.join(__dirname, '../assets/img/null.png'),
                flags: ['disabled', 'nobackground'],
            },
            {
                tooltip: __.trans('MEDIA_CONTROL_PREVIOUS'),
                icon: path.join(
                    __dirname,
                    '../assets/img/controls/play-previous-button.png'
                ),
                click: function() {
                    mediaPreviousTrack(mainWindow.getBrowserView())
                },
                flags: !hasId ? ['disabled'] : [],
            },
            {
                tooltip: playOrPause.tooltip,
                icon: playOrPause.icon,
                click: function() {
                    mediaPlayPauseTrack(mainWindow.getBrowserView())
                },
                flags: !hasId ? ['disabled'] : [],
            },
            {
                tooltip: __.trans('MEDIA_CONTROL_NEXT'),
                icon: path.join(
                    __dirname,
                    '../assets/img/controls/play-next-button.png'
                ),
                click: function() {
                    mediaNextTrack(mainWindow.getBrowserView())
                },
                flags: !hasId ? ['disabled'] : [],
            },
            {
                icon: path.join(__dirname, '../assets/img/null.png'),
                flags: ['disabled', 'nobackground'],
            },
            {
                tooltip: __.trans('MEDIA_CONTROL_THUMBS_UP'),
                icon: path.join(__dirname, thumbsUp),
                click: function() {
                    mediaUpVote(
                        mainWindow.getBrowserView(),
                        createThumbar(mainWindow, mediaInfo)
                    )
                },
                flags: !hasId ? ['disabled'] : [],
            },
        ])
        mainWindow.setSkipTaskbar(false)
    } catch (e) {
        //console.log(e);
    }
}

function setProgress(mainWindow, progress, isPaused) {
    if (mainWindow) {
        if (systemInfo.isWindows()) {
            mainWindow.setProgressBar(progress, {
                mode: isPaused ? 'paused' : 'normal',
            })
        } else {
            mainWindow.setProgressBar(progress)
        }
    }
}

function createTouchBar(mainWindow) {
    // TODO: Implement touchbar
    // mainWindow.setTouchBar();
}

const guarder = (mainWindow, f) => {
    if (mainWindow && mainWindow.webContents) f(mainWindow)
}

exports.playPauseTrack = v => guarder(v, mediaPlayPauseTrack)
exports.stopTrack = v => guarder(v, mediaStopTrack)
exports.nextTrack = v => guarder(v, mediaNextTrack)
exports.previousTrack = v => guarder(v, mediaPreviousTrack)
exports.upVote = v => guarder(v, mediaUpVote)
exports.downVote = v => guarder(v, mediaDownVote)
exports.volumeUp = v => guarder(v, mediaVolumeUp)
exports.volumeDown = v => guarder(v, mediaVolumeDown)
exports.mediaForwardTenSeconds = v => guarder(v, mediaForwardTenSeconds)
exports.mediaRewindTenSeconds = v => guarder(v, mediaRewindTenSeconds)
exports.changeSeekbar = mediaChangeSeekbar
exports.changeVolume = mediaChangeVolume
exports.repeat = mediaRepeat
exports.shuffle = mediaShuffle

// For Windows
exports.createThumbar = createThumbar
exports.setProgress = setProgress
// For Mac
// exports.createTouchBar = createTouchBar;
