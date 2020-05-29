const { ipcRenderer } = require('electron')
const request = require('request')
const __ = require('../../providers/translateProvider')
const settingsProvider = require('../../providers/settingsProvider')

const lyricProviders = [
    {
        name: 'lyrics.ovh',
        url: 'https://api.lyrics.ovh/v1/:artist/:music',
        response: 'body.lyrics',
    },
    {
        name: 'vagalume',
        url: 'https://api.vagalume.com.br/search.php?art=:artist&mus=:music',
        response: 'body.mus[0].text',
    },
]

const elementLyric = document.getElementById('lyric')

let lastId, target, toggled

loadi18n()

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
            let providerSelected = settingsProvider.get(
                'settings-lyrics-provider'
            )
            providerSelected = parseInt(providerSelected) - 1

            retrieveOVHData(artist, song)
                .then(
                    success => {
                        console.log(success)
                    },
                    error => {
                        console.log(error)
                    }
                )
                .catch(rejected => console.log(rejected))

            request(
                urlReplace(
                    lyricProviders[providerSelected].url,
                    removeAccents(artist),
                    removeAccents(song)
                ),
                { json: true },
                function(err, res, body) {
                    if (err) {
                        console.log('LYRICS ERRO')
                        elementLyric.innerText = __.trans(
                            'LABEL_LYRICS_NOT_FOUND'
                        )
                        return
                    }

                    if (body) {
                        try {
                            eval(lyricProviders[providerSelected].response)
                            elementLyric.innerText = eval(
                                lyricProviders[providerSelected].response
                            )
                        } catch (e) {
                            elementLyric.innerText = __.trans(
                                'LABEL_LYRICS_NOT_FOUND'
                            )
                        }
                    } else {
                        elementLyric.innerText = __.trans(
                            'LABEL_LYRICS_NOT_FOUND'
                        )
                    }

                    document.getElementById('content').scrollTop = 0
                }
            )
        }
    } else {
        elementLyric.innerText = __.trans('LABEL_PLAY_MUSIC')
    }
}

function loadi18n() {
    document.getElementById('i18n_LABEL_LOADING').innerText = __.trans(
        'LABEL_LOADING'
    )
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
                // document.getElementById('content').scrollTop = 0
            }
        )
    })
}

function retrieveVagalumeData(artist, track) {}
