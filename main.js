// Modules to control application life and create native browser window
const {
  app,
  BrowserWindow,
  BrowserView,
  globalShortcut,
  Menu,
  ipcMain,
  systemPreferences
} = require("electron");
const path = require("path");
const fs = require("fs");
const electronStore = require("electron-store");
const store = new electronStore();
const discordRPC = require("./providers/discordRpcProvider");
const __ = require("./providers/translateProvider");
const { statusBarMenu } = require("./providers/templateProvider");
const { setMac, calcYTViewSize } = require("./utils/calcYTViewSize");
const { isWindows, isMac } = require("./utils/systemInfo");
const isDev = require("electron-is-dev");
const isOnline = require("is-online");
const ClipboardWatcher = require("electron-clipboard-watcher");
const {
  companionUrl,
  companionWindowTitle,
  companionWindowSettings
} = require("./server.config");

if (store.get("settings-companion-server")) {
  require("./server");
}

let renderer_for_status_bar = null;
global.sharedObj = { title: "N/A", paused: true };
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

let mainWindowSize = {
  width: 1500,
  height: 800
};

let songTitle = "";
let songAuthor = "";
let songCover = "";
let songDuration = 0;
let songCurrentPosition = 0;
let lastSongTitle;
let lastSongAuthor;
let likeStatus = "INDIFFERENT";
let volumePercent = 0;
let doublePressPlayPause;
let lastConnectionStatusIsOnline = false;
let hasLoadedUrl;
let isPaused = true;
let isClipboardWatcherRunning = false;
let clipboardWatcher = null;

let mainWindowUrl = "https://music.youtube.com";

let icon = "assets/favicon.png";
if (isWindows()) {
  icon = "assets/favicon.ico";
} else if (isMac()) {
  icon = "assets/favicon.16x16.png";
  store.set("settings-shiny-tray-dark", systemPreferences.isDarkMode());
  systemPreferences.subscribeNotification(
    "AppleInterfaceThemeChangedNotification",
    function theThemeHasChanged() {
      store.set("settings-shiny-tray-dark", systemPreferences.isDarkMode());
      if (renderer_for_status_bar)
        renderer_for_status_bar.send("update-status-bar");
    }
  );
  const menu = Menu.buildFromTemplate(statusBarMenu);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  if (isMac() || isWindows()) {
    const execApp = path.basename(process.execPath);
    const startArgs = ["--processStart", `"${execApp}"`];
    const startOnBoot = store.get("settings-start-on-boot");
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
  windowSize = store.get("window-size");
  windowMaximized = store.get("window-maximized");

  if (windowSize) {
    mainWindowSize.width = windowSize.width;
    mainWindowSize.height = windowSize.height;
  }
  broswerWindowConfig = {
    icon: icon,
    width: mainWindowSize.width,
    height: mainWindowSize.height,
    minWidth: 300,
    minHeight: 300,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: "#232323",
    frame: store.get("titlebar-type", "nice") !== "nice",
    center: true,
    closable: true,
    skipTaskbar: false,
    resize: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: true
    }
  };
  if (isMac()) {
    // Mac Specific Configuration
    if (store.get("titlebar-type", "nice") === "nice") {
      broswerWindowConfig.titleBarStyle = "hidden";
      broswerWindowConfig.frame = false;
    } else {
      broswerWindowConfig.frame = true;
    }
  }
  mainWindow = new BrowserWindow(broswerWindowConfig);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: true
    }
  });

  mainWindow.loadFile("./pages/index.html");
  mainWindow.setBrowserView(view);
  setMac(isMac()); // Pass true to utils if currently running under mac
  view.setBounds(calcYTViewSize(store, mainWindow));

  if (store.get("settings-continue-where-left-of") && store.get("window-url")) {
    mainWindowUrl = store.get("window-url");
  }

  view.webContents.loadURL(mainWindowUrl);
  let checkConnectionTimeoutHandler;
  async function checkConnection() {
    /**
     * Check if is online
     */
    var is_online = await isOnline();

    /**
     * If online, consider that already loaded the url
     * If offline, mark the variable that the url was not read
     */
    if (hasLoadedUrl === undefined) {
      lastConnectionStatusIsOnline = hasLoadedUrl = is_online;
    }

    /**
     * Emmit is online or offline to render.js
     */
    mainWindow.send("is-online", is_online);

    /**
     * If online and lastConnectionStatusIsOnline is false, set BrowserView and check hasLoadedUrl to loadURL
     * else set BrowserView to null to show Loading circle and show icon that not have connection
     */
    if (is_online === true) {
      if (lastConnectionStatusIsOnline === false) {
        mainWindow.setBrowserView(view);
        if (hasLoadedUrl === false) {
          view.webContents.loadURL(mainWindowUrl);
          hasLoadedUrl = true;
        }
      }
    } else {
      if (lastConnectionStatusIsOnline === true) {
        if (!global.sharedObj.paused) mediaControl.stopTrack(view);
        mainWindow.setBrowserView(null);
        mediaControl.createThumbar(
          mainWindow,
          playerInfo()["isPaused"],
          likeStatus
        );
      }
    }

    lastConnectionStatusIsOnline = is_online;

    /**
     * Check connection every 60 seconds
     */
    checkConnectionTimeoutHandler = setTimeout(
      () => checkConnection(),
      60 * 1000
    );
  }

  //setTimeout(() => checkConnection(), 15 * 1000);

  // Preserving Performance
  // Why check if Windows is closed/hidden
  // Check again on open/ready
  mainWindow.on("close", () => clearTimeout(checkConnectionTimeoutHandler));
  mainWindow.on("hide", () => clearTimeout(checkConnectionTimeoutHandler));
  mainWindow.on("ready-to-show", () => {
    if (checkConnectionTimeoutHandler) {
      checkConnection();
    }
  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
  // view.webContents.openDevTools({ mode: 'detach' });
  mediaControl.createThumbar(mainWindow, playerInfo()["isPaused"], likeStatus);

  if (windowMaximized) {
    setTimeout(function() {
      mainWindow.send("window-is-maximized", true);
      view.setBounds(calcYTViewSize(store, mainWindow));
      mainWindow.maximize();
    }, 700);
  } else {
    let position = store.get("window-position");
    if (position != undefined) {
      mainWindow.setPosition(position.x, position.y);
    }
  }

  // Emitted when the window is closed.
  mainWindow.on("closed", function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  mainWindow.on("show", function() {
    logDebug("show");
    mediaControl.createThumbar(
      mainWindow,
      playerInfo()["isPaused"],
      likeStatus
    );
  });

  view.webContents.on("did-navigate-in-page", function() {
    store.set("window-url", view.webContents.getURL());
    view.webContents.insertCSS(`
            /* width */
            ::-webkit-scrollbar {
                width: 9px;
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
    // Currently just that simple
    const themePath = path.join(__dirname, "assets/theme.css");
    if (fs.existsSync(themePath)) {
      view.webContents.insertCSS(fs.readFileSync(themePath).toString());
    }
  });

  view.webContents.on("media-started-playing", function() {
    if (isMac()) {
      global.sharedObj.paused = false;
      renderer_for_status_bar.send("update-status-bar");
    }

    /**
     * GET SONG TITLE
     */
    view.webContents.executeJavaScript(
      `document.getElementsByClassName('title ytmusic-player-bar')[0].innerText`,
      null,
      function(title) {
        songTitle = title;

        view.webContents.executeJavaScript(
          `
          document.getElementById('progress-bar').getAttribute('aria-valuemax');
        `,
          null,
          function(data) {
            songDuration = parseInt(data);
          }
        );

        setInterval(function() {
          /**
           * GET LIKE STATUS ATTRIBUTE
           *
           * LIKE | DISLIKE | INDIFFERENT
           */
          view.webContents.executeJavaScript(
            `
                  document.getElementById('like-button-renderer').getAttribute('like-status')
              `,
            true,
            function(data) {
              likeStatus = data;
              mediaControl.createThumbar(
                mainWindow,
                playerInfo()["isPaused"],
                likeStatus
              );
            }
          );

          /**
           * GET CURRENT SEEK BAR POSITION
           */
          view.webContents.executeJavaScript(
            `
            document.getElementById('progress-bar').getAttribute('aria-valuenow');
          `,
            null,
            function(data) {
              songCurrentPosition = parseInt(data);
            }
          );

          view.webContents.executeJavaScript(
            `
            document.getElementsByClassName('volume-slider style-scope ytmusic-player-bar')[0].getAttribute('value')
          `,
            true,
            function(data) {
              volumePercent = parseInt(data);
            }
          );

          /*view.webContents.executeJavaScript(`
            document.getElementById('progress-bar').setAttribute('value', 10)
          `, false,
          function(data ) {
            console.log(data);
          });
          view.webContents.openDevTools({ mode: 'detach' });*/
        }, 500);

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
                  songCover = "cover";
                  view.webContents.executeJavaScript(
                    `
                    var a = document.getElementsByClassName('thumbnail style-scope ytmusic-player no-transition')[0];
                    var b = a.getElementsByClassName('yt-img-shadow')[0];
                    b.src
                  `,
                    null,
                    function(cover) {
                      songCover = cover;
                    }
                  );
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
    let nowPlaying = songTitle + " - " + songAuthor;
    logDebug(nowPlaying);

    if (isMac()) {
      global.sharedObj.title = nowPlaying;
      renderer_for_status_bar.send("update-status-bar");
    }

    mainWindow.setTitle(nowPlaying);
    tray.balloon(songTitle, songAuthor);
    discordRPC.activity(songTitle, songAuthor);
  }

  view.webContents.on("media-started-playing", function() {
    logDebug("Playing");
    try {
      if (isMac()) {
        renderer_for_status_bar.send("update-status-bar");
      }

      global.sharedObj.paused = false;
      mediaControl.createThumbar(
        mainWindow,
        playerInfo()["isPaused"],
        likeStatus
      );
      ipcMain.emit("play-pause", songInfo());
    } catch {}
  });
  view.webContents.on("media-paused", function() {
    logDebug("Paused");
    try {
      if (isMac()) {
        renderer_for_status_bar.send("update-status-bar");
      }

      global.sharedObj.paused = true;
      ipcMain.emit("play-pause", songInfo());
      mediaControl.createThumbar(
        mainWindow,
        playerInfo()["isPaused"],
        likeStatus
      );
    } catch {}
  });

  mainWindow.on("resize", function() {
    let windowSize = mainWindow.getSize();
    setTimeout(() => {
      view.setBounds(calcYTViewSize(store, mainWindow));
    }, 200);

    mainWindow.send("window-is-maximized", mainWindow.isMaximized());

    store.set("window-maximized", mainWindow.isMaximized());
    if (!mainWindow.isMaximized()) {
      store.set("window-size", { width: windowSize[0], height: windowSize[1] });
    }
  });

  let storePositionTimer;
  mainWindow.on("move", function(e) {
    let position = mainWindow.getPosition();
    if (storePositionTimer) {
      clearTimeout(storePositionTimer);
    }
    storePositionTimer = setTimeout(() => {
      store.set("window-position", { x: position[0], y: position[1] });
    }, 500);
  });

  mainWindow.on("focus", () => {
    view.webContents.focus();
  });

  mainWindow.on("close", function(e) {
    if (isMac()) {
      // Optimized for Mac OS X
      if (store.get("settings-keep-background")) {
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

  app.on("before-quit", function(e) {
    if (isMac()) {
      app.exit();
    }
  });

  globalShortcut.register("MediaPlayPause", function() {
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
  globalShortcut.register("CmdOrCtrl+Shift+Space", function() {
    mediaControl.playPauseTrack(view);
  });

  globalShortcut.register("MediaStop", function() {
    mediaControl.stopTrack(view);
  });

  globalShortcut.register("MediaPreviousTrack", function() {
    mediaControl.previousTrack(view);
  });
  globalShortcut.register("CmdOrCtrl+Shift+PageDown", function() {
    mediaControl.previousTrack(view);
  });

  globalShortcut.register("MediaNextTrack", function() {
    mediaControl.nextTrack(view);
  });
  globalShortcut.register("CmdOrCtrl+Shift+PageUp", function() {
    mediaControl.nextTrack(view);
  });

  ipcMain.on("settings-changed-zoom", function(e, value) {
    view.webContents.setZoomFactor(value / 100);
  });

  ipcMain.on("what-is-song-playing-now", function(e, data) {
    if (e !== undefined) {
      e.sender.send("song-playing-now-is", songInfo());
    }
    ipcMain.emit("song-playing-now-is", getAll());
  });

  ipcMain.on("will-close-mainwindow", function() {
    if (store.get("settings-keep-background")) {
      mainWindow.hide();
    } else {
      app.exit();
    }
  });

  ipcMain.on("media-play-pause", () => {
    mediaControl.playPauseTrack(view);
    setTimeout(function() {
      ipcMain.emit("play-pause", songInfo());
    }, 1000);
  });
  ipcMain.on("media-next-track", () => {
    mediaControl.nextTrack(view);
    setTimeout(function() {
      ipcMain.emit("changed-track", songInfo());
    }, 1000);
  });
  ipcMain.on("media-previous-track", () => {
    mediaControl.previousTrack(view);
    setTimeout(function() {
      ipcMain.emit("changed-track", songInfo());
    }, 1000);
  });
  ipcMain.on("media-up-vote", () => {
    mediaControl.upVote(view);
  });
  ipcMain.on("media-down-vote", () => {
    mediaControl.downVote(view);
  });
  ipcMain.on("media-volume-up", () => {
    mediaControl.volumeUp(view);
  });
  ipcMain.on("media-volume-down", () => {
    mediaControl.volumeDown(view);
  });
  ipcMain.on("media-forward-X-seconds", () => {
    mediaControl.mediaForwardXSeconds(view);
  });
  ipcMain.on("media-rewind-X-seconds", () => {
    mediaControl.mediaRewindXSeconds(view);
  });
  ipcMain.on("media-change-seekbar", value => {
    mediaControl.changeSeekbar(view, value);
  });

  ipcMain.on("register-renderer", (event, arg) => {
    renderer_for_status_bar = event.sender;
    event.sender.send("update-status-bar");
    event.sender.send("is-dev", isDev);
    event.sender.send("register-renderer", app);
  });

  ipcMain.on("update-tray", () => {
    if (isMac()) {
      renderer_for_status_bar.send("update-status-bar");
      tray.setShinyTray();
    }
  });

  ipcMain.on("show-settings", function() {
    const settings = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      frame: false,
      center: true,
      resizable: true,
      backgroundColor: "#232323",
      width: 800,
      icon: path.join(__dirname, "./assets/favicon.png"),
      webPreferences: {
        nodeIntegration: true
      },
      autoHideMenuBar: true
    });
    settings.loadFile(path.join(__dirname, "./pages/settings.html"));
  });

  ipcMain.on("switch-clipboard-watcher", () => {
    switchClipboardWatcher();
  });

  // ipcMain.send('update-status-bar', '111', '222');

  function switchClipboardWatcher() {
    logDebug(
      "Switch clipboard watcher: " + store.get("settings-clipboard-read")
    );

    if (isClipboardWatcherRunning) {
      clipboardWatcher !== null && clipboardWatcher.stop();
      clipboardWatcher = null;
      isClipboardWatcherRunning = false;
    } else {
      if (store.get("settings-clipboard-read")) {
        clipboardWatcher = ClipboardWatcher({
          watchDelay: 1000,
          onImageChange: function(nativeImage) {},
          onTextChange: function(text) {
            let regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\?v=)([^#\&\?]*).*/;
            let match = text.match(regExp);
            if (match && match[2].length == 11) {
              let videoId = match[2];
              logDebug("Video readed from clipboard: " + videoId);
              loadMusicByVideoId(videoId);
            }
          }
        });

        isClipboardWatcherRunning = true;
      }
    }
  }

  function loadMusicByVideoId(videoId) {
    view.webContents.loadURL("https://music.youtube.com/watch?v=" + videoId);
  }

  setTimeout(function() {
    ipcMain.emit("switch-clipboard-watcher");
  }, 1000);
}

app.on("browser-window-created", function(e, window) {
  window.setMenu(null);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", function(ev) {
  createWindow();

  tray.createTray(mainWindow, icon);

  ipcMain.on("updated-tray-image", function(event, payload) {
    if (store.get("settings-shiny-tray")) tray.updateImage(payload);
  });

  if (!isDev) {
    updater.checkUpdate(mainWindow);

    setInterval(function() {
      updater.checkUpdate(mainWindow);
    }, 1 * 60 * 60 * 1000);
  }
  ipcMain.emit("ready", app);
  // mediaControl.createTouchBar(mainWindow);
});

// Quit when all windows are closed.
app.on("window-all-closed", function() {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!isMac()) {
    app.quit();
  }
});

app.on("activate", function() {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }
});

ipcMain.on("show-lyrics", function() {
  createLyricsWindow();
});

ipcMain.on("show-companion", function() {
  const x = mainWindow.getPosition()[0];
  const y = mainWindow.getPosition()[1];
  const width = 800;
  const settings = new BrowserWindow({
    // parent: mainWindow,
    skipTaskbar: false,
    frame: true,
    x: x + width / 2,
    y,
    resizable: false,
    backgroundColor: "#232323",
    width: 800,
    title: companionWindowTitle,
    webPreferences: {
      nodeIntegration: false
    },
    icon: path.join(__dirname, icon),
    autoHideMenuBar: true
  });
  settings.loadURL(companionUrl);
  // window.open(companionUrl, companionWindowTitle, companionWindowSettings);
});

function createLyricsWindow() {
  const lyrics = new BrowserWindow({
    frame: false,
    center: true,
    resizable: true,
    backgroundColor: "#232323",
    width: 700,
    height: 800,
    icon: path.join(__dirname, icon),
    webPreferences: {
      nodeIntegration: true
    }
  });
  lyrics.loadFile(path.join(__dirname, "./pages/lyrics.html"));
  //lyrics.webContents.openDevTools();
}

function logDebug(data) {
  if (true) {
    console.log(data);
  }
}

function songInfo() {
  return {
    author: songAuthor,
    title: songTitle,
    cover: songCover,
    duration: songDuration
  };
}

function playerInfo() {
  return {
    isPaused: global.sharedObj.paused,
    volumePercent: volumePercent,
    seekbarCurrentPosition: songCurrentPosition,
    likeStatus: likeStatus
  };
}

function getAll() {
  return {
    song: songInfo(),
    player: playerInfo()
  };
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require("./providers/mediaProvider");
const tray = require("./tray");
const updater = require("./providers/updateProvider");
const analytics = require("./providers/analyticsProvider");

analytics.setEvent("main", "start", "v" + app.getVersion(), app.getVersion());
analytics.setEvent("main", "os", process.platform, process.platform);
analytics.setScreen("main");
