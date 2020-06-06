const { ipcRenderer } = require('electron')
const request = require('request')
const __ = require('../../providers/translateProvider')

const elementLyric = document.getElementById('lyric')

let lastId, target, toggled

loadingLyrics()

document.getElementById('content').addEventListener('dblclick', function(e) {
    this.scrollTo(0, target)
})

document.getElementById('content').addEventListener('scroll', function(e) {
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

setInterval(function() {
    ipcRenderer.send('retrieve-player-info')
}, 3 * 1000)

ipcRenderer.on('song-playing-now-is', function(e, data) {
    var scrollHeight = document.getElementById('content').scrollHeight
    target = (scrollHeight * data.track.statePercent) / 1.4
    if (toggled) {
        document.getElementById('content').scrollTo(0, target)
    }

    getLyric(data.track.author, data.track.title, data.track.id)
})

function getLyric(artist, song, id) {
    if (artist != undefined && song != undefined) {
        if (lastId !== id) {
            lastId = id
            toggled = true
            loadingLyrics()

            retrieveOVHData(artist, song)
                .then(success => {
                    elementLyric.innerText = success
                    document.getElementById('content').scrollTop = 0
                })
                .catch(_ => {
                    retrieveVagalumeData(artist, song)
                        .then(
                            success_ => {
                                console.log('sucesso vagalume')
                                elementLyric.innerText = success_
                                document.getElementById('content').scrollTop = 0
                            },
                            error_ => {
                                elementLyric.innerText = error_
                            }
                        )
                        .catch(rejected => console.log(rejected))
                })
        }
    } else {
        elementLyric.innerText = __.trans('LABEL_PLAY_MUSIC')
    }
}

function loadingLyrics() {
    elementLyric.innerText = __.trans('LABEL_LOADING')
}

function removeAccents(strAccents) {
    strAccents = strAccents.split('')
    strAccentsOut = new Array()
    strAccentsLen = strAccents.length

    var accents =
        'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž'
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
    ]

    for (var y = 0; y < strAccentsLen; y++) {
        if (accents.indexOf(strAccents[y]) != -1) {
            strAccentsOut[y] = accentsOut[accents.indexOf(strAccents[y])]
        } else strAccentsOut[y] = strAccents[y]
    }

    strAccentsOut = strAccentsOut.join('')

    return strAccentsOut
}

function urlReplace(url, artist, music) {
    let urlReturn = url

    if (url.indexOf(':artist') !== -1) {
        urlReturn = urlReturn.replace(':artist', artist)
    }

    if (url.indexOf(':music') !== -1) {
        urlReturn = urlReturn.replace(':music', music)
    }

    return urlReturn
}

function retrieveOVHData(artist, track) {
    return new Promise((resolve, reject) => {
        request(
            `https://api.lyrics.ovh/v1/${removeAccents(artist)}/${removeAccents(
                track
            )}`,
            { json: true },
            function(err, res, body) {
                if (err) {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
                if (body && body.lyrics) {
                    resolve(body.lyrics)
                } else {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
            }
        )
    })
}

function retrieveVagalumeData(artist, track) {
    return new Promise((resolve, reject) => {
        request(
            `https://api.vagalume.com.br/search.php?art=${removeAccents(
                artist
            )}&mus=${removeAccents(track)}`,
            { json: true },
            function(err, res, body) {
                if (err) {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
                if (body && body.mus) {
                    resolve(body.mus[0].text)
                } else {
                    reject(__.trans('LABEL_LYRICS_NOT_FOUND'))
                }
            }
        )
    })
}
