const i18n = require( 'i18n' );
const electronStore = require('electron-store');
const store = new electronStore();

const defaultLocale = store.get( 'settings-app-language', 'en' );

i18n.configure( {
    locales: [ 'en', 'pt' ],
    directory: __dirname + '/../locales',
    defaultLocale: defaultLocale
} );

exports.setLocale = function( locale ) {
    i18n.setLocale( locale );
}

exports.trans = function( id ) {
    try{
        let tmp = i18n.__( id )
        if (tmp === id){
            return i18n.__({phrase: id, locale: 'en'}); // fallback to english
        }else{
            return tmp;
        }
    }catch(_){
        return i18n.__({phrase: id, locale: 'en'}); // fallback to english
    }
}