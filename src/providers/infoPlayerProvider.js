var webContents, initialized

var player = {
    hasSong: false,
    isPaused: true,
    volumePercent: 0,
    seekbarCurrentPosition: 0,
    seekbarCurrentPositionHuman: '0:00',
    statePercent: 0.0,
    likeStatus: 'INDIFFERENT',
    repeatType: 'NONE',
}

var track = {
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

var _queue = {
    automix: false,
    currentIndex: 0,
    list: [],
}

var _playlist = {
    list: [],
}

var _lyrics = {
    provider: '',
    data: '',
    hasLoaded: false,
}

function init(view) {
    webContents = view.webContents
    initialized = true
    toggleMoreActions(webContents)
    toggleMoreActions(webContents)
}

function getAllInfo() {
    return {
        player: getPlayerInfo(),
        track: getTrackInfo(),
    }
}

function getPlayerInfo() {
    if (webContents !== undefined) {
        hasSong()
        isPaused(webContents)
        getVolume(webContents)
        getSeekbarPosition(webContents)
        getLikeStatus(webContents)
        getRepeatType(webContents)
    }
    return player
}

function getTrackInfo() {
    if (webContents !== undefined) {
        getAuthor(webContents)
        getTitle(webContents)
        getAlbum(webContents)
        getCover(webContents)
        getDuration(webContents)
        getUrl(webContents)
        setPercent(player.seekbarCurrentPosition, track.duration)
        isVideo(webContents)
        isAdvertisement(webContents)
    }
    return track
}

function getQueueInfo() {
    return _queue
}

function updateQueueInfo() {
    if (webContents !== undefined) {
        getQueue(webContents)
    }
}

function getPlaylistInfo() {
    return _playlist
}

function updatePlaylistInfo() {
    if (webContents !== undefined) {
        getPlaylist(webContents)
    }
}

function getLyricsInfo() {
    return _lyrics
}

function hasSong() {
    player.hasSong = track.id != ''
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
            debug(`Volume % is: ${parseInt(volume)}`)
            player.volumePercent = parseInt(volume)
        })
        .catch((_) => console.log('error getVolume'))
}

function getAuthor(webContents) {
    webContents
        .executeJavaScript(
            `
            var bar = document.getElementsByClassName('subtitle ytmusic-player-bar')[0];
                        
            if (bar.getElementsByClassName('yt-simple-endpoint yt-formatted-string')[0]) {
            title = bar.getElementsByClassName('yt-simple-endpoint yt-formatted-string')[0].textContent;
            } else if (bar.getElementsByClassName('byline ytmusic-player-bar')[0]) {
            title = bar.getElementsByClassName('byline ytmusic-player-bar')[0].textContent;
            }
            title;
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
            var player_bar = document.getElementsByClassName("byline ytmusic-player-bar")[0].children;
            var arr_player_bar = Array.from(player_bar);
            
            arr_player_bar.forEach( function(data, index) {
            
            if (data.getAttribute('href') != null && data.getAttribute('href').includes('browse')) {
                album = data.innerText;
            }
            } )
            
            album
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

                var newUrl = new URL(url)
                var searchParams = new URLSearchParams(newUrl.search)

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

function setQueueItem(webContents, index) {
    webContents.executeJavaScript(
        `
        var element = document.querySelector('ytmusic-player-queue #contents').children[${index}].querySelector('.song-info').parentElement.querySelector('.left-items .thumbnail-overlay #play-button').click()
        `
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
    var _aux = time
    var _minutes = 0
    var _seconds = 0

    while (_aux >= 60) {
        _aux = _aux - 60
        _minutes++
    }

    _seconds = _aux

    if (_seconds < 10) {
        return _minutes + ':0' + _seconds
    }
    return _minutes + ':' + _seconds
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

function toggleMoreActions(webContents) {
    webContents.executeJavaScript(
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
