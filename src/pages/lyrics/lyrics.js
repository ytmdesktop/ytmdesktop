const { ipcRenderer } = require('electron')
const fetch = require('node-fetch')
const __ = require('../../providers/translateProvider')
const infoPlayerProvider = require('electron').remote.require(
    './src/providers/infoPlayerProvider'
)

const elementLyric = document.getElementById('lyric')
const elementLyricSource = document.getElementById('lyric-source')

let lastId, target, toggled

loadingLyrics()

document.getElementById('content').addEventListener('dblclick', function (e) {
    this.scrollTo(0, target)
})

document.getElementById('content').addEventListener('scroll', function (e) {
    var scrollTop = document.getElementById('content').scrollTop
    var differential =
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
    setData(await retrieveAllInfo())
}, 1 * 1000)

async function setData(data) {
    var scrollHeight = document.getElementById('content').scrollHeight
    target = (scrollHeight * data.player.statePercent) / 1.4
    if (toggled) {
        document.getElementById('content').scrollTo(0, target)
    }

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
    if (artist != undefined && song != undefined) {
        if (lastId !== id) {
            lastId = id
            toggled = true
            loadingLyrics()

            retrieveOVHData(artist, song)
                .then((success) => {
                    setLyrics('OVH', success, true)
                })
                .catch((_) => {
                    retrieveVagalumeData(artist, song)
                        .then((success_) => {
                            setLyrics('Vagalume', success_, true)
                        })
                        .catch((_) => {
                            retrieveKsoftData(artist, song)
                                .then((success) => {
                                    setLyrics('KSoft', success, true)
                                })
                                .catch((error) => {
                                    elementLyric.innerText = error
                                    setLyrics('-', error, true)
                                })
                        })
                })
        }
    } else {
        elementLyric.innerText = __.trans('LABEL_PLAY_MUSIC')
    }
}

function setLyrics(source, lyrics, hasLoaded) {
    elementLyricSource.innerText = `Lyrics provided by ${source}`
    elementLyric.innerText = lyrics
    document.getElementById('content').scrollTop = 0
    infoPlayerProvider.updateLyrics(source, lyrics, hasLoaded)
}

function loadingLyrics() {
    elementLyricSource.innerText = ''
    elementLyric.innerText = __.trans('LABEL_LOADING')
    infoPlayerProvider.updateLyrics('', __.trans('LABEL_LOADING'), false)
}

function removeAccents(strAccents) {
    strAccents = strAccents.split('')
    strAccentsOut = new Array()
    strAccentsLen = strAccents.length

    var accents =
        'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž?&='
    var accentsOut = [
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
    ]

    for (var y = 0; y < strAccentsLen; y++) {
        if (accents.indexOf(strAccents[y]) != -1) {
            strAccentsOut[y] = accentsOut[accents.indexOf(strAccents[y])]
        } else strAccentsOut[y] = strAccents[y]
    }

    strAccentsOut = strAccentsOut.join('')

    return strAccentsOut
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
                if (!json.error) {
                    resolve(json.result.lyrics)
                } else {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
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
                if (json.lyrics) {
                    resolve(json.lyrics)
                } else {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
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
                if (json.mus) {
                    resolve(json.mus[0].text)
                } else {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
            })
            .catch((_) => reject(__.trans('LABEL_LYRICS_NOT_FOUND')))
    })
}
