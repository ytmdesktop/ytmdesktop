const { remote, shell } = require('electron')
const scribble = require('scribble')
const settingsProvider = require('./settingsProvider')
const http = require('http')
const Base64 = require('js-base64').Base64

const apiKey = '9ab417e8b808ed071223a1b4b3c29642'
const apiSecret = '9d8830c167627e65dac63786be101964'

var Scrobbler

var userLogin

function signIn() {
    userLogin = getLogin()
    if (userLogin) {
        Scrobbler = new scribble(
            apiKey,
            apiSecret,
            userLogin.username,
            userLogin.password
        )
    }
}

function setLogin(username, password) {
    settingsProvider.set('last-fm-login', {
        username: username,
        password: Base64.encode(password),
    })
}

function getLogin() {
    var login = settingsProvider.get('last-fm-login')
    if (login.username != '') {
        login.password = Base64.decode(login.password)
        return login
    }

    return false
}

function getToken() {
    http.get(
        `http://ws.audioscrobbler.com/2.0/?method=auth.gettoken&api_key=${apiKey}&format=json`,
        function (res) {
            let rawData = ''
            res.on('data', (chunk) => {
                rawData += chunk
            })
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData)
                    authorize(parsedData.token)
                } catch (e) {
                    console.error(e.message)
                }
            })
        }
    )
}

function updateTrackInfo(title, author, album) {
    if (Scrobbler === undefined) {
        signIn()
    }

    var track = {
        artist: author,
        track: title,
        album: album,
    }

    Scrobbler.Scrobble(track, function (_) {})
}

function updateNowPlaying(title, author, album, duration) {
    if (Scrobbler === undefined) {
        signIn()
    }

    var track = {
        artist: author,
        track: title,
        album: album,
        duration: duration,
    }
    Scrobbler.NowPlaying(track, function (_) {})
}

function authorize(token) {
    let winAuthorize = new remote.BrowserWindow({
        title: 'Last.FM Authorization',
        width: 900,
        height: 500,
    })
    winAuthorize.loadURL(
        `https://www.last.fm/api/auth?api_key=${apiKey}&token=${token}`
    )
}

module.exports = {
    getToken: getToken,
    updateTrackInfo: updateTrackInfo,
    updateNowPlaying: updateNowPlaying,
    getLogin: getLogin,
    setLogin: setLogin,
    authorize: authorize,
}
