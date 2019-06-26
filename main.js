// Modules to control application life and create native browser window
const {
  app,
  BrowserWindow,
  BrowserView,
  globalShortcut,
  Menu,
  ipcMain,
  systemPreferences
} = require('electron');
const path = require('path');
const electronStore = require('electron-store');
const store = new electronStore();
const discordRPC = require('./providers/discordRpcProvider');
const __ = require('./providers/translateProvider');
const { template } = require('./mac-menu');
const isDev = require('electron-is-dev');
const isOnline = require('is-online');

let renderer_for_status_bar = null;
global.sharedObj = { title: 'N/A', paused: true };
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
let doublePressPlayPause;
let lastConnectionStatusIsOnline = false;

let mainWindowUrl = 'https://music.youtube.com';

let icon = 'assets/favicon.png';
if (process.platform == 'win32') {
  icon = 'assets/favicon.ico';
} else if (process.platform == 'darwin') {
  icon = 'assets/favicon.16x16.png';
  store.set('settings-shiny-tray-dark', systemPreferences.isDarkMode());
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const execApp = path.basename(process.execPath);
    const startArgs = ['--processStart', `"${execApp}"`];
    const startOnBoot = store.get('settings-start-on-boot');
    if (startOnBoot) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: startArgs
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: false,
        args: startArgs
      });
    }
  }
  windowSize = store.get('window-size');
  windowMaximized = store.get('window-maximized');

  if (windowSize) {
    mainWindowSize.width = windowSize.width;
    mainWindowSize.height = windowSize.height;
  }
  broswerWindowConfig = {
    icon: icon,
    width: mainWindowSize.width,
    height: mainWindowSize.height,
    minWidth: 800,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#232323',
    frame: false,
    center: true,
    closable: true,
    skipTaskbar: false,
    resize: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: true
    }
  };
  if (process.platform == 'darwin') {
    // Mac Specific Configuration
    broswerWindowConfig.titleBarStyle = 'hidden';
  }
  mainWindow = new BrowserWindow(broswerWindowConfig);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: true
    }
  });

  mainWindow.loadFile('./index.html');

  view.setBounds({
    x: 1,
    y: 29,
    width: mainWindowSize.width - 2,
    height: mainWindowSize.height - 30
  });
  view.webContents.loadURL( mainWindowUrl );

  if (store.get('settings-continue-where-left-of') && store.get('window-url')) {
    mainWindowUrl = store.get('window-url');
  }
  
  async function checkConnection() {
    var is_online = await isOnline();
    mainWindow.send( 'is-online', is_online );

    if (is_online == true) {
        if (lastConnectionStatusIsOnline == false) {
            mainWindow.setBrowserView( view );
            view.webContents.loadURL( mainWindowUrl );
        }
    } else {
        mainWindow.setBrowserView( null );
    }

    lastConnectionStatusIsOnline = is_online;
}

checkConnection();
setInterval( function() {
    checkConnection();
}, 10 * 1000 );

  // Open the DevTools.
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
  // view.webContents.openDevTools({ mode: 'detach' });
  mediaControl.createThumbar(mainWindow, 'play', likeStatus);

  if (windowMaximized) {
    setTimeout(function() {
      mainWindow.send('window-is-maximized', true);
      view.setBounds({
        x: 1,
        y: 29,
        width: mainWindowSize.width - 2,
        height: mainWindowSize.height - 45
      });
      mainWindow.maximize();
    }, 700);
  } else {
    let position = store.get('window-position');
    if (position != undefined) {
      mainWindow.setPosition(position.x, position.y);
    }
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  mainWindow.on('show', function() {
    logDebug('show');
    mediaControl.createThumbar(mainWindow, 'play', likeStatus);
  });

  view.webContents.on('did-navigate-in-page', function() {
    store.set('window-url', view.webContents.getURL());
    view.webContents.insertCSS(`
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
        `);
  });

  view.webContents.on('media-started-playing', function() {
    if (process.platform === 'darwin') {
      global.sharedObj.paused = false;
      renderer_for_status_bar.send('update-status-bar');
    }

    /**
     * GET SONG TITLE
     */
    view.webContents.executeJavaScript(
      `document.getElementsByClassName('title ytmusic-player-bar')[0].innerText`,
      null,
      function(title) {
        songTitle = title;

        /**
         * GET LIKE STATUS ATTRIBUTE
         *
         * LIKE | DISLIKE | INDIFFERENT
         */
        view.webContents.executeJavaScript(
          `
                document.getElementById('like-button-renderer').getAttribute('like-status')
            `,
          null,
          function(data) {
            likeStatus = data;
            mediaControl.createThumbar(mainWindow, 'pause', likeStatus);
          }
        );

        /**
         * This timeout is necessary because there is a certain delay when changing music and updating the div content
         */
        setTimeout(function() {
          /**
           * GET SONG AUTHOR
           */
          view.webContents.executeJavaScript(
            `
                    var bar = document.getElementsByClassName('subtitle ytmusic-player-bar')[0];
                    var title = bar.getElementsByClassName('yt-simple-endpoint yt-formatted-string');
                    if( !title.length ) { title = bar.getElementsByClassName('byline ytmusic-player-bar') }
                    title[0].innerText
                `,
            null,
            function(author) {
              songAuthor = author;

              if (songTitle !== undefined && songAuthor !== undefined) {
                if (
                  lastSongTitle !== songTitle ||
                  lastSongAuthor !== songAuthor
                ) {
                  lastSongTitle = songTitle;
                  lastSongAuthor = songAuthor;
                  songCover = 'cover';
                  // view.webContents.executeJavaScript( `document.getElementsByClassName('image style-scope ytmusic-player-bar')[0].src`, null, function( cover ) {} );
                  updateActivity(songTitle, songAuthor);
                }
              }
            }
          );
        }, 500);
      }
    );
  });

  function updateActivity(songTitle, songAuthor) {
    let nowPlaying = songTitle + ' - ' + songAuthor;
    logDebug(nowPlaying);

    if (process.platform === 'darwin') {
      global.sharedObj.title = nowPlaying;
      renderer_for_status_bar.send('update-status-bar');
    }

    mainWindow.setTitle(nowPlaying);
    tray.balloon(songTitle, songAuthor);
    discordRPC.activity(songTitle, songAuthor);
  }

  view.webContents.on('media-paused', function() {
    logDebug('Paused');
    try {
      if (process.platform === 'darwin') {
        global.sharedObj.paused = true;
        renderer_for_status_bar.send('update-status-bar');
      }
      mediaControl.createThumbar(mainWindow, 'play', likeStatus);
    } catch {}
  });

  mainWindow.on('resize', function() {
    const windowSize = mainWindow.getSize();

    if (mainWindow.isMaximized()) {
      view.setBounds({
        x: 1,
        y: 29,
        width: windowSize[0] - 2,
        height: windowSize[1] - 45
      });
    } else {
      view.setBounds({
        x: 1,
        y: 29,
        width: windowSize[0] - 2,
        height: windowSize[1] - 30
      });
    }

    mainWindow.send('window-is-maximized', mainWindow.isMaximized());

    store.set('window-maximized', mainWindow.isMaximized());
    if (!mainWindow.isMaximized()) {
      store.set('window-size', { width: windowSize[0], height: windowSize[1] });
    }
  });

  mainWindow.on('move', function() {
    let position = mainWindow.getPosition();
    store.set('window-position', { x: position[0], y: position[1] });
  });

  mainWindow.on('close', function(e) {
    if (process.platform === 'darwin') {
      // Optimized for Mac OS X
      if (store.get('settings-keep-background')) {
        e.preventDefault();
        mainWindow.hide();
      } else {
        app.exit();
      }
      return;
    }
    e.preventDefault();
    mainWindow.hide();
  });

  app.on('before-quit', function(e) {
    if (process.platform === 'darwin') {
      app.exit();
    }
  });

  globalShortcut.register('MediaPlayPause', function() {
    if (!doublePressPlayPause) {
      // The first press
      doublePressPlayPause = true;
      setTimeout(() => {
        if (doublePressPlayPause) mediaControl.playPauseTrack(view);
        doublePressPlayPause = false;
      }, 200);
    } else {
      // The second press
      doublePressPlayPause = false;
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
  globalShortcut.register('CmdOrCtrl+Shift+Space', function() {
    mediaControl.playPauseTrack(view);
  });

  globalShortcut.register('MediaStop', function() {
    mediaControl.stopTrack(view);
  });

  globalShortcut.register('MediaPreviousTrack', function() {
    mediaControl.previousTrack(view);
  });
  globalShortcut.register('CmdOrCtrl+Shift+PageDown', function() {
    mediaControl.previousTrack(view);
  });

  globalShortcut.register('MediaNextTrack', function() {
    mediaControl.nextTrack(view);
  });
  globalShortcut.register('CmdOrCtrl+Shift+PageUp', function() {
    mediaControl.nextTrack(view);
  });

  ipcMain.on('settings-changed-zoom', function(e, value) {
    view.webContents.setZoomFactor(value / 100);
  });

  ipcMain.on('what-is-song-playing-now', function(e, data) {
    e.sender.send('song-playing-now-is', {
      author: songAuthor,
      title: songTitle
    });
  });

  ipcMain.on('will-close-mainwindow', function() {
    if (store.get('settings-keep-background')) {
      mainWindow.hide();
    } else {
      app.exit();
    }
  });

  ipcMain.on('media-play-pause', () => {
    mediaControl.playPauseTrack(view);
  });
  ipcMain.on('media-next-track', () => {
    mediaControl.nextTrack(view);
  });
  ipcMain.on('media-previous-track', () => {
    mediaControl.previousTrack(view);
  });

  ipcMain.on('register-renderer', (event, arg) => {
    renderer_for_status_bar = event.sender;
    event.sender.send('update-status-bar');
    event.sender.send('is-dev', isDev);
  });

  ipcMain.on('update-tray', () => {
    if (process.platform === 'darwin') {
      renderer_for_status_bar.send('update-status-bar');
      tray.setShinyTray();
    }
  });

  ipcMain.on('show-settings', function() {
    const settings = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      frame: false,
      center: true,
      resizable: true,
      backgroundColor: '#232323',
      width: 800,
      icon: path.join(__dirname, 'assets/favicon.png'),
      webPreferences: {
        nodeIntegration: true
      }
    });
    settings.loadFile(path.join(__dirname, 'settings.html'));
  });

  // ipcMain.send('update-status-bar', '111', '222');
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function() {
  createWindow();

  tray.createTray(mainWindow, icon);

  ipcMain.on('updated-tray-image', function(event, payload) {
    if (store.get('settings-shiny-tray')) tray.updateImage(payload);
  });

  if (!isDev) {
    updater.checkUpdate(mainWindow);

    setInterval(function() {
      updater.checkUpdate(mainWindow);
    }, 1 * 60 * 60 * 1000);
  }
  // mediaControl.createTouchBar(mainWindow);
});

// Quit when all windows are closed.
app.on('window-all-closed', function() {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function() {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }
});

ipcMain.on('show-lyrics', function() {
  createLyricsWindow();
});

function createLyricsWindow() {
  const lyrics = new BrowserWindow({
    frame: false,
    center: true,
    resizable: true,
    backgroundColor: '#232323',
    width: 700,
    height: 800,
    icon: path.join(__dirname, icon),
    webPreferences: {
      nodeIntegration: true
    }
  });
  lyrics.loadFile(path.join(__dirname, 'lyrics.html'));
  //lyrics.webContents.openDevTools();
}

function logDebug(data) {
  if (true) {
    console.log(data);
  }
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require('./providers/mediaProvider');
const tray = require('./tray');
const updater = require('./providers/updateProvider');
const analytics = require('./providers/analyticsProvider');

analytics.setEvent('main', 'start', 'v' + app.getVersion(), app.getVersion());
analytics.setEvent('main', 'os', process.platform, process.platform);
analytics.setScreen('main');
