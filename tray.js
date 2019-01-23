const { app, Menu, Tray, BrowserWindow } = require( 'electron' );
const path = require( 'path' );
const mediaControl = require( './mediaProvider' );
const nativeImage = require( 'electron' ).nativeImage;
const electronStore = require('electron-store');
const store = new electronStore();
const __ = require( './translateProvider' );

let tray = null;

exports.createTray = function( mainWindow, icon ) {

    tray = new Tray( path.join( __dirname, icon ) );

    const contextMenu = Menu.buildFromTemplate(
        [
            { label: 'YTMD App', type: 'normal', click:
                function() { mainWindow.show(); } },

            { type: 'separator' },

            { label: __.trans( 'MEDIA_CONTROL_PLAY_PAUSE' ), type: 'normal', click:
                function() { mediaControl.playPauseTrack( mainWindow.getBrowserView() ) } },

            { label: __.trans( 'MEDIA_CONTROL_PREVIOUS' ), type: 'normal', click:
                function() { mediaControl.previousTrack( mainWindow.getBrowserView() ) } },

            { label: __.trans( 'MEDIA_CONTROL_NEXT' ), type: 'normal', click:
                function() { mediaControl.nextTrack( mainWindow.getBrowserView() ) } },    

            { type: 'separator' },

            { label: __.trans( 'MEDIA_CONTROL_THUMBS_UP' ), type: 'normal', click:
                function() { mediaControl.upVote( mainWindow.getBrowserView() ) } },

            { label: __.trans( 'MEDIA_CONTROL_THUMBS_DOWN' ), type: 'normal', click:
                function() { mediaControl.downVote( mainWindow.getBrowserView() ) } },

            { type: 'separator' },

            { label: __.trans( 'LABEL_LYRICS' ), type: 'normal', click:
                function() {
                    const lyrics = new BrowserWindow( { frame: false, center: true, resizable: true, backgroundColor: '#232323', width: 700, height: 800, icon: path.join( __dirname, 'assets/favicon.png' ) } );
                    lyrics.loadFile( path.join( __dirname, 'lyrics.html' ) );
                }
            },

            { type: 'separator' },

            { label: __.trans( 'LABEL_SETTINGS' ), type: 'normal', click:
                function() {
                    const settings = new BrowserWindow( { parent: mainWindow, modal: true, frame: false, center: true, resizable: true, backgroundColor: '#232323', width: 800, icon: path.join( __dirname, 'assets/favicon.png' ) } );
                    settings.loadFile( path.join( __dirname, 'settings.html' ) );
                }
            },

            { type: 'separator' },

            { label: __.trans( 'LABEL_EXIT' ), type: 'normal', click:
                function() { app.exit(); }
            }
        ]
    );

    tray.setToolTip( 'YouTube Music Desktop App' );
    tray.setContextMenu( contextMenu );

    tray.addListener( 'click', function() {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } );

    tray.addListener( 'balloon-click', function() {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    } );
};

exports.balloon = function( title, content ) {
    if ( store.get( 'settings-show-notifications' ) ) {
        tray.displayBalloon( {
            icon: path.join( __dirname, 'assets/favicon.256x256.png' ),
            title: title,
            content: content
        } );
    }
};

exports.quit = function() {
    tray.quit();
};