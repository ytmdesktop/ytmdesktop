const { app, Menu, Tray, BrowserWindow } = require("electron");
const path = require("path");
const mediaControl = require("./providers/mediaProvider");
const nativeImage = require("electron").nativeImage;
const electronStore = require("electron-store");
const store = new electronStore();
const __ = require("./providers/translateProvider");
const Notification = require("electron-native-notification");

let tray = null;
let saved_icon = null;
let saved_mainWindow = null;

let init_tray = () => {
  const { popUpMenu } = require("./providers/templateProvider");
  const contextMenu = Menu.buildFromTemplate(
    popUpMenu(__, saved_mainWindow, mediaControl, BrowserWindow, path, app)
  );

  tray.setToolTip("YouTube Music Desktop App");
  tray.setContextMenu(contextMenu);

  tray.addListener("click", function() {
    saved_mainWindow.isVisible()
      ? saved_mainWindow.hide()
      : saved_mainWindow.show();
  });

  tray.addListener("balloon-click", function() {
    saved_mainWindow.isVisible()
      ? saved_mainWindow.focus()
      : saved_mainWindow.show();
  });
};

let popUpMenu = null;

exports.createTray = function(mainWindow, icon) {
  saved_icon = path.join(__dirname, icon);
  const nativeImageIcon = nativeImage.createFromPath(saved_icon);
  tray = new Tray(nativeImageIcon);

  saved_mainWindow = mainWindow;
  if (process.platform != "darwin") {
    init_tray();
  } else {
    // on Mac OS X
    tray.setHighlightMode("never");
    exports.setShinyTray();
  }
};

exports.balloon = function(title, content) {
  if (store.get("settings-show-notifications")) {
    if (process.platform == "win32") {
      tray.displayBalloon({
        icon: path.join(__dirname, "assets/favicon.256x256.png"),
        title: title,
        content: content
      });
    } else {
      new Notification(title, {
        body: content,
        icon: path.join(__dirname, "assets/favicon.256x256.png")
      });
    }
  }
};

exports.quit = function() {
  tray.quit();
};

exports.setShinyTray = function() {
  if (store.get("settings-shiny-tray") && process.platform === "darwin") {
    // Shiny tray enabled
    tray.setContextMenu(null);
    tray.removeAllListeners();
    tray.on("right-click", (event, bound, position) => {
      // console.log('right_clicked', bound);
      if (!popUpMenu.isVisible()) {
        popUpMenu.setPosition(bound.x, bound.y + bound.height + 1);
        popUpMenu.show();
      } else {
        popUpMenu.hide();
      }
    });
    tray.on("click", (event, bound, position) => {
      // console.log(position);
      if (position.x < 32) {
        saved_mainWindow.isVisible()
          ? saved_mainWindow.hide()
          : saved_mainWindow.show();
      } else if (position.x > 130) {
        mediaControl.playPauseTrack(saved_mainWindow.getBrowserView());
      }
    });
    popUpMenu = new BrowserWindow({
      frame: false,
      center: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      resizable: false,
      backgroundColor: "#232323",
      width: 160,
      height: 277,
      webPreferences: { nodeIntegration: true }
    });
    popUpMenu.loadFile(path.join(__dirname, "./pages/mac-shiny-menu.html"));
    popUpMenu.setVisibleOnAllWorkspaces(true);
    popUpMenu.hide();
    popUpMenu.on("blur", () => {
      popUpMenu.hide();
    });
  } else {
    // Shiny tray disabled ||| on onther platform
    tray.setImage(saved_icon);
    tray.removeAllListeners();
    init_tray();
  }
};

exports.updateImage = function(payload) {
  if (!store.get("settings-shiny-tray")) return;
  var img =
    typeof nativeImage.createFromDataURL === "function"
      ? nativeImage.createFromDataURL(payload) // electron v0.36+
      : nativeImage.createFromDataUrl(payload); // electron v0.30
  tray.setImage(img);
};
