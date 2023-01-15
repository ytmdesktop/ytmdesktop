const { ipcRenderer } = require('electron')
const fetch = require('node-fetch')
const __ = require('../../providers/translateProvider')
const infoPlayerProvider = require('../../providers/infoPlayerProvider')

const settingsProvider = require('../../providers/settingsProvider')

const elementLyric = document.getElementById('lyric')
const elementLyricSource = document.getElementById('lyric-source')

let lastId, target, toggled, geniusAuth

loadingLyrics()

document.getElementById('content').addEventListener('dblclick', (_) => {
    document.getElementById('content').scrollTo(0, target)
})

document.getElementById('content').addEventListener('scroll', (_) => {
    const scrollTop = document.getElementById('content').scrollTop
    const differential =
        target > scrollTop ? target - scrollTop : scrollTop - target
    if (differential >= 40) {
        document.getElementById('tips').innerText = __.trans(
            'DOUBLE_CLICK_TO_RESET_POSITION'
        )
        toggled = false
    } else {
        document.getElementById('tips').innerText = ''
        toggled = true
    }
})

setInterval(async () => {
    await setData(await retrieveAllInfo())
}, 1000)

async function setData(data) {
    const scrollHeight = document.getElementById('content').scrollHeight
    target = (scrollHeight * data.player.statePercent) / 1.4
    if (toggled) document.getElementById('content').scrollTo(0, target)

    getLyric(data.track.author, data.track.title, data.track.id)
}

async function retrieveAllInfo() {
    return new Promise((resolve, reject) => {
        ipcRenderer
            .invoke('invoke-all-info')
            .then((result) => resolve(result))
            .catch((_) => reject(false))
    })
}

function getLyric(artist, song, id) {
    if (artist !== undefined && song !== undefined) {
        if (lastId !== id) {
            lastId = id
            toggled = true
            loadingLyrics()

            // Genius will be skipped if not enabled.
            retrieveGeniusData(artist, song)
                .then((success) => setLyrics('Genius', success, true))
                .catch((_) =>
                    retrieveVagalumeData(artist, song)
                        .then((success_) =>
                            setLyrics('Vagalume', success_, true)
                        )
                        .catch((_) =>
                            retrieveKsoftData(artist, song)
                                .then((success) =>
                                    setLyrics('KSoft', success, true)
                                )
                                .catch((_) =>
                                    retrieveOVHData(artist, song)
                                        .then((success) =>
                                            setLyrics('OVH', success, true)
                                        )
                                        .catch((error) => {
                                            elementLyric.innerText = error
                                            setLyrics('-', error, true)
                                        })
                                )
                        )
                )
        }
    } else elementLyric.innerText = __.trans('LABEL_PLAY_MUSIC')
}

function setLyrics(source, lyrics, hasLoaded) {
    if (source === 'Genius') {
        // Lyrics in Genius is an object check here; https://docs.genius.com/#search-h2 "response: { hits: { result: { ..."
        elementLyric.innerText = lyrics.full_title
        const lyricsElementId = `rg_embed_link_${lyrics.id}`

        const node = document.createElement('div')
        node.id = 'overlay'
        document.getElementById('content').appendChild(node)

        const postscribe = require('postscribe')
        postscribe(
            '#lyric',
            `<div id='${lyricsElementId}' class='rg_embed_link' data-song-id='${lyrics.id}'>Read <a href='https://genius.com${lyrics.path}'>${lyrics.full_title}</a> on Genius</div> <script crossorigin="anonymous" src='https://genius.com/songs/${lyrics.id}/embed.js'></script>`,
            {
                done: () =>
                    (document.getElementsByClassName(
                        'rg_embed music'
                    )[0].style.color = 'black'),
            }
        )
    } else {
        elementLyric.innerText = lyrics
        infoPlayerProvider.updateLyrics(source, lyrics, hasLoaded)
    }
    elementLyricSource.innerText = `Lyrics provided by ${source}`
    document.getElementById('content').scrollTop = 0
}

function loadingLyrics() {
    elementLyricSource.innerText = ''
    elementLyric.innerText = __.trans('LABEL_LOADING')
    infoPlayerProvider.updateLyrics('', __.trans('LABEL_LOADING'), false)
}

function removeAccents(strAccents) {
    // TODO: Remove old code
    /*strAccents = strAccents.split('');
    let strAccentsOut = [];
    let strAccentsLen = strAccents.length;

    const accents =
        'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž?&=';
    const accentsOut = [
        'A',
        'A',
        'A',
        'A',
        'A',
        'A',
        'a',
        'a',
        'a',
        'a',
        'a',
        'a',
        'O',
        'O',
        'O',
        'O',
        'O',
        'O',
        'O',
        'o',
        'o',
        'o',
        'o',
        'o',
        'o',
        'E',
        'E',
        'E',
        'E',
        'e',
        'e',
        'e',
        'e',
        'e',
        'C',
        'c',
        'D',
        'I',
        'I',
        'I',
        'I',
        'i',
        'i',
        'i',
        'i',
        'U',
        'U',
        'U',
        'U',
        'u',
        'u',
        'u',
        'u',
        'N',
        'n',
        'S',
        's',
        'Y',
        'y',
        'y',
        'Z',
        'z',
        '%3F',
        '%26',
        '%3D',
    ];

    for (let y = 0; y < strAccentsLen; y++)
        if (accents.indexOf(strAccents[y]) !== -1)
            strAccentsOut[y] = accentsOut[accents.indexOf(strAccents[y])];
        else strAccentsOut[y] = strAccents[y];

    strAccentsOut = strAccentsOut.join('');

    return strAccentsOut;*/
    return strAccents.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function retrieveKsoftData(artist, track) {
    return new Promise((resolve, reject) => {
        fetch(
            `https://ytmd-lyrics.herokuapp.com/?q=${removeAccents(
                artist
            )} - ${removeAccents(track)}`,
            { timeout: 3000 }
        )
            .then((res) => res.json())
            .then((json) => {
                if (!json.error) resolve(json.result.lyrics)
                else reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
            })
            .catch((_) => reject(__.trans('LABEL_LYRICS_NOT_FOUND')))
    })
}

function retrieveOVHData(artist, track) {
    return new Promise((resolve, reject) => {
        fetch(
            `https://api.lyrics.ovh/v1/${removeAccents(artist)}/${removeAccents(
                track
            )}`,
            { timeout: 3000 }
        )
            .then((res) => res.json())
            .then((json) => {
                if (json.lyrics) resolve(json.lyrics)
                else reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
            })
            .catch((_) => reject(__.trans('LABEL_LYRICS_NOT_FOUND')))
    })
}

function retrieveVagalumeData(artist, track) {
    return new Promise((resolve, reject) => {
        fetch(
            `https://api.vagalume.com.br/search.php?art=${removeAccents(
                artist
            )}&mus=${removeAccents(track)}`,
            { timeout: 3000 }
        )
            .then((res) => res.json())
            .then((json) => {
                if (json.mus) resolve(json.mus[0].text)
                else reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
            })
            .catch((_) => reject(__.trans('LABEL_LYRICS_NOT_FOUND')))
    })
}

function retrieveGeniusData(artist, track) {
    geniusAuth = settingsProvider.get('genius-auth')

    return new Promise(async (resolve, reject) => {
        //first it will check if Genius is enabled and is authorized.
        if (!settingsProvider.get('settings-genius-auth-server')) {
            reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
        } else if (!(geniusAuth.access_token || geniusAuth.token_type)) {
            reject(__.trans('LABEL_LYRICS_GENIUS_AUTH'))
        } else {
            // Documentation: https://docs.genius.com/#search-h2
            await fetch(
                `https://api.genius.com/search?q=${removeAccents(
                    track
                )} - ${removeAccents(artist)}`,
                {
                    timeout: 3000,
                    headers: {
                        Authorization: `${geniusAuth.token_type} ${geniusAuth.access_token}`,
                    },
                }
            )
                .then((res) => res.json())
                .then((json) => {
                    // Just get the first result, should be good for now?
                    if (json && json.response.hits[0]) {
                        resolve(json.response.hits[0].result)
                    } else reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                })
                .catch((_) => reject(__.trans('LABEL_LYRICS_NOT_FOUND')))
        }
    })
}
