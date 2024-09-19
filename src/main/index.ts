import { app, dialog, ipcMain, Menu, MenuItemConstructorOptions, powerMonitor, safeStorage, screen, Tray } from "electron";
import log from "electron-log";
import watchdog from "./watchdog";
import windowmanager from "./windowmanager";
import { getIconPath, v1ConfigMigration } from "./util";
import autoupdater from "./autoupdater";
import { AppView } from "./windowmanager/appview";
import { YTMViewStatus } from "~shared/types";
import ytmviewmanager from "./ytmviewmanager";
import integrationmanager, { IntegrationManagerHook } from "./integrations/integrationmanager";
import CompanionServer from "./integrations/companion-server";
import CustomCSS from "./integrations/custom-css";
import DiscordPresence from "./integrations/discord-presence";
import LastFM from "./integrations/last-fm";
import NowPlayingNotifications from "./integrations/notifications";
import VolumeRatio from "./integrations/volume-ratio";
import configStore from "./config-store";
import memoryStore from "./memory-store";
import shortcutmanager from "./shortcutmanager";
import path from "node:path";
import statemanager from "./statemanager";
import taskbarmanager from "./taskbarmanager";

declare const TITLEBAR_WINDOW_WEBPACK_ENTRY: string;
declare const TITLEBAR_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const UPDATER_WINDOW_WEBPACK_ENTRY: string;
declare const UPDATER_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Squirrel shortcut creation/removal
// This is part of application installation/uninstallation process close the app immediately
if (require("electron-squirrel-startup")) {
  app.exit();
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on("second-instance", (_, commandLine) => {
    if (windowmanager.hasWindow("Main")) {
      const mainWindow = windowmanager.getWindow("Main");
      mainWindow.showAndFocus();
    }

    handleProtocol(commandLine[commandLine.length - 1]);
  });
}

log.info("Application launched");

//#region Protocol Handler
async function handleProtocol(url: string) {
  log.info("Handling protocol url", url);
  const urlPaths = url.split("://")[1];
  if (urlPaths) {
    const paths = urlPaths.split("/");
    if (paths.length > 0) {
      switch (paths[0]) {
        case "play": {
          if (paths.length >= 2) {
            const videoId = paths[1];
            const playlistId = paths[2];

            if (ytmviewmanager.isInitialized()) {
              log.debug(`Navigating to videoId: ${videoId}, playlistId: ${playlistId}`);
              await ytmviewmanager.ready();
              ytmviewmanager.getView().webContents.send("remoteControl:execute", "navigate", {
                watchEndpoint: {
                  videoId: videoId,
                  playlistId: playlistId
                }
              });
            }
          }
        }
      }
    }
  }
}

// This will register the protocol in development, this is intentional and should stay this way for development purposes
if (!app.isDefaultProtocolClient("ytmd")) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      log.info("Application set as default protcol client for 'ytmd'");
      app.setAsDefaultProtocolClient("ytmd", process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    log.info("Application set as default protcol client for 'ytmd'");
    app.setAsDefaultProtocolClient("ytmd", process.execPath);
  }
}
//#endregion

// Application prerequisites before fully starting
app.enableSandbox();
watchdog.initialize();
autoupdater.initialize();
configStore.initialize();
statemanager.initialize();
integrationmanager.initialize();
ytmviewmanager.initialize();

// appMenu allows for some basic windows management, editMenu allow for copy and paste shortcuts on MacOS
const template: MenuItemConstructorOptions[] = [{ role: "appMenu", label: "YouTube Music Desktop App" }, { role: "editMenu" }];
const builtMenu = process.platform === "darwin" ? Menu.buildFromTemplate(template) : null; // null for performance https://www.electronjs.org/docs/latest/tutorial/performance#8-call-menusetapplicationmenunull-when-you-do-not-need-a-default-menu
Menu.setApplicationMenu(builtMenu);

if (configStore.get("general.disableHardwareAcceleration")) {
  app.disableHardwareAcceleration();
  log.info("Hardware acceleration disabled");
}
if (configStore.get("playback.enableSpeakerFill")) {
  app.commandLine.appendSwitch("try-supported-channel-layouts");
  log.info("Speaker fill enabled");
}

let tray;
let trayContextMenu;
app.on("ready", async () => {
  log.info("Application ready");

  //#region Updater Check
  const updaterWindow = windowmanager.createWindow("Browser", {
    name: "Updater",
    autoRecreate: true,
    waitForViews: true,
    url: UPDATER_WINDOW_WEBPACK_ENTRY,
    electronOptions: {
      width: 256,
      height: 320,
      minWidth: 256,
      minHeight: 320,
      resizable: false,
      frame: false,
      show: false,
      icon: getIconPath("ytmd.png"),
      titleBarStyle: "hidden",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: UPDATER_WINDOW_PRELOAD_WEBPACK_ENTRY,
        devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools")
      }
    }
  });
  const autoUpdaterCallbacks = {
    checking: () => updaterWindow.webContents.send("autoUpdater:checking"),
    available: () => updaterWindow.webContents.send("autoUpdater:available"),
    notAvailable: () => updaterWindow.webContents.send("autoUpdater:not-available"),
    downloaded: () => updaterWindow.webContents.send("autoUpdater:downloaded"),
    error: () => updaterWindow.webContents.send("autoUpdater:error")
  };
  autoupdater.once("checking", autoUpdaterCallbacks.checking);
  autoupdater.once("available", autoUpdaterCallbacks.available);
  autoupdater.once("not-available", autoUpdaterCallbacks.notAvailable);
  autoupdater.once("downloaded", autoUpdaterCallbacks.downloaded);
  autoupdater.once("error", autoUpdaterCallbacks.error);
  if (await autoupdater.checkForUpdates(true)) {
    app.relaunch();
    app.exit();
  } else {
    await new Promise(resolve => {
      setTimeout(resolve, 1500);
    });
  }
  // Ensure the events are unbinded as we don't need them anymore
  autoupdater.off("checking", autoUpdaterCallbacks.checking);
  autoupdater.off("available", autoUpdaterCallbacks.available);
  autoupdater.off("not-available", autoUpdaterCallbacks.notAvailable);
  autoupdater.off("downloaded", autoUpdaterCallbacks.downloaded);
  autoupdater.off("error", autoUpdaterCallbacks.error);
  //#endregion

  v1ConfigMigration();

  shortcutmanager.initialize();
  taskbarmanager.initialize();

  ytmviewmanager.lateInitialize();

  //#region safeStorage setup and checks
  if (!safeStorage.isEncryptionAvailable()) {
    memoryStore.set("safeStorageAvailable", false);
  } else {
    memoryStore.set("safeStorageAvailable", true);
  }

  ipcMain.handle("safeStorage:decryptString", (event, value: string) => {
    if (!memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");

    if (value) {
      return safeStorage.decryptString(Buffer.from(value, "hex"));
    } else {
      return null;
    }
  });

  ipcMain.handle("safeStorage:encryptString", (event, value: string) => {
    if (!memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");

    return safeStorage.encryptString(value).toString("hex");
  });
  //#endregion

  //#region App IPC
  ipcMain.handle("app:getVersion", () => {
    return app.getVersion();
  });

  ipcMain.on("app:relaunch", () => {
    app.relaunch();
    app.quit();
  });
  //#endregion

  //#region Main Window
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
  const windowBounds = configStore.get("state.windowBounds");

  const mainView = new AppView({
    name: "Main",
    url: MAIN_WINDOW_WEBPACK_ENTRY,
    autoRecreate: true,
    viewState: {
      autoResize: {
        width: true,
        height: true,
        offsetHeight: {
          anchor: "Bottom",
          pixels: 36
        }
      }
    },
    electronOptions: {
      webPreferences: {
        transparent: true,
        sandbox: true,
        contextIsolation: true,
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools")
      }
    }
  });

  const mainWindow = windowmanager.createWindow("Browser", {
    name: "Main",
    autoRecreate: true,
    waitForViews: true,
    windowState: {
      maximized: configStore.get("state.windowMaximized")
    },
    views: [mainView],
    url: TITLEBAR_WINDOW_WEBPACK_ENTRY,
    electronOptions: {
      width: windowBounds?.width ?? 1280 / scaleFactor,
      height: windowBounds?.height ?? 720 / scaleFactor,
      x: windowBounds?.x,
      y: windowBounds?.y,
      minWidth: 156,
      minHeight: 180,
      frame: false,
      show: false,
      icon: getIconPath("ytmd.png"),
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#000000",
        symbolColor: "#BBBBBB",
        height: 36
      },
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: TITLEBAR_WINDOW_PRELOAD_WEBPACK_ENTRY,
        devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools"),
        additionalArguments: ["is-main-window"]
      }
    }
  });

  mainWindow.on("electronwindow-resize", () => {
    statemanager.updateState({
      windowBounds: mainWindow._getElectronWindow().getBounds()
    });
  });
  mainWindow.on("electronwindow-move", () => {
    statemanager.updateState({
      windowBounds: mainWindow._getElectronWindow().getBounds()
    });
  });
  mainWindow.on("electronwindow-maximize", () => {
    statemanager.updateState({
      windowMaximized: true
    });
  });
  mainWindow.on("electronwindow-unmaximize", () => {
    statemanager.updateState({
      windowMaximized: false
    });
  });
  // This event is not called if the app is quitting
  // Do not put critical clean up code here
  mainWindow.on("electronwindow-close", event => {
    if (configStore.get("general.hideToTrayOnClose")) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.ipcOn("window:openSettings", () => {
    if (windowmanager.hasWindow("Settings")) {
      windowmanager.getWindow("Settings").showAndFocus();
      return;
    }

    const mainWindowBounds = mainWindow._getElectronWindow().getBounds();
    windowmanager.createWindow("Browser", {
      name: "Settings",
      autoRecreate: true,
      waitForViews: true,
      url: SETTINGS_WINDOW_WEBPACK_ENTRY,
      electronOptions: {
        width: 800,
        height: 600,
        x: Math.round(mainWindowBounds.x + (mainWindowBounds.width / 2 - 400)),
        y: Math.round(mainWindowBounds.y + (mainWindowBounds.height / 2 - 300)),
        minimizable: false,
        maximizable: false,
        resizable: false,
        frame: false,
        show: false,
        icon: getIconPath("ytmd.png"),
        parent: mainWindow._getElectronWindow(),
        modal: process.platform !== "darwin",
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#000000",
          symbolColor: "#BBBBBB",
          height: 36
        },
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY,
          devTools: !app.isPackaged ? true : configStore.get("developer.enableDevTools")
        }
      }
    });
  });
  mainWindow.ipcOn("ytmView:navigateDefault", () => {
    const ytmView = ytmviewmanager.getView();
    if (ytmView) ytmView.webContents.loadURL("https://music.youtube.com/");
  });
  //#endregion

  // Late updater window closure to prevent Electron from emitting window-all-closed before creating the main window
  updaterWindow.destroyWindow();

  //#region Tray creation
  tray = new Tray(
    path.join(
      !app.isPackaged ? path.join(app.getAppPath(), "src/assets/icons") : process.resourcesPath,
      process.platform === "win32" ? "tray.ico" : "trayTemplate.png"
    )
  );
  trayContextMenu = Menu.buildFromTemplate([
    {
      label: "YouTube Music Desktop",
      type: "normal",
      enabled: false
    },
    {
      type: "separator"
    },
    {
      label: "Show/Hide Window",
      type: "normal",
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.showAndFocus();
        }
      }
    },
    {
      label: "Play/Pause",
      type: "normal",
      click: async () => {
        await ytmviewmanager.ready();
        ytmviewmanager.getView().webContents.send("remoteControl:execute", "playPause");
      }
    },
    {
      label: "Previous",
      type: "normal",
      click: async () => {
        await ytmviewmanager.ready();
        ytmviewmanager.getView().webContents.send("remoteControl:execute", "previous");
      }
    },
    {
      label: "Next",
      type: "normal",
      click: async () => {
        await ytmviewmanager.ready();
        ytmviewmanager.getView().webContents.send("remoteControl:execute", "next");
      }
    },
    {
      type: "separator"
    },
    {
      label: "Quit",
      type: "normal",
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setToolTip("YouTube Music Desktop");
  tray.setContextMenu(trayContextMenu);
  tray.on("click", () => {
    mainWindow.showAndFocus();
  });

  log.info("Created tray icon");
  //#endregion

  // Wait for the main window to be ready
  await mainWindow.ready();

  integrationmanager.on("enable-error", (integration, error) => {
    const dialogMessage = `The '${integration.name}' integration failed to be enabled and will be unavailable.\n\n` + `${error.stack}`;
    dialog.showMessageBox({
      title: "Integration Error",
      message: "An integration could not be enabled",
      detail: dialogMessage,
      type: "warning",
      buttons: ["Okay"]
    });
  });
  integrationmanager.createIntegrations([CompanionServer, DiscordPresence, LastFM, NowPlayingNotifications, VolumeRatio, CustomCSS]);

  // Attach events for the ytmviewmanager
  ytmviewmanager.on("status-changed", async () => {
    mainView.webContents.send("ytmView:statusChanged", ytmviewmanager.status);
    if (ytmviewmanager.status === YTMViewStatus.Ready) {
      await mainView.hide(true);
      if (ytmviewmanager.hasError()) {
        const hookError = ytmviewmanager.getError();
        const dialogMessage = `Features from YouTube Music Desktop App may not be present or function correctly\n\n` + `${hookError.stack}`;
        dialog.showMessageBox({
          title: "Hook Error",
          message: "YouTube Music Desktop App could not hook YouTube Music",
          detail: dialogMessage,
          type: "warning",
          buttons: ["I understand"]
        });
      }
    } else {
      await mainView.show(true);
    }
  });
  ytmviewmanager.on("view-recreated", async () => {
    await mainView.show(true);
  });
  ytmviewmanager.on("unresponsive", async () => {
    await mainView.show(true);
  });
  ytmviewmanager.on("responsive", async () => {
    await mainView.hide(true);
  });

  // Initially create the YTM view and attach it
  ytmviewmanager.createView();
  mainWindow.attachView(ytmviewmanager.getView(), 0);

  // This hides the main view if it was recreated and the YTMView is in a ready state
  await mainView.on("recreated", async () => {
    await ytmviewmanager.ready();
    await mainView.hide(true);
  });

  integrationmanager.runHook(IntegrationManagerHook.AppReady);
});

app.on("open-url", (_, url) => {
  handleProtocol(url);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- powerMonitor doesn't have proper types?
powerMonitor.on("shutdown", (event: any) => {
  event.preventDefault();
  statemanager.forceWrite();
  app.quit();
});
app.on("before-quit", () => {
  log.debug("Application going to quit");
  windowmanager.forceWindowClosures();
});
app.on("quit", () => {
  log.debug("Application quit");
  statemanager.forceWrite();
});
process.on("exit", () => {
  statemanager.forceWrite();
});
