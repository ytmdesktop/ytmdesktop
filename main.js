// Modules to control application life and create native browser window
const { app, BrowserWindow, BrowserView, globalShortcut, Menu, ipcMain } = require( 'electron' );
const path = require( 'path' );
const electronStore = require( 'electron-store' );
const store = new electronStore();
const discordRPC = require( './discordRpcProvider' );
const __ = require( './translateProvider' );
const isDev = require('electron-is-dev');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

let mainWindowSize = {
    width: 1500,
    height: 800
};

let songTitle;
let songAuthor;
let songCover;
let lastSongTitle;
let lastSongAuthor;
let likeStatus;

let mainWindowUrl = "https://music.youtube.com";

let icon = 'assets/favicon.png';

if ( process.platform == 'win32' ) {
    icon = 'assets/favicon.ico'
} else if ( process.platform == 'darwin' ) {
    icon = 'assets/favicon.icns'
}

function createWindow() {
    windowSize = store.get( 'window-size' );
    windowMaximized = store.get( 'window-maximized' );

    if ( windowSize ) {
        mainWindowSize.width = windowSize.width;
        mainWindowSize.height = windowSize.height;
    }

    mainWindow = new BrowserWindow( {
        icon: path.join( __dirname, icon ),
        width: mainWindowSize.width,
        height: mainWindowSize.height,
        show: true,
        autoHideMenuBar: true,
        backgroundColor: '#232323',
        frame: false,
        center: true,
        closable: true,
        skipTaskbar: false,
        resize: true,
        maximizable: true
    } );

    const view = new BrowserView( {
        webPreferences: {
            nodeIntegration: false
        }
    } );

    mainWindow.setBrowserView( view );
    view.setBounds( { x: 1, y: 29, width: mainWindowSize.width-2, height: mainWindowSize.height-30 } );

    mainWindow.loadFile( './index.html' );

    if ( store.get( 'settings-continue-where-left-of' ) && store.get( 'window-url' ) ) {
        mainWindowUrl = store.get( 'window-url' );
    }
    view.webContents.loadURL( mainWindowUrl );

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
    mediaControl.createThumbar( mainWindow, 'play', likeStatus );

    if ( windowMaximized ) {
        setTimeout( function() {
            mainWindow.send( 'window-is-maximized', true );
            view.setBounds( { x: 1, y: 29, width: mainWindowSize.width-2, height: mainWindowSize.height-45 } );
            mainWindow.maximize();
        }, 700 );
    }

    // Emitted when the window is closed.
    mainWindow.on( 'closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    } );

    mainWindow.on( 'show', function () {
        console.log('show')
        mediaControl.createThumbar( mainWindow, 'play', likeStatus );
    } );

    view.webContents.on( 'did-navigate-in-page', function() {
        store.set( 'window-url', view.webContents.getURL() );
        view.webContents.insertCSS( `
            /* width */
            ::-webkit-scrollbar {
                width: 8px;
            }

            /* Track */
            ::-webkit-scrollbar-track {
                background: #232323; 
            }
            
            /* Handle */
            ::-webkit-scrollbar-thumb {
                background: #f44336; 
            }

            /* Handle on hover */
            ::-webkit-scrollbar-thumb:hover {
                background: #555; 
            }
        ` );
    } );

    view.webContents.on( 'media-started-playing', function () {

        view.webContents.executeJavaScript( `document.getElementsByClassName('title ytmusic-player-bar')[0].innerText`, null, function( title ) {
            songTitle = title;

            view.webContents.executeJavaScript(`
                document.getElementById('like-button-renderer').getAttribute('like-status')
            `, null, function( data ) {
                likeStatus = data;
                mediaControl.createThumbar( mainWindow, 'pause', likeStatus );
            } );

            view.webContents.executeJavaScript( `
                var bar = document.getElementsByClassName('subtitle ytmusic-player-bar')[0];
                var title = bar.getElementsByClassName('yt-simple-endpoint yt-formatted-string'); 
                if( !title.length ) { title = bar.getElementsByClassName('byline ytmusic-player-bar') }
                title[0].innerText
            `, null, function ( author ) {
                songAuthor = author;

                if ( songTitle !== undefined && songAuthor !== undefined ) {
                    if ( lastSongTitle !== songTitle || lastSongAuthor !== songAuthor ) {
                        lastSongTitle = songTitle;
                        lastSongAuthor = songAuthor;

                        let nowPlaying = songTitle + ' - ' + songAuthor;

                        songCover = 'cover';

                        console.log( nowPlaying );

                        // view.webContents.executeJavaScript( `document.getElementsByClassName('image style-scope ytmusic-player-bar')[0].src`, null, function( cover ) {} );

                        mainWindow.setTitle( nowPlaying );
                        tray.balloon( songTitle, songAuthor );
                        discordRPC.activity( songTitle, songAuthor );
                    }
                }
            } );
        } );

    });

    view.webContents.on( 'media-paused', function () {
        console.log( 'Paused' );
        mediaControl.createThumbar( mainWindow, 'play', likeStatus );
    });

    mainWindow.on( 'resize', function() {
        const windowSize = mainWindow.getSize();

        if ( mainWindow.isMaximized() ) {
            view.setBounds( { x: 1, y: 29, width: windowSize[0]-2, height: windowSize[1]-45 } );
        } else {
            view.setBounds( { x: 1, y: 29, width: windowSize[0]-2, height: windowSize[1]-30 } );
        }

        mainWindow.send( 'window-is-maximized', mainWindow.isMaximized() );

        store.set( 'window-maximized', mainWindow.isMaximized() );
        if ( !mainWindow.isMaximized() ) {
            store.set( 'window-size', { width: windowSize[0], height: windowSize[1] } );
        }
    } );

    mainWindow.on( 'close', function( e ) {
        e.preventDefault();
        mainWindow.hide();
    } );

    globalShortcut.register( 'MediaPlayPause', function() {
        mediaControl.playPauseTrack( view );
    } );
    globalShortcut.register( 'CmdOrCtrl+Shift+P', function() {
        mediaControl.playPauseTrack( view );
    } );

    globalShortcut.register( 'MediaStop', function() {
        mediaControl.stopTrack( view );
    } );

    globalShortcut.register( 'MediaPreviousTrack', function() {
        mediaControl.previousTrack( view );
    } );
    globalShortcut.register( 'CmdOrCtrl+Shift+PageDown', function() {
        mediaControl.previousTrack( view );
    } );

    globalShortcut.register( 'MediaNextTrack', function() {
        mediaControl.nextTrack( view )
    } );
    globalShortcut.register( 'CmdOrCtrl+Shift+PageUp', function() {
        mediaControl.nextTrack( view );
    } );

    ipcMain.on( 'settings-changed-zoom', function( e, value ) {
        view.webContents.setZoomFactor( value / 100 )
    })

    ipcMain.on( 'what-is-song-playing-now', function( e, data ) {
        e.sender.send( 'song-playing-now-is', { author: songAuthor, title: songTitle } )
    } )

    ipcMain.on( 'will-close-mainwindow', function() {
        if ( store.get( 'settings-keep-background' ) ) {
            mainWindow.hide();
        } else {
            app.exit();
        }
    } )
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on( 'ready', function() {
    createWindow();

    tray.createTray( mainWindow, icon );

    if (!isDev) {
        updater.checkUpdate( mainWindow );
        
        setInterval( function() {
            updater.checkUpdate( mainWindow );
        }, 1 * 60 * 60 * 1000 );
    }
} );

// Quit when all windows are closed.
app.on( 'window-all-closed', function ( ) {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if ( process.platform !== 'darwin' ) {
        app.quit();
    }
} );

app.on( 'activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if ( mainWindow === null ) {
        createWindow();
    }
} );

ipcMain.on( 'show-lyrics', function() {
    createLyricsWindow();
} )

function createLyricsWindow() {
    const lyrics = new BrowserWindow( { 
        frame: false, 
        center: true, 
        resizable: true, 
        backgroundColor: '#232323', 
        width: 700,
        height: 800, 
        icon: path.join( __dirname, 'assets/img/ytm_logo.png' ) 
    } );
    lyrics.loadFile( path.join( __dirname, 'lyrics.html' ) );
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require( './mediaProvider' );
const tray = require( './tray' );
const updater = require( './updateProvider' );
const analytics = require( './analyticsProvider' );

analytics.setEvent( 'main', 'start', 'v' + app.getVersion(), app.getVersion() );
analytics.setScreen( 'main' );