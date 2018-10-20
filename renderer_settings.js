const { remote, ipcRenderer: ipc } = require( 'electron' );
const electronStore = require( 'electron-store' );
const store = new electronStore();
const __ = require( './translateProvider' );

loadSettings();
loadi18n();

// remote.getCurrentWebContents().openDevTools();

document.addEventListener( 'DOMContentLoaded', function() {
    M.FormSelect.init( document.querySelectorAll( 'select' ), {} );
    M.Tabs.init( document.getElementsByClassName( 'tabs' )[0] , {} );
} );

document.getElementById( 'btn-close' ).addEventListener( 'click', function() {
    window.close();
} );

const elementKeepBackground = document.getElementById( 'toggle-keep-background' );
const elementToggleShowNotification = document.getElementById( 'toggle-show-notifications' );
const elementToggleLeftOf = document.getElementById( 'toggle-continue-where-left-of' );
const elementDiscordRichPresence = document.getElementById( 'toggle-discord-rich-presence' );
const elementAppLanguage = document.getElementById( 'select-app-language' );
//const elementBtnAppRelaunch = document.getElementById( 'btn-app-relaunch' );

elementKeepBackground.addEventListener( 'click', function() {
    store.set('settings-keep-background', this.checked )
} );

elementToggleShowNotification.addEventListener( 'click', function() {
    store.set( 'settings-show-notifications', this.checked );
} );

elementToggleLeftOf.addEventListener( 'click', function() {
    store.set( 'settings-continue-where-left-of', this.checked );
} );

elementDiscordRichPresence.addEventListener( 'click', function() {
    store.set( 'settings-discord-rich-presence', this.checked );
} );

elementAppLanguage.addEventListener( 'change', function() {
    store.set( 'settings-app-language', this.value );
    relaunch();
    //elementBtnAppRelaunch.classList.remove( 'hide' );
} );

/*elementBtnAppRelaunch.addEventListener( 'click', function() {
    relaunch();
} )*/

/*const elementCheckUpdate = document.getElementById( 'check-update' );
elementCheckUpdate.addEventListener( 'click', function() {
    elementCheckUpdate.setAttribute( 'disabled', true );
} );*/

const elementRangeZoom = document.getElementById( 'range-zoom' );
elementRangeZoom.addEventListener( 'input', function() {
    document.getElementById('range-zoom-value').innerText = this.value;
    store.set( 'settings-page-zoom', this.value );
    ipc.send( 'settings-changed-zoom', this.value );
} );

function loadSettings() {

    if ( store.get( 'settings-keep-background' ) ) {
        document.getElementById( 'toggle-keep-background' ).checked = true;
    }

    if ( store.get( 'settings-show-notifications' ) ) {
        document.getElementById( 'toggle-show-notifications' ).checked = true;
    }

    if ( store.get( 'settings-continue-where-left-of' ) ) {
        document.getElementById( 'toggle-continue-where-left-of' ).checked = true;
    }

    if ( store.get( 'settings-discord-rich-presence' ) ) {
        document.getElementById( 'toggle-discord-rich-presence' ).checked = true;
    }
    
    if ( store.get( 'settings-app-language' ) ) {
        document.getElementById( 'select-app-language' ).value = store.get( 'settings-app-language' );
    }
    
    if ( store.get( 'settings-page-zoom' ) ) {
        document.getElementById( 'range-zoom' ).value = store.get( 'settings-page-zoom' );
        document.getElementById('range-zoom-value').innerText = store.get( 'settings-page-zoom' );
    }

    document.getElementById( 'app-version' ).innerText = remote.app.getVersion();

}

function loadi18n() {
    document.getElementById( 'i18n_LABEL_SETTINGS' ).innerText                                      = __.trans( 'LABEL_SETTINGS' );

    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL' ).innerText                          = __.trans( 'LABEL_SETTINGS_TAB_GENERAL' );
    //document.getElementById( 'i18n_LABEL_SETTINGS_TAB_MINIPLAYER' ).innerText                       = __.trans( 'LABEL_SETTINGS_TAB_MINIPLAYER' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_SHORTCUTS' ).innerText                        = __.trans( 'LABEL_SETTINGS_TAB_SHORTCUTS' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_ABOUT' ).innerText                            = __.trans( 'LABEL_SETTINGS_TAB_ABOUT' );

    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL_KEEP_BACKGROUND' ).innerText          = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_KEEP_BACKGROUND' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL_SHOW_NOTIFICATIONS' ).innerText       = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_SHOW_NOTIFICATIONS' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL_CONTINUE_WHERE_LEFT_OF' ).innerText   = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_CONTINUE_WHERE_LEFT_OF' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL_DISCORD_RICH_PRESENCE' ).innerText    = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_DISCORD_RICH_PRESENCE' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_PAGE_ZOOM' ).innerText                        = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_PAGE_ZOOM' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_GENERAL_SELECT_LANGUAGE' ).innerText          = __.trans( 'LABEL_SETTINGS_TAB_GENERAL_SELECT_LANGUAGE' );

    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_SHORTCUTS_LOCAL' ).innerText                  = __.trans( 'LABEL_SETTINGS_TAB_SHORTCUTS_LOCAL' );
    document.getElementById( 'i18n_LABEL_SETTINGS_TAB_SHORTCUTS_GLOBAL' ).innerText                 = __.trans( 'LABEL_SETTINGS_TAB_SHORTCUTS_GLOBAL' );

    document.getElementById( 'i18n_MEDIA_CONTROL_PLAY_PAUSE' ).innerText                            = __.trans( 'MEDIA_CONTROL_PLAY_PAUSE' );
    document.getElementById( 'i18n_MEDIA_CONTROL_NEXT' ).innerText                                  = __.trans( 'MEDIA_CONTROL_NEXT' );
    document.getElementById( 'i18n_MEDIA_CONTROL_PREVIOUS' ).innerText                              = __.trans( 'MEDIA_CONTROL_PREVIOUS' );
    document.getElementById( 'i18n_MEDIA_CONTROL_MUTE_UNMUTE' ).innerText                           = __.trans( 'MEDIA_CONTROL_MUTE_UNMUTE' );
    document.getElementById( 'i18n_MEDIA_CONTROL_THUMBS_UP' ).innerText                             = __.trans( 'MEDIA_CONTROL_THUMBS_UP' );
    document.getElementById( 'i18n_MEDIA_CONTROL_THUMBS_DOWN' ).innerText                           = __.trans( 'MEDIA_CONTROL_THUMBS_DOWN' );
    document.getElementById( 'i18n_MEDIA_CONTROL_REPEAT' ).innerText                                = __.trans( 'MEDIA_CONTROL_REPEAT' );
    document.getElementById( 'i18n_MEDIA_CONTROL_SHUFFLE' ).innerText                               = __.trans( 'MEDIA_CONTROL_SHUFFLE' );
    document.getElementById( 'i18n_MEDIA_CONTROL_SEARCH' ).innerText                                = __.trans( 'MEDIA_CONTROL_SEARCH' );
    document.getElementById( 'i18n_MEDIA_CONTROL_QUEUE_OPEN_CLOSE' ).innerText                      = __.trans( 'MEDIA_CONTROL_QUEUE_OPEN_CLOSE' );    
}

function relaunch() {
    remote.app.relaunch();
    remote.app.exit( 0 );
}