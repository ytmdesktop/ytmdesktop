const { app } = require('electron')
const Analytics = require('electron-google-analytics')
const analytics = new Analytics.default('UA-127400126-1')
const { v4: uuid } = require('uuid')
const settingsProvider = require('./settingsProvider')
let userId = settingsProvider.get('uuid')

if (userId == undefined) {
    userId = uuid()
    settingsProvider.set('uuid', userId)
}

function setAnalyticsEvent(from, action, label, value) {
    analytics
        .event(action, from, {
            evLabel: label,
            evValue: value,
            clientID: userId,
        })
        .then()
        .catch((err) => {
            console.log('error setAnalyticsEvent')
        })
}

function setAnalyticsScreen(from) {
    analytics
        .screen(
            'YouTube Music Desktop App',
            app.getVersion(),
            'app.ytmd',
            'app.ytmd',
            from,
            userId
        )
        .then()
        .catch((err) => {
            console.log('error setAnalyticsScreen')
        })
}

module.exports = {
    setEvent: setAnalyticsEvent,
    setScreen: setAnalyticsScreen,
}
