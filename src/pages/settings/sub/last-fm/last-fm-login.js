const __ = require('../../../../providers/translateProvider')
const scrobbleProvider = require('../../../../providers/scrobblerProvider')
const {
    handleWindowButtonsInit,
    updateWindowTitle,
} = require('../../../../utils/window')

__.loadi18n()

handleWindowButtonsInit()
updateWindowTitle()

var login = scrobbleProvider.getLogin()

if (login) {
    document.getElementById('username').value = login.username
    document.getElementById('password').value = login.password
}

document.getElementById('btn-save').addEventListener('click', function () {
    var username = document.getElementById('username').value
    var password = document.getElementById('password').value
    scrobbleProvider.setLogin(username, password)

    scrobbleProvider.getToken()
})
