require("./utils/defaultSettings");

const {
  app,
  BrowserWindow,
  BrowserView,
  globalShortcut,
  Menu,
  ipcMain,
  systemPreferences,
  nativeTheme
} = require("electron");
const path = require("path");
const fs = require("fs");
const scrobblerProvider = require("./providers/scrobblerProvider");
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
const settingsProvider = require("./providers/settingsProvider");
const infoPlayer = require("./utils/injectGetInfoPlayer");
const rainmeterNowPlaying = require("./providers/rainmeterNowPlaying");
const companionServer = require("./providers/companionServer");
const discordRPC = require("./providers/discordRpcProvider");
const { checkBounds, doBehavior } = require("./utils/window");

const electronLocalshortcut = require("electron-localshortcut");

const themePath = path.join(app.getAppPath(), "/assets/custom-theme.css");
if (!themePath) {
  fs.writeFileSync(themePath, `/** \n * Custom Theme \n */`);
}

if (settingsProvider.get("settings-companion-server")) {
  companionServer.start();
}

if (settingsProvider.get("settings-rainmeter-web-now-playing")) {
  rainmeterNowPlaying.start();
}

if (settingsProvider.get("settings-discord-rich-presence")) {
  discordRPC.start();
}

let renderer_for_status_bar = null;
global.sharedObj = { title: "N/A", paused: true };
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow, view, miniplayer;

let mainWindowParams = {
  url: "https://music.youtube.com",
  width: 1500,
  height: 800
};

let infoPlayerInterval;
let customThemeCSSKey;
let lastTrackId;
let doublePressPlayPause;
let lastConnectionStatusIsOnline = false;
let hasLoadedUrl;
let isClipboardWatcherRunning = false;
let clipboardWatcher = null;

let windowConfig = {
  frame: false,
  titleBarStyle: ""
};

let icon = "assets/favicon.png";
if (isWindows()) {
  icon = "assets/favicon.ico";
} else if (isMac()) {
  icon = "assets/favicon.16x16.png";
  settingsProvider.set(
    "settings-shiny-tray-dark",
    nativeTheme.shouldUseDarkColors
  );
  systemPreferences.subscribeNotification(
    "AppleInterfaceThemeChangedNotification",
    function theThemeHasChanged() {
      settingsProvider.set(
        "settings-shiny-tray-dark",
        nativeTheme.shouldUseDarkColors
      );
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
    const startOnBoot = settingsProvider.get("settings-start-on-boot");
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
  windowSize = settingsProvider.get("window-size");
  windowMaximized = settingsProvider.get("window-maximized");

  if (windowSize) {
    mainWindowParams.width = windowSize.width;
    mainWindowParams.height = windowSize.height;
  }
  browserWindowConfig = {
    icon: icon,
    width: mainWindowParams.width,
    height: mainWindowParams.height,
    minWidth: 300,
    minHeight: 300,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: "#232323",
    center: true,
    closable: true,
    skipTaskbar: false,
    resize: true,
    maximizable: true,
    webPreferences: {
      nodeIntegration: true,
      webviewTag: true
    }
  };

  switch (settingsProvider.get("titlebar-type")) {
    case "nice":
      browserWindowConfig.frame = false;
      browserWindowConfig.titleBarStyle = "hidden";

      windowConfig.frame = false;
      windowConfig.titleBarStyle = "hidden";
      break;

    case "system":
      browserWindowConfig.frame = true;

      windowConfig.frame = true;
      windowConfig.titleBarStyle = "hidden";
      break;

    case "none":
      browserWindowConfig.frame = false;
      browserWindowConfig.titleBarStyle = "hidden";

      windowConfig.frame = false;
      windowConfig.titleBarStyle = "hidden";
      break;
  }

  mainWindow = new BrowserWindow(browserWindowConfig);
  mainWindow.webContents.session.setUserAgent(
    "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0"
  );
  view = new BrowserView({
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(app.getAppPath(), "/utils/injectControls.js")
    }
  });

  // mainWindow.loadFile(path.join(app.getAppPath(), "/pages/home/home.html"));
  mainWindow.loadFile(
    path.join(__dirname, "./pages/shared/window-buttons/window-buttons.html"),
    { search: "page=home/home&title=YouTube Music" }
  );
  mainWindow.setBrowserView(view);

  setMac(isMac()); // Pass true to utils if currently running under mac
  view.setBounds(calcYTViewSize(settingsProvider, mainWindow));

  if (
    settingsProvider.get("settings-continue-where-left-of") &&
    settingsProvider.get("window-url")
  ) {
    mainWindowParams.url = settingsProvider.get("window-url");
  }

  view.webContents.loadURL(mainWindowParams.url);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
  // view.webContents.openDevTools({ mode: 'detach' });

  mediaControl.createThumbar(
    mainWindow,
    infoPlayer.getPlayerInfo().isPaused,
    infoPlayer.getPlayerInfo().likeStatus
  );

  if (windowMaximized) {
    setTimeout(function() {
      mainWindow.send("window-is-maximized", true);
      view.setBounds(calcYTViewSize(settingsProvider, mainWindow));
      mainWindow.maximize();
    }, 700);
  } else {
    let position = settingsProvider.get("window-position");
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
    globalShortcut.unregister("CmdOrCtrl+M");

    logDebug("show");
    mediaControl.createThumbar(
      mainWindow,
      infoPlayer.getPlayerInfo().isPaused,
      infoPlayer.getPlayerInfo().likeStatus
    );
  });

  // view.webContents.openDevTools({ mode: 'detach' });
  view.webContents.on("did-navigate-in-page", function() {
    initialized = true;
    settingsProvider.set("window-url", view.webContents.getURL());
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
                background: #555;
            }

            /* Handle on hover */
            ::-webkit-scrollbar-thumb:hover {
                background: #f44336;
            }
        `);
  });

  view.webContents.on("media-started-playing", function() {
    if (!infoPlayer.hasInitialized()) {
      infoPlayer.init(view);
    }

    if (isMac()) {
      global.sharedObj.paused = false;
      renderer_for_status_bar.send("update-status-bar");
    }

    if (infoPlayerInterval === undefined) {
      infoPlayerInterval = setInterval(() => {
        updateActivity();
      }, 800);
    }
  });

  view.webContents.on("did-start-navigation", function(_) {
    loadCustomTheme();

    view.webContents.executeJavaScript("window.location").then(location => {
      if (location.hostname != "music.youtube.com") {
        mainWindow.send("off-the-road");
      } else {
        mainWindow.send("on-the-road");
      }
    });
  });

  function updateActivity() {
    var trackInfo = infoPlayer.getTrackInfo();
    var playerInfo = infoPlayer.getPlayerInfo();

    var title = trackInfo.title;
    var author = trackInfo.author;
    var cover = trackInfo.cover;
    var nowPlaying = `${title} - ${author}`;

    logDebug(nowPlaying);

    discordRPC.setActivity(getAll());
    rainmeterNowPlaying.setActivity(getAll());

    mediaControl.createThumbar(
      mainWindow,
      playerInfo.isPaused,
      playerInfo.likeStatus
    );

    mediaControl.setProgress(
      mainWindow,
      trackInfo.statePercent,
      playerInfo.isPaused
    );

    /**
     * Update only when change track
     */
    if (lastTrackId !== trackInfo.id) {
      lastTrackId = trackInfo.id;

      if (isMac()) {
        global.sharedObj.title = nowPlaying;
        renderer_for_status_bar.send("update-status-bar");
      }

      mainWindow.setTitle(nowPlaying);
      tray.setTooltip(nowPlaying);
      scrobblerProvider.updateTrackInfo(title, author);

      if (!mainWindow.isFocused()) {
        tray.balloon(title, author, cover);
      }
    }
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
        playerInfo()["likeStatus"]
      );
      ipcMain.emit("play-pause", infoPlayer.getTrackInfo());
    } catch {}
  });
  view.webContents.on("media-paused", function() {
    logDebug("Paused");
    try {
      if (isMac()) {
        renderer_for_status_bar.send("update-status-bar");
      }

      global.sharedObj.paused = true;
      ipcMain.emit("play-pause", infoPlayer.getTrackInfo());
      mediaControl.createThumbar(
        mainWindow,
        playerInfo()["isPaused"],
        playerInfo()["likeStatus"]
      );
    } catch {}
  });

  mainWindow.on("resize", function() {
    let windowSize = mainWindow.getSize();
    setTimeout(() => {
      view.setBounds(calcYTViewSize(settingsProvider, mainWindow));
    }, 200);

    mainWindow.send("window-is-maximized", mainWindow.isMaximized());

    settingsProvider.set("window-maximized", mainWindow.isMaximized());
    if (!mainWindow.isMaximized()) {
      settingsProvider.set("window-size", {
        width: windowSize[0],
        height: windowSize[1]
      });
    }
  });

  let storePositionTimer;
  mainWindow.on("move", function(e) {
    let position = mainWindow.getPosition();
    if (storePositionTimer) {
      clearTimeout(storePositionTimer);
    }
    storePositionTimer = setTimeout(() => {
      settingsProvider.set("window-position", {
        x: position[0],
        y: position[1]
      });
    }, 500);
  });

  mainWindow.on("focus", () => {
    view.webContents.focus();
  });

  mainWindow.on("close", function(e) {
    if (settingsProvider.get("settings-keep-background")) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      app.exit();
    }
    return;
  });

  app.on("before-quit", function(e) {
    if (isMac()) {
      app.exit();
    }
    tray.quit();
  });

  app.on("quit", function() {
    tray.quit();
  });

  // LOCAL
  electronLocalshortcut.register(view, "CmdOrCtrl+S", () => {
    ipcMain.emit("show-settings");
  });

  electronLocalshortcut.register(view, "CmdOrCtrl+M", () => {
    ipcMain.emit("show-miniplayer");
  });

  // GLOBAL
  globalShortcut.register("MediaPlayPause", function() {
    if (!doublePressPlayPause) {
      // The first press
      if (infoPlayer.getTrackInfo().id == "") {
        infoPlayer.firstPlay(view.webContents);
      }

      doublePressPlayPause = true;
      setTimeout(() => {
        if (doublePressPlayPause) mediaControl.playPauseTrack(view);
        doublePressPlayPause = false;
      }, 200);
    } else {
      // The second press
      doublePressPlayPause = false;
      doBehavior(mainWindow);
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

  ipcMain.on("restore-main-window", function() {
    mainWindow.show();
  });

  ipcMain.on("settings-changed-zoom", function(e, value) {
    view.webContents.setZoomFactor(value / 100);
  });

  ipcMain.on("what-is-song-playing-now", function(e, _) {
    // IPCRenderer
    if (e !== undefined) {
      e.sender.send("song-playing-now-is", infoPlayer.getAllInfo());
    }

    // IPCMain
    if (infoPlayer.hasInitialized()) {
      ipcMain.emit("song-playing-now-is", infoPlayer.getAllInfo());
    }
  });

  /*ipcMain.on("will-close-mainwindow", function() {
    if (settingsProvider.get("settings-keep-background")) {
      mainWindow.hide();
    } else {
      app.exit();
    }
  });*/

  ipcMain.on("settings-value-changed", (e, data) => {
    switch (data.key) {
      case "settings-rainmeter-web-now-playing":
        if (data.value) {
          rainmeterNowPlaying.start();
        } else {
          rainmeterNowPlaying.stop();
        }
        break;

      case "settings-companion-server":
        if (data.value) {
          companionServer.start();
        } else {
          companionServer.stop();
        }
        break;

      case "settings-discord-rich-presence":
        if (data.value) {
          discordRPC.start();
        } else {
          discordRPC.stop();
        }
        break;

      case "settings-custom-theme":
        if (data.value) {
          loadCustomTheme();
        } else {
          removeCustomTheme();
        }
        break;
    }
  });

  ipcMain.on("media-play-pause", () => {
    mediaControl.playPauseTrack(view);
  });
  ipcMain.on("media-next-track", () => {
    mediaControl.nextTrack(view);
  });
  ipcMain.on("media-previous-track", () => {
    mediaControl.previousTrack(view);
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

  ipcMain.on("btn-update-clicked", () => {
    updater.quitAndInstall();
  });

  ipcMain.on("show-guest-mode", function() {
    const incognitoWindow = new BrowserWindow({
      icon: icon,
      width: mainWindowParams.width,
      height: mainWindowParams.height,
      minWidth: 300,
      minHeight: 300,
      show: true,
      autoHideMenuBar: true,
      backgroundColor: "#232323",
      center: true,
      closable: true,
      skipTaskbar: false,
      resize: true,
      maximizable: true,
      frame: true,
      webPreferences: {
        nodeIntegration: true,
        partition: `guest-mode-${Date.now()}`
      }
    });

    incognitoWindow.webContents.session.setUserAgent(
      "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0"
    );

    incognitoWindow.webContents.loadURL(mainWindowParams.url);
  });

  ipcMain.on("show-settings", function() {
    const settings = new BrowserWindow({
      modal: false,
      frame: windowConfig.frame,
      titleBarStyle: windowConfig.titleBarStyle,
      center: true,
      resizable: true,
      backgroundColor: "#232323",
      width: 900,
      minWidth: 900,
      height: 550,
      minHeight: 550,
      icon: path.join(__dirname, "./assets/favicon.png"),
      autoHideMenuBar: false,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        webviewTag: true
      }
    });
    // settings.loadFile(path.join(app.getAppPath(), "/pages/settings/settings.html"));
    settings.loadFile(
      path.join(__dirname, "./pages/shared/window-buttons/window-buttons.html"),
      {
        search:
          "page=settings/settings&icon=settings&hide=btn-minimize,btn-maximize"
      }
    );
    // settings.webContents.openDevTools();
  });

  ipcMain.on("show-miniplayer", function() {
    miniplayer = new BrowserWindow({
      modal: false,
      frame: false,
      center: false,
      resizable: false,
      alwaysOnTop: true,
      backgroundColor: "#000000",
      width: 200,
      minWidth: 100,
      height: 200,
      minHeight: 100,
      icon: path.join(__dirname, "./assets/favicon.png"),
      autoHideMenuBar: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true
      }
    });

    let miniplayerPosition = settingsProvider.get("miniplayer-position");
    if (miniplayerPosition != undefined) {
      miniplayer.setPosition(miniplayerPosition.x, miniplayerPosition.y);
    }

    miniplayer.loadFile(
      path.join(app.getAppPath(), "/pages/miniplayer/miniplayer.html")
    );

    miniplayer.on("move", function(e) {
      let storeMiniplayerPositionTimer;
      let position = miniplayer.getPosition();
      if (storeMiniplayerPositionTimer) {
        clearTimeout(storeMiniplayerPositionTimer);
      }
      storeMiniplayerPositionTimer = setTimeout(() => {
        settingsProvider.set("miniplayer-position", {
          x: position[0],
          y: position[1]
        });
      }, 500);
    });

    mainWindow.hide();

    globalShortcut.register("CmdOrCtrl+M", function() {
      miniplayer.hide();
      mainWindow.show();
    });

    // miniplayer.webContents.openDevTools();
  });

  ipcMain.on("show-last-fm-login", function() {
    const lastfm = new BrowserWindow({
      //parent: mainWindow,
      modal: false,
      frame: windowConfig.frame,
      titleBarStyle: windowConfig.titleBarStyle,
      center: true,
      resizable: true,
      backgroundColor: "#232323",
      width: 300,
      minWidth: 300,
      height: 260,
      minHeight: 260,
      icon: path.join(__dirname, "./assets/favicon.png"),
      autoHideMenuBar: false,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        webviewTag: true
      }
    });

    // lastfm.loadFile(path.join(app.getAppPath(), "/pages/settings/last-fm-login.html"));
    lastfm.loadFile(
      path.join(__dirname, "./pages/shared/window-buttons/window-buttons.html"),
      {
        search:
          "page=settings/last-fm-login&icon=music_note&hide=btn-minimize,btn-maximize"
      }
    );
    // lastfm.webContents.openDevTools();
  });

  ipcMain.on("switch-clipboard-watcher", () => {
    switchClipboardWatcher();
  });

  ipcMain.on("reset-url", () => {
    mainWindow.getBrowserView().webContents.loadURL(mainWindowParams.url);
  });

  ipcMain.on("show-editor-theme", function() {
    const editor = new BrowserWindow({
      frame: windowConfig.frame,
      titleBarStyle: windowConfig.titleBarStyle,
      center: true,
      resizable: true,
      backgroundColor: "#232323",
      width: 700,
      height: 800,
      maxHeight: 800,
      minHeight: 800,
      icon: path.join(__dirname, icon),
      webPreferences: {
        nodeIntegration: true,
        webviewTag: true
      }
    });

    // editor.loadFile(path.join(app.getAppPath(), "/pages/editor/editor.html"));
    editor.loadFile(
      path.join(__dirname, "./pages/shared/window-buttons/window-buttons.html"),
      {
        search:
          "page=editor/editor&icon=color_lens&hide=btn-minimize,btn-maximize"
      }
    );
    // editor.webContents.openDevTools();
  });

  ipcMain.on("update-custom-theme", function() {
    loadCustomTheme();
  });

  function loadCustomTheme() {
    if (settingsProvider.get("settings-custom-theme")) {
      if (fs.existsSync(themePath)) {
        if (customThemeCSSKey) {
          removeCustomTheme();
        }
        view.webContents
          .insertCSS(fs.readFileSync(themePath).toString())
          .then(key => {
            customThemeCSSKey = key;
          });
      }
    }
  }

  function removeCustomTheme() {
    view.webContents.removeInsertedCSS(customThemeCSSKey);
  }

  function switchClipboardWatcher() {
    logDebug(
      "Switch clipboard watcher: " +
        settingsProvider.get("settings-clipboard-read")
    );

    if (isClipboardWatcherRunning) {
      clipboardWatcher !== null && clipboardWatcher.stop();
      clipboardWatcher = null;
      isClipboardWatcherRunning = false;
    } else {
      if (settingsProvider.get("settings-clipboard-read")) {
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
  // window.setMenu(null);
  window.removeMenu();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", function(ev) {
  checkBounds();

  createWindow();

  tray.createTray(mainWindow, icon);

  ipcMain.on("updated-tray-image", function(event, payload) {
    if (settingsProvider.get("settings-shiny-tray")) tray.updateImage(payload);
  });
  if (!isDev) {
    updater.checkUpdate(mainWindow, view);

    setInterval(function() {
      updater.checkUpdate(mainWindow, view);
    }, 1 * 60 * 60 * 1000);
  }
  ipcMain.emit("ready", app);
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
  const lyrics = new BrowserWindow({
    frame: windowConfig.frame,
    titleBarStyle: windowConfig.titleBarStyle,
    center: true,
    resizable: true,
    backgroundColor: "#232323",
    width: 700,
    height: 800,
    icon: path.join(__dirname, icon),
    webPreferences: {
      nodeIntegration: true,
      webviewTag: true
    }
  });

  let lyricsPosition = settingsProvider.get("lyrics-position");
  if (lyricsPosition != undefined) {
    lyrics.setPosition(lyricsPosition.x, lyricsPosition.y);
  }

  lyrics.loadFile(
    path.join(__dirname, "./pages/shared/window-buttons/window-buttons.html"),
    {
      search:
        "page=lyrics/lyrics&icon=music_note&hide=btn-minimize,btn-maximize"
    }
  );

  lyrics.on("move", function(e) {
    let storeLyricsPositionTimer;
    let position = lyrics.getPosition();
    if (storeLyricsPositionTimer) {
      clearTimeout(storeLyricsPositionTimer);
    }
    storeLyricsPositionTimer = setTimeout(() => {
      settingsProvider.set("lyrics-position", {
        x: position[0],
        y: position[1]
      });
    }, 500);
  });

  // lyrics.loadFile(path.join(__dirname, "./pages/lyrics/lyrics.html"));
  // lyrics.webContents.openDevTools();
});

ipcMain.on("show-companion", function() {
  const x = mainWindow.getPosition()[0];
  const y = mainWindow.getPosition()[1];
  const width = 800;
  const settings = new BrowserWindow({
    // parent: mainWindow,
    skipTaskbar: false,
    frame: windowConfig.frame,
    titleBarStyle: windowConfig.titleBarStyle,
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
});

function logDebug(data) {
  if (false) {
    console.log(data);
  }
}

function songInfo() {
  return infoPlayer.getTrackInfo();
}

function playerInfo() {
  return infoPlayer.getPlayerInfo();
}

function getAll() {
  return {
    track: songInfo(),
    player: playerInfo()
  };
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require("./providers/mediaProvider");
const tray = require("./providers/trayProvider");
const updater = require("./providers/updateProvider");
const analytics = require("./providers/analyticsProvider");

analytics.setEvent("main", "start", "v" + app.getVersion(), app.getVersion());
analytics.setEvent("main", "os", process.platform, process.platform);
analytics.setScreen("main");
