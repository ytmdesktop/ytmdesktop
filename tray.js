const { app, Menu, Tray, BrowserWindow } = require("electron");
const path = require("path");
const mediaControl = require("./providers/mediaProvider");
const nativeImage = require("electron").nativeImage;
const settingsProvider = require("./providers/settingsProvider");
const __ = require("./providers/translateProvider");
const Notification = require("electron-native-notification");
const { doBehavior } = require("./utils/window");
const base64Img = require("base64-img");

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

  tray.addListener("click", () => {
    doBehavior(saved_mainWindow);
  });

  tray.addListener("balloon-click", function() {
    doBehavior(saved_mainWindow);
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

exports.balloon = function(title, content, cover) {
  base64Img.requestBase64(cover, function(err, res, body) {
    var image = nativeImage.createFromDataURL(body);

    if (settingsProvider.get("settings-show-notifications")) {
      if (title && content) {
        if (process.platform == "win32") {
          tray.displayBalloon({
            icon: image,
            title: title,
            content: content
          });
        } else {
          new Notification(title, {
            body: content,
            icon: image
          });
        }
      }
    }
  });
};

exports.quit = function() {
  tray.destroy();
};

exports.setShinyTray = function() {
  if (
    settingsProvider.get("settings-shiny-tray") &&
    process.platform === "darwin"
  ) {
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
        doBehavior(saved_mainWindow);
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
    popUpMenu.loadFile(path.join(__dirname, "./pages/settings/mac_shiny.html"));
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
  if (!settingsProvider.get("settings-shiny-tray")) return;
  var img =
    typeof nativeImage.createFromDataURL === "function"
      ? nativeImage.createFromDataURL(payload) // electron v0.36+
      : nativeImage.createFromDataUrl(payload); // electron v0.30
  tray.setImage(img);
};
