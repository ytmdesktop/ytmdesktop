const { ipcMain } = require('electron')
const i18n = require('i18n')
var http = require('https')
var fs = require('fs')
const settingsProvider = require('./settingsProvider')
const isRenderer = require('is-electron-renderer')

const defaultLocale = settingsProvider.get('settings-app-language') || 'en'

// Use app.getPath('userData') will cause problem here and I could not figure out why
// So I add a stored value `settings-localses-path` as a workaround.
//                                                      - mingjun97
const localesPath = settingsProvider.get('settings-locales-path') + '/locales'

console.log(
    '[!] To add translation for your introduced feature, you may navigate to '
)
console.log('[!] ' + localesPath + ' to modify the your locale file.')
console.log('[!] Then kindly open a PR to ytmdesktop-locales repo. :)')

function isDev() {
    return require('electron-is-dev')
}

var updateLocaleFile = function (locale, cb, force = false) {
    // for developer, skip auto update to prevent data loss
    if (!isRenderer && isDev() && !force) {
        console.log('[!]Skip i18n auto-update in development mode')
        // updateLocaleFile(locale, cb, true)
        console.log(
            '[!]You may force update i18n by uncomment previous line in `src/providers/translateProvider`'
        )
        return
    }
    // console.log('downloading locale file for:' + locale);
    dest = `${localesPath}/${locale}.json`
    var file = fs.createWriteStream(dest)
    var request = http
        .get(
            `https://raw.githubusercontent.com/ytmdesktop/ytmdesktop-locales/master/locales/${locale}.json`,
            function (response) {
                let body = ''
                response.on('data', function (chunk) {
                    body += chunk
                })
                response.on('end', function () {
                    file.write(body)
                    file.close()
                })
            }
        )
        .on('error', function (err) {
            // Handle errors
            fs.unlink(dest) // Delete the file async. (But we don't check the result)
            if (cb) cb(err.message)
        })
}

i18n.configure({
    locales: ['en', 'pt'],
    directory: localesPath,
    defaultLocale: defaultLocale,
    autoReload: true,
})

// update locale file when launch
// put a slight delay in case of data racing
setTimeout(function () {
    updateLocaleFile(defaultLocale, (a) => {
        console.log('cb called', a)
    })
}, 1000)

function setLocale(locale) {
    i18n.setLocale(locale)
}

function trans(id, params) {
    params = typeof params !== 'undefined' ? params : {}
    try {
        let tmp = i18n.__(id, params)
        return tmp === id
            ? i18n.__({ phrase: id, locale: 'en' }, params) // fallback to english
            : tmp
    } catch (_) {
        return i18n.__({ phrase: id, locale: 'en' }, params) // fallback to english
    }
}

function translateHelper() {
    const prefix = 'i18n_'
    const items = []
    const i18n_items = document.getElementsByTagName('*')
    for (let i = 0; i < i18n_items.length; i++)
        //omitting undefined null check for brevity
        if (
            i18n_items[i].getAttribute('i18n') &&
            i18n_items[i].getAttribute('i18n').lastIndexOf(prefix, 0) === 0
        )
            items.push([
                i18n_items[i].getAttribute('i18n').replace('i18n_', ''),
                i18n_items[i],
            ])
    return items
}

function loadi18n() {
    translateHelper().forEach(([i18n, element]) => {
        element.innerHTML = trans(i18n)
    })
}

if (ipcMain) {
    ipcMain.on('I18N_TRANSLATE', (e, id, params) => {
        e.returnValue = trans(id, params)
    })
    // download locale file for new language
    ipcMain.on('language-updated', (e, id, params) => {
        updateLocaleFile(settingsProvider.get('settings-app-language'))
    })
}

module.exports = {
    setLocale: setLocale,
    trans: trans,
    loadi18n: loadi18n,
}
