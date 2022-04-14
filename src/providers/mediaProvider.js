const __ = require('./translateProvider')
const systemInfo = require('../utils/systemInfo')
const infoPlayerProvider = require('../providers/infoPlayerProvider')
const path = require('path')
const settingsProvider = require('./settingsProvider')

function mediaPlayPauseTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: ';' })
}

function mediaStopTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: ';' })
}

function mediaNextTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'j' })
}

function mediaPreviousTrack(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'k' })
}

function mediaUpVote(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '+' })
}

function mediaDownVote(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '_' })
}

function mediaVolumeUp(mainWindow) {
    if (settingsProvider.get('settings-decibel-volume')) {
        let percent = infoPlayerProvider.getPlayerInfo().volumePercent
        infoPlayerProvider.setVolume(
            mainWindow.webContents,
            decibelToPercent(percentToDecibel(percent) + 1.5)
        )
    } else
        mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '=' })
}

function mediaVolumeDown(mainWindow) {
    if (settingsProvider.get('settings-decibel-volume')) {
        let percent = infoPlayerProvider.getPlayerInfo().volumePercent
        infoPlayerProvider.setVolume(
            mainWindow.webContents,
            decibelToPercent(percentToDecibel(percent) - 1.5)
        )
    } else
        mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: '-' })
}

function mediaForwardTenSeconds(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'l' })
}

function mediaRewindTenSeconds(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'h' })
}

function mediaRepeat(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 'r' })
}

function mediaShuffle(mainWindow) {
    mainWindow.webContents.sendInputEvent({ type: 'keydown', keyCode: 's' })
}

function mediaChangeSeekbar(mainWindow, time) {
    infoPlayerProvider.setSeekbar(mainWindow.webContents, time)
}

function mediaChangeVolume(mainWindow, time) {
    infoPlayerProvider.setVolume(mainWindow.webContents, time)
}

function mediaChangeSpeed(mainWindow, value) {
    infoPlayerProvider.setSpeed(mainWindow.webContents, value)
}

async function mediaSelectQueueItem(mainWindow, index) {
    await infoPlayerProvider.setQueueItem(mainWindow.webContents, index)
}

function mediaAddToLibrary(mainWindow) {
    infoPlayerProvider.addToLibrary(mainWindow.webContents)
}

function mediaAddToPlaylist(mainWindow, index) {
    infoPlayerProvider.addToPlaylist(mainWindow.webContents, index)
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
            thumbsReverse = likeStatus === 'LIKE' ? 'DISLIKE' : 'LIKE'
            break
    }

    playOrPause = {
        tooltip: __.trans('MEDIA_CONTROL_PLAY'),
        icon: path.join(__dirname, '../assets/img/controls/play-button.png'),
        click: () => {
            mediaPlayPauseTrack(mainWindow.getBrowserView())
        },
    }

    if (isPaused === false) {
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
                click: () => {
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
                click: () => {
                    mediaPreviousTrack(mainWindow.getBrowserView())
                },
                flags: !hasId ? ['disabled'] : [],
            },
            {
                tooltip: playOrPause.tooltip,
                icon: playOrPause.icon,
                click: () => {
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
                click: () => {
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
                click: () => {
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

function percentToDecibel(percent) {
    return Math.min(Math.max(20.0 * Math.log10(percent / 100.0), -100.0), 0.0)
}

function decibelToPercent(decibel) {
    return Math.min(
        Math.max(Math.pow(10.0, decibel / 20.0) * 100.0, 0.0),
        100.0
    )
}

function setProgress(mainWindow, progress, isPaused) {
    if (mainWindow)
        if (systemInfo.isWindows())
            mainWindow.setProgressBar(progress, {
                mode: isPaused ? 'paused' : 'normal',
            })
        else mainWindow.setProgressBar(progress)
}

function createTouchBar(mainWindow) {
    // TODO: Implement touchbar
    // mainWindow.setTouchBar();
}

const guarder = (mainWindow, f) => {
    if (mainWindow && mainWindow.webContents) f(mainWindow)
}

exports.playPauseTrack = (v) => guarder(v, mediaPlayPauseTrack)
exports.stopTrack = (v) => guarder(v, mediaStopTrack)
exports.nextTrack = (v) => guarder(v, mediaNextTrack)
exports.previousTrack = (v) => guarder(v, mediaPreviousTrack)
exports.upVote = (v) => guarder(v, mediaUpVote)
exports.downVote = (v) => guarder(v, mediaDownVote)
exports.volumeUp = (v) => guarder(v, mediaVolumeUp)
exports.volumeDown = (v) => guarder(v, mediaVolumeDown)
exports.mediaForwardTenSeconds = (v) => guarder(v, mediaForwardTenSeconds)
exports.mediaRewindTenSeconds = (v) => guarder(v, mediaRewindTenSeconds)
exports.changeSeekbar = mediaChangeSeekbar
exports.changeVolume = mediaChangeVolume
exports.changeSpeed = mediaChangeSpeed
exports.selectQueueItem = mediaSelectQueueItem
exports.repeat = mediaRepeat
exports.shuffle = mediaShuffle
exports.addToLibrary = mediaAddToLibrary
exports.addToPlaylist = mediaAddToPlaylist

// For Windows
exports.createThumbar = createThumbar
exports.setProgress = setProgress
// For Mac
// exports.createTouchBar = createTouchBar;
