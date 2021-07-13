const settingsProvider = require('./settingsProvider')

let webContents, initialized

const player = {
    hasSong: false,
    isPaused: true,
    volumePercent: 0,
    seekbarCurrentPosition: 0,
    seekbarCurrentPositionHuman: '0:00',
    statePercent: 0.0,
    likeStatus: 'INDIFFERENT',
    repeatType: 'NONE',
}

const track = {
    author: '',
    title: '',
    album: '',
    cover: '',
    duration: 0,
    durationHuman: '0:00',
    url: '',
    id: '',
    isVideo: false,
    isAdvertisement: false,
    inLibrary: false,
}

let _queue = {
    automix: false,
    currentIndex: 0,
    list: [],
}

let _playlist = {
    list: [],
}

const _lyrics = {
    provider: '',
    data: '',
    hasLoaded: false,
}

function init(view) {
    webContents = view.webContents
    initialized = true
    toggleMoreActions(webContents)
    toggleMoreActions(webContents)

    initVolume()
}

function initVolume() {
    setVolume(webContents, settingsProvider.get('settings-volume'))
}

function getAllInfo() {
    return {
        player: getPlayerInfo(),
        track: getTrackInfo(),
    }
}

function getPlayerInfo() {
    if (webContents === undefined) return player

    hasSong()
    isPaused(webContents)
    getVolume(webContents)
    getSeekbarPosition(webContents)
    getLikeStatus(webContents)
    getRepeatType(webContents)
    return player
}

function getTrackInfo() {
    if (webContents === undefined) return track

    getAuthor(webContents)
    getTitle(webContents)
    getAlbum(webContents)
    getCover(webContents)
    getDuration(webContents)
    getUrl(webContents)
    setPercent(player.seekbarCurrentPosition, track.duration)
    isVideo(webContents)
    isAdvertisement(webContents)
    return track
}

function getQueueInfo() {
    return _queue
}

function updateQueueInfo() {
    if (webContents !== undefined) getQueue(webContents)
}

function getPlaylistInfo() {
    return _playlist
}

function updatePlaylistInfo() {
    if (webContents !== undefined) getPlaylist(webContents)
}

function getLyricsInfo() {
    return _lyrics
}

function hasSong() {
    player.hasSong = track.id !== ''
}

function isPaused(webContents) {
    webContents
        .executeJavaScript(`document.querySelector('video').paused;`)
        .then((isPaused) => {
            debug(`Is paused: ${isPaused}`)
            player.isPaused = isPaused
        })
        .catch((_) => console.log('error isPaused'))
}

function getTitle(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('.title.ytmusic-player-bar').textContent;`
        )
        .then((title) => {
            debug(`Title is: ${title}`)
            track.title = title
        })
        .catch((_) => console.log('error getTitle'))
}

function getDuration(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('#progress-bar').getAttribute('aria-valuemax');`
        )
        .then((duration) => {
            debug(`Duration is: ${parseInt(duration)}`)
            track.duration = parseInt(duration)
            track.durationHuman = convertToHuman(parseInt(duration))
        })
        .catch((_) => console.log('error getDuration'))
}

/**
 * Get Like status
 * LIKE | DISLIKE | INDIFFERENT
 * @param {*} webContents
 */
function getLikeStatus(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('#like-button-renderer').getAttribute('like-status');`
        )
        .then((likeStatus) => {
            debug(`Like status is: ${likeStatus}`)
            player.likeStatus = likeStatus
        })
        .catch((_) => console.log('error getLikeStatus'))
}

/**
 * GET CURRENT SEEK BAR POSITION
 * @param {*} webContents
 */
function getSeekbarPosition(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('#progress-bar').getAttribute('aria-valuenow');`
        )
        .then((position) => {
            debug(`Seekbar position is: ${parseInt(position)}`)
            player.seekbarCurrentPosition = parseInt(position)
            player.seekbarCurrentPositionHuman = convertToHuman(
                parseInt(position)
            )
        })
        .catch((_) => console.log('error getSeekbarPosition'))
}

function getVolume(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('.volume-slider.ytmusic-player-bar').getAttribute('value');`
        )
        .then((volume) => {
            debug(`Volume % is: ${parseFloat(volume)}`)
            player.volumePercent = parseFloat(volume)
        })
        .catch((_) => console.log('error getVolume'))
}

function getAuthor(webContents) {
    webContents
        .executeJavaScript(
            `
            var title = '';
            var artist_album_and_year = document.getElementsByClassName('subtitle ytmusic-player-bar')[0].textContent;
            var split_by_dot = artist_album_and_year.split(" • ");
            title = split_by_dot[0].trim();
            `
        )
        .then((author) => {
            debug(`Author is: ${author}`)
            track.author = author
        })
        .catch((_) => console.log('error getAuthor'))
}

function getAlbum(webContents) {
    webContents
        .executeJavaScript(
            `
            var album = '';
            var artist_album_and_year = document.getElementsByClassName('subtitle ytmusic-player-bar')[0].textContent;
            var split_by_dot = artist_album_and_year.split(" • ");
            
            // Ensure that we actually have album data set
            if (split_by_dot.length > 1) {
                album = split_by_dot[1];
            }            
            album;
            `
        )
        .then((album) => {
            debug(`Album is: ${album}`)
            track.album = album
        })
        .catch((_) => console.log('error getAlbum'))
}

function getCover(webContents) {
    webContents
        .executeJavaScript(
            `
            var cover;

            var thumbnail = document.querySelector('.thumbnail.ytmusic-player.no-transition');
            var image = thumbnail.querySelector('.yt-img-shadow').src;

            cover = image;

            if (cover.includes("data:image")) {
                cover = document.querySelector(".image.ytmusic-player-bar").src;
            }

            cover;
            `
        )
        .then((cover) => {
            debug(`Cover is: ${cover}`)
            track.cover = cover
        })
        .catch((_) => console.log('error getCover'))
}

function getRepeatType(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector("ytmusic-player-bar").getAttribute("repeat-mode_");`
        )
        .then((repeatType) => {
            debug(`Repeat type is: ${repeatType}`)
            player.repeatType = repeatType
        })
        .catch((_) => console.log('error getRepeatType'))
}

function getUrl(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('.ytp-title-link.yt-uix-sessionlink').href`
        )
        .then((url) => {
            if (url) {
                track.url = url

                const newUrl = new URL(url)
                const searchParams = new URLSearchParams(newUrl.search)

                track.id = searchParams.get('v')
                debug(`Track Url: ${track.url}`)
                debug(`Track id: ${track.id}`)
            }
        })
        .catch((_) => console.log('error getUrl'))
}

function getQueue(webContents) {
    webContents
        .executeJavaScript(
            `
            var element = document.querySelector('ytmusic-player-queue #contents')
            var children = element.children

            var arrChildren = Array.from(children)
            
            var queue = { automix: false, currentIndex: 0, list: [] };

            arrChildren.forEach( (el, key) => { 
                var songElement = el.querySelector('.song-info')

                var songCover = songElement.parentElement.querySelector('.yt-img-shadow').getAttribute('src')
                var songTitle = songElement.querySelector('.song-title').getAttribute('title')
                var songAuthor = songElement.querySelector('.byline').getAttribute('title')
                var duration = el.querySelector('.duration').getAttribute('title')
                
                if(el.hasAttribute('selected')) {
                    queue.currentIndex = key;
                }
                text = { cover: songCover, title: songTitle, author: songAuthor, duration: duration }
                queue.list.push(text)
            } )

            queue.automix = document.querySelector('#automix').getAttribute('aria-pressed') == 'true'
            queue
            `
        )
        .then((queue) => {
            if (queue) {
                _queue = queue
                debug(`Player Queue: ${_queue}`)
            }
        })
        .catch((_) => console.log('error getQueue'))
}

async function setQueueItem(webContents, index) {
    await webContents.executeJavaScript(
        `var element = document.querySelector('ytmusic-player-queue #contents').children[${index}].querySelector('.song-info').parentElement.querySelector('.left-items .thumbnail-overlay #play-button').click()`
    )
}

function addToLibrary(webContents) {
    webContents
        .executeJavaScript(
            `
            var popup = document.querySelector('.ytmusic-menu-popup-renderer');
            if (popup == null) {
                var middleControlsButtons = document.querySelector('.middle-controls-buttons');
                var dots = middleControlsButtons.querySelector('.dropdown-trigger')

                dots.click()
                dots.click()
            }

            setTimeout( ()=> {
                var addLibrary = Array.from(popup.children).filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z" || value.querySelector('g path:not([fill])').getAttribute('d') == "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z" )[0]
                addLibrary.click()
            }, 100)
            `
        )
        .then(() => setTimeout(isInLibrary, 500))
        .catch((_) => console.log('error addToLibrary ' + _))
}

function getPlaylist(webContents) {
    webContents
        .executeJavaScript(
            `
            var data = { list: [] };

            new Promise( (resolve, reject) => {
                var middleControlsButtons = document.querySelector('.middle-controls-buttons');
                var dots = middleControlsButtons.querySelector('.dropdown-trigger')
            
                dots.click()
                dots.click()
                
                setTimeout( resolve, 500)
            } )
            .then((_) => { 
                return new Promise( (resolve, reject) => {
                    var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                    var addPlaylist = Array.from(popup.children)
                        .filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" )[0].querySelector('a')
                    addPlaylist.click()
                    addPlaylist.click()
            
                    setTimeout( resolve, 3000);
                } ).then( (_) => {
                    var popupPlaylist = document.querySelector('ytmusic-add-to-playlist-renderer');
                    var playlists = popupPlaylist.querySelector('#playlists')
        
                    var titleList = playlists.querySelectorAll('#title')
        
                    titleList.forEach( (element, index) => {
                        data.list.push(element.textContent)
                    } )
                    return data;
                })
            })
            `
        )
        .then((playlist) => {
            _playlist = playlist
            debug(`getPlaylist: ${playlist}`)
        })
        .catch((_) => console.log('error getPlaylist ' + _))
}

function isVideo(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('#player').hasAttribute('video-mode_')`
        )
        .then((isVideo) => {
            track.isVideo = !!isVideo
            debug(`Is video: ${track.isVideo}`)
        })
        .catch((_) => console.log('error isVideo ' + _))
}

function isAdvertisement(webContents) {
    webContents
        .executeJavaScript(
            `document.querySelector('.advertisement').hasAttribute('hidden')`
        )
        .then((isAdvertisement) => {
            track.isAdvertisement = !isAdvertisement
            debug(`Is advertisement: ${track.isAdvertisement}`)
        })
        .catch((_) => console.log('error isAdvertisement'))
}

function setVolume(webContents, time) {
    webContents
        .executeJavaScript(
            `
        var slider = document.querySelector('#volume-slider');
        slider.value = ${time};
        document.querySelector('.video-stream').volume = ${time / 100}
        `
        )
        .then()
        .catch((_) => console.log('error changeVolume'))
}

function setSeekbar(webContents, time) {
    webContents
        .executeJavaScript(
            `
        var slider = document.querySelectorAll('.bar-container .tp-yt-paper-slider')[2];
        var sliderKnob = document.querySelectorAll('#progress-bar')[0];

        slider.click();

        sliderKnob.value = ${time};
        `
        )
        .then()
        .catch((_) => console.log('error changeSeekbar'))
}

function updateLyrics(provider, lyrics, hasLoaded) {
    _lyrics.provider = provider
    _lyrics.data = lyrics
    _lyrics.hasLoaded = hasLoaded
}

function isInLibrary() {
    webContents
        .executeJavaScript(
            `
            new Promise( (resolve, reject) => {
                var middleControlsButtons = document.querySelector('.middle-controls-buttons');
                var dots = middleControlsButtons.querySelector('.dropdown-trigger')
            
                dots.click()
                dots.click()
                
                setTimeout( resolve, 500)
            } )
            .then((_) => {
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addLibrary = Array.from(popup.children)
                    .filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z" || value.querySelector('g path:not([fill])').getAttribute('d') == "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z" )[0]
                
                if(addLibrary != undefined) {
                    var _d = addLibrary.querySelector('g path:not([fill])').getAttribute('d')

                    if(_d == 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7.53 12L9 10.5l1.4-1.41 2.07 2.08L17.6 6 19 7.41 12.47 14zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z') {
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    return false;
                }
            })
            `
        )
        .then((inLibrary) => {
            track.inLibrary = inLibrary
            debug(`Is in Library: ${track.inLibrary}`)
        })
        .catch((_) => console.log('error isInLibrary'))
}

function addToPlaylist(webContents, index) {
    webContents
        .executeJavaScript(
            `
            new Promise( (resolve, reject) => {
                var popup = document.querySelector('.ytmusic-menu-popup-renderer');
                var addPlaylist = Array.from(popup.children)
                    .filter( (value) => value.querySelector('g path:not([fill])').getAttribute('d') == "M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" )[0].querySelector('a')
                addPlaylist.click()
                addPlaylist.click()
        
                setTimeout( resolve, 500);
            } ).then( (_) => {
                var popupPlaylist = document.querySelector('ytmusic-add-to-playlist-renderer');
                var playlists = popupPlaylist.querySelectorAll('#playlists ytmusic-playlist-add-to-option-renderer button');
        
                playlists[${index}].click()
            })
            `
        )
        .then()
        .catch((_) => console.log('error getPlaylist ' + _))
}

function convertToHuman(time) {
    let hours = Math.floor(time / 3600)
    time %= 3600
    let minutes = Math.floor(time / 60)
    let seconds = Math.floor(time % 60)

    let final =
        hours.toString().padStart(2, '0') +
        ':' +
        minutes.toString().padStart(2, '0') +
        ':' +
        seconds.toString().padStart(2, '0')

    final.startsWith('00:0')
        ? (final = final.slice(4))
        : final.startsWith('00:')
        ? (final = final.slice(3))
        : final.startsWith('0')
        ? (final = final.slice(1))
        : null

    return final
}

function setPercent(px, ptotal) {
    player.statePercent = px / ptotal
}

function hasInitialized() {
    return initialized
}

function firstPlay(webContents) {
    webContents
        .executeJavaScript(
            `
            var playButton = document.querySelector('.icon.ytmusic-play-button-renderer');
            playButton.click();
            `
        )
        .then()
        .catch((_) => console.log('error firstPlay'))
}

async function toggleMoreActions(webContents) {
    await webContents.executeJavaScript(
        `
            var middleControlsButtons = document.querySelector('.middle-controls-buttons');
            var moreActions = middleControlsButtons.querySelector('.dropdown-trigger')
            
            moreActions.click()
            `,
        true
    )
}

function debug(data) {
    // console.log(data);
}

module.exports = {
    init: init,
    getAllInfo: getAllInfo,
    getPlayerInfo: getPlayerInfo,
    getTrackInfo: getTrackInfo,
    hasInitialized: hasInitialized,
    firstPlay: firstPlay,
    isInLibrary: isInLibrary,

    getQueueInfo: getQueueInfo,
    getPlaylistInfo: getPlaylistInfo,
    getLyricsInfo: getLyricsInfo,

    setVolume: setVolume,
    setSeekbar: setSeekbar,
    setQueueItem: setQueueItem,

    updatePlaylistInfo: updatePlaylistInfo,
    updateQueueInfo: updateQueueInfo,
    updateLyrics: updateLyrics,

    addToLibrary: addToLibrary,
    addToPlaylist: addToPlaylist,
}
