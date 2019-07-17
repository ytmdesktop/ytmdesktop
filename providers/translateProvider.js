const i18n = require('i18n');
const electronStore = require('electron-store');
const store = new electronStore();

const defaultLocale = store.get('settings-app-language', 'en');

i18n.configure({
    locales: ['en', 'pt'],
    directory: __dirname + '/../locales',
    defaultLocale: defaultLocale
});

function setLocale(locale) {
    i18n.setLocale(locale);
}

function trans(id, params) {
    params = (typeof params !== 'undefined') ? params : {};
    try {
        let tmp = i18n.__(id, params)
        if (tmp === id) {
            return i18n.__({ phrase: id, locale: 'en' }, params); // fallback to english
        } else {
            return tmp;
        }
    } catch (_) {
        return i18n.__({ phrase: id, locale: 'en' }, params); // fallback to english
    }
}

exports.setLocale = setLocale;
exports.trans = trans;