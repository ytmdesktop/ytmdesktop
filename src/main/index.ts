import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray,
} from "electron";
import log from "electron-log";
import {
  appendDisableFeatureSwitch,
  getIconPath,
  v1ConfigMigration,
} from "./util";
import { AppView } from "./services/windowmanager/appview";
import {
  YTMViewSetupCompletionFlags,
  YTMViewSetupCompletionFlagsNames,
  YTMViewStatus,
} from "~shared/types";
import CompanionServer from "./integrations/companion-server";
import CustomCSS from "./integrations/custom-css";
import DiscordPresence from "./integrations/discord-presence";
import LastFM from "./integrations/last-fm";
import NowPlayingNotifications from "./integrations/notifications";
import VolumeRatio from "./integrations/volume-ratio";
import EnhancedMediaService from "./integrations/enhanced-media-service";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import electronSquirrelStartup from "electron-squirrel-startup";
import { ServiceHost } from "./services/servicehost";
import WatchDog from "./services/watchdog";
import AutoUpdater from "./services/autoupdater";
import ConfigStore from "./services/configstore";
import IntegrationManager, {
  IntegrationManagerHook,
} from "./services/integrationmanager";
import YTMViewManager from "./services/ytmviewmanager";
import ShortcutManager from "./services/shortcutmanager";
import TaskbarManager from "./services/taskbarmanager";
import AppWindowManager from "./services/windowmanager";
import { ServiceCollection } from "./services/servicecollection";
import StateManager from "./services/statemanager";
import MemoryStore from "./services/memorystore";
import { MemoryStoreSchema, TrayIconStyle } from "~shared/store/schema";
import ProtocolManager, {
  extractYtmdProtocolUrl,
  isListenInviteProtocolUrl,
  MAX_YTMD_PROTOCOL_URL_LENGTH,
} from "./services/protocolmanager";
import PlayerStateStore from "./services/playerstatestore";
import ProtectedAPIManager from "./services/protectedapimanager";
import ListenTogetherService from "./services/listentogether";
import {
  applyListenTogetherLayout,
  computeListenTogetherLayout,
} from "./services/listentogether/layout";
import { LISTEN_TOGETHER_IPC } from "~shared/listentogether/ipc";
import { redactInviteUrl, redactLogUrl } from "~shared/listentogether/logger";
import { VideoType } from "~shared/playerstatestore/types";

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string | undefined;

function resolveAppWindowUrl(route: string, devHtmlPath: string): string {
  if (
    !app.isPackaged &&
    process.env.YTMD_E2E_MODE !== "1" &&
    typeof ALL_WINDOWS_VITE_DEV_SERVER_URL === "string" &&
    ALL_WINDOWS_VITE_DEV_SERVER_URL.length > 0
  ) {
    return `${ALL_WINDOWS_VITE_DEV_SERVER_URL}${devHtmlPath}`;
  }
  return `ytmd-app://${route}`;
}

// Squirrel shortcut creation/removal
// This is part of application installation/uninstallation process close the app immediately
if (electronSquirrelStartup) {
  if (
    process.platform === "win32" &&
    (process.argv.includes("--squirrel-install") ||
      process.argv.includes("--squirrel-updated"))
  ) {
    try {
      const tailcatExe = path.join(process.resourcesPath ?? "", "tailcat.exe");
      if (fs.existsSync(tailcatExe)) {
        const escapedPath = tailcatExe.replace(/'/g, "''");
        const innerScript = [
          `Unblock-File -LiteralPath '${escapedPath}' -ErrorAction SilentlyContinue`,
          `Remove-NetFirewallRule -DisplayName 'YTMD Tailcat (In)','YTMD Tailcat (Out)' -ErrorAction SilentlyContinue`,
          `New-NetFirewallRule -DisplayName 'YTMD Tailcat (In)' -Direction Inbound -Program '${escapedPath}' -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
          `New-NetFirewallRule -DisplayName 'YTMD Tailcat (Out)' -Direction Outbound -Program '${escapedPath}' -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null`,
        ].join("; ");
        const encoded = Buffer.from(innerScript, "utf16le").toString("base64");
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'`,
          ],
          { timeout: 30_000, windowsHide: true, stdio: "ignore" },
        );
      }
    } catch {
      // User cancelled UAC prompt or elevation unavailable; continue setup cleanly.
    }
  }
  app.exit();
}

// Chromium's Wayland Ozone backend is incompatible with Vulkan; disable Vulkan
// when running on a Wayland session so GPU initialization stays clean.
if (
  process.platform === "linux" &&
  (Boolean(process.env.WAYLAND_DISPLAY) ||
    process.env.XDG_SESSION_TYPE === "wayland" ||
    app.commandLine.getSwitchValue("ozone-platform") === "wayland")
) {
  appendDisableFeatureSwitch("Vulkan");
}

const serviceCollection = new ServiceCollection();
serviceCollection.addServices([
  WatchDog,
  ConfigStore,
  AppWindowManager,
  MemoryStore<MemoryStoreSchema>,
  AutoUpdater,
  StateManager,
  ProtectedAPIManager,
  PlayerStateStore,
  YTMViewManager,
  ListenTogetherService,
  ShortcutManager,
  TaskbarManager,
  ProtocolManager,
  // This will always go last as it depends on every service since it's an optional system and integrations can perform work with any service
  IntegrationManager,
]);
const serviceHost = new ServiceHost(serviceCollection);

const pendingEarlyProtocolUrls: string[] = [];

if (process.env.YTMD_TEST_USER_DATA_DIR) {
  app.setPath("userData", process.env.YTMD_TEST_USER_DATA_DIR);
}

const MAX_LOG_FILE_BYTES = 512 * 1024;

function pruneLogArtifacts(logFilePath: string | undefined, maxBytes: number) {
  if (!logFilePath) return;
  try {
    const dir = path.dirname(logFilePath);
    const base = path.basename(logFilePath);
    for (const entry of fs.readdirSync(dir)) {
      if (entry === base) continue;
      if (entry.endsWith(".old.log") || entry.startsWith(`${base}.`)) {
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    }
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > maxBytes) {
      fs.truncateSync(logFilePath, 0);
    }
  } catch {
    // Ignore log pruning errors on startup
  }
}

const swallowBrokenPipe = (err: NodeJS.ErrnoException) => {
  if (err?.code === "EPIPE") return;
};
process.stdout?.on?.("error", swallowBrokenPipe);
process.stderr?.on?.("error", swallowBrokenPipe);

const configuredFileLevel = process.env.YTMD_LOG_LEVEL as
  | log.LevelOption
  | undefined;
log.transports.file.level = configuredFileLevel || "warn";
log.transports.file.maxSize = MAX_LOG_FILE_BYTES;
log.transports.console.level = app.isPackaged
  ? false
  : configuredFileLevel || "info";
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
pruneLogArtifacts(log.transports.file.getFile()?.path, MAX_LOG_FILE_BYTES);

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on("second-instance", (_, commandLine) => {
    // If the service host isn't initialized the app is still starting up
    if (!serviceHost.initialized) return;

    log.debug("Second instance");

    const windowManager = serviceHost.getService(AppWindowManager);
    if (windowManager.hasWindow("Miniplayer")) {
      log.debug("Closing miniplayer");
      // Main window will automatically show upon closure of the miniplayer
      windowManager.getWindow("Miniplayer").closeWindow();
    } else if (windowManager.hasWindow("Main")) {
      windowManager.getWindow("Main").showAndFocus();
    }

    const protocolUrl = extractYtmdProtocolUrl(commandLine);
    if (protocolUrl) {
      log.info("Second instance handling ytmd:// protocol URL", {
        url: redactInviteUrl(redactLogUrl(protocolUrl)),
      });
      void serviceHost
        .getService(ProtocolManager)
        .handleYTMDProtocol(protocolUrl);
    }
  });
}

log.info("Application launched", {
  logFile: log.transports.file.getFile()?.path ?? null,
});

// Application prerequisites before fully starting
app.enableSandbox();

// appMenu allows for some basic windows management, editMenu allow for copy and paste shortcuts on MacOS
const template: MenuItemConstructorOptions[] = [
  { role: "appMenu", label: "YTMDesktop" },
  { role: "editMenu" },
];
const builtMenu =
  process.platform === "darwin" ? Menu.buildFromTemplate(template) : null; // null for performance https://www.electronjs.org/docs/latest/tutorial/performance#8-call-menusetapplicationmenunull-when-you-do-not-need-a-default-menu
Menu.setApplicationMenu(builtMenu);

// At this stage the next lifecycle is PreInitialized
serviceHost.runNextLifecycle();
const integrationManager = serviceHost.getService(IntegrationManager);
integrationManager.on("enable-error", (integration, error) => {
  const dialogMessage =
    `The '${integration.name}' integration failed to be enabled and will be unavailable.\n\n` +
    `${error.stack}`;
  dialog.showMessageBox({
    title: "Integration Error",
    message: "An integration could not be enabled",
    detail: dialogMessage,
    type: "warning",
    buttons: ["Okay"],
  });
});
integrationManager.createIntegrations([
  CompanionServer,
  DiscordPresence,
  LastFM,
  NowPlayingNotifications,
  VolumeRatio,
  CustomCSS,
  EnhancedMediaService,
]);
integrationManager.runHook(IntegrationManagerHook.AppBeforeReady);

let tray: Tray;
let trayContextMenu;
app.on("ready", async () => {
  log.info("Application ready");

  // At this stage the next lifecycle is Initialized
  serviceHost.runNextLifecycle();

  const configStore = serviceHost.getService(ConfigStore);
  const memoryStore = serviceHost.getService(MemoryStore<MemoryStoreSchema>);
  const autoUpdater = serviceHost.getService(AutoUpdater);
  const windowManager = serviceHost.getService(AppWindowManager);
  const ytmViewManager = serviceHost.getService(YTMViewManager);
  const stateManager = serviceHost.getService(StateManager);
  const playerStateStore = serviceHost.getService(PlayerStateStore);
  const protectedApiManager = serviceHost.getService(ProtectedAPIManager);
  const listenTogetherService = serviceHost.getService(ListenTogetherService);

  //#region Updater Check
  const updaterWindow = windowManager.createWindow("Browser", {
    name: "Updater",
    autoRecreate: false,
    waitForViews: true,
    url: resolveAppWindowUrl("updater", "/windows/updater/index.html"),
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
        preload: path.join(__dirname, `../preload/windows/updater/preload.cjs`),
        devTools: !app.isPackaged
          ? true
          : configStore.get("developer.enableDevTools"),
      },
    },
  });
  const autoUpdaterCallbacks = {
    checking: () => updaterWindow.webContents?.send("autoUpdater:checking"),
    available: () => updaterWindow.webContents?.send("autoUpdater:available"),
    notAvailable: () =>
      updaterWindow.webContents?.send("autoUpdater:not-available"),
    downloaded: () => updaterWindow.webContents?.send("autoUpdater:downloaded"),
    error: () => updaterWindow.webContents?.send("autoUpdater:error"),
  };
  autoUpdater.once("checking", autoUpdaterCallbacks.checking);
  autoUpdater.once("available", autoUpdaterCallbacks.available);
  autoUpdater.once("not-available", autoUpdaterCallbacks.notAvailable);
  autoUpdater.once("downloaded", autoUpdaterCallbacks.downloaded);
  autoUpdater.once("error", autoUpdaterCallbacks.error);
  if (process.env.YTMD_E2E_MODE !== "1") {
    if (!autoUpdater.isDisabled() && (await autoUpdater.checkForUpdates(true))) {
      autoUpdater.quitAndInstall();
      return;
    } else if (!app.isPackaged) {
      // Better visual feedback for the updater window when in development mode
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
    }
  }
  // Ensure the events are unbinded as we don't need them anymore
  autoUpdater.off("checking", autoUpdaterCallbacks.checking);
  autoUpdater.off("available", autoUpdaterCallbacks.available);
  autoUpdater.off("not-available", autoUpdaterCallbacks.notAvailable);
  autoUpdater.off("downloaded", autoUpdaterCallbacks.downloaded);
  autoUpdater.off("error", autoUpdaterCallbacks.error);
  //#endregion

  // At this stage the next lifecycle is PostInitialized
  serviceHost.runNextLifecycle();

  v1ConfigMigration(serviceHost.getService(ConfigStore));

  //#region safeStorage setup and checks
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    memoryStore.set("safeStorageAvailable", false);
  } else {
    memoryStore.set("safeStorageAvailable", true);
  }

  function assertAuthorizedSafeStorageSender(
    senderId: number,
    channel: string,
  ) {
    const ytmViewWebContentsId = ytmViewManager.getView()?.webContents?.id;
    if (
      ytmViewWebContentsId !== undefined &&
      senderId === ytmViewWebContentsId
    ) {
      log.warn(
        `safeStorage: rejected ${channel} from unauthorized sender ${senderId} (ytmView webContents)`,
      );
      throw new Error("Unauthorized sender for safeStorage");
    }

    const settingsWebContentsId = windowManager.hasWindow("Settings")
      ? windowManager.getWindow("Settings").webContents?.id
      : undefined;
    if (
      settingsWebContentsId === undefined ||
      senderId !== settingsWebContentsId
    ) {
      log.warn(
        `safeStorage: rejected ${channel} from unauthorized sender ${senderId} (expected Settings webContents ${settingsWebContentsId ?? "none"})`,
      );
      throw new Error("Unauthorized sender for safeStorage");
    }
  }

  ipcMain.handle("safeStorage:decryptString", async (event, value: string) => {
    assertAuthorizedSafeStorageSender(
      event.sender.id,
      "safeStorage:decryptString",
    );
    if (!memoryStore.get("safeStorageAvailable"))
      throw new Error("safeStorage is unavailable");

    if (value) {
      const decrypt = await safeStorage.decryptStringAsync(
        Buffer.from(value, "hex"),
      );
      return decrypt.result;
    } else {
      return null;
    }
  });

  ipcMain.handle("safeStorage:encryptString", async (event, value: string) => {
    assertAuthorizedSafeStorageSender(
      event.sender.id,
      "safeStorage:encryptString",
    );
    if (!memoryStore.get("safeStorageAvailable"))
      throw new Error("safeStorage is unavailable");

    const encrypt = await safeStorage.encryptStringAsync(value);
    return encrypt.toString("hex");
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
    url: resolveAppWindowUrl("main", "/windows/main/index.html"),
    autoRecreate: true,
    viewState: {
      autoResize: {
        width: true,
        height: true,
        offsetHeight: {
          anchor: "Bottom",
          pixels: 36,
        },
      },
    },
    electronOptions: {
      webPreferences: {
        transparent: true,
        sandbox: true,
        contextIsolation: true,
        preload: path.join(__dirname, `../preload/windows/main/preload.cjs`),
        devTools: !app.isPackaged
          ? true
          : configStore.get("developer.enableDevTools"),
      },
    },
  });
  mainView.ipcOn("ytmView:reload", () => {
    const ytmView = ytmViewManager.getView();
    if (ytmView) {
      ytmView.webContents?.reload();
    }
  });

  const mainWindow = windowManager.createWindow("Browser", {
    name: "Main",
    autoRecreate: false,
    waitForViews: true,
    windowState: {
      maximized: configStore.get("state.windowMaximized"),
    },
    views: [mainView],
    url: resolveAppWindowUrl("titlebar", "/windows/titlebar/index.html"),
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
        height: 36,
      },
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: path.join(
          __dirname,
          `../preload/windows/titlebar/preload.cjs`,
        ),
        devTools: !app.isPackaged
          ? true
          : configStore.get("developer.enableDevTools"),
        additionalArguments: ["is-main-window"],
      },
    },
  });

  const listenTogetherView = new AppView({
    name: "ListenTogether",
    url: resolveAppWindowUrl(
      "listen-together",
      "/windows/listen-together/index.html",
    ),
    autoRecreate: true,
    openDevTools: false,
    viewState: {
      autoResize: {
        width: false,
        height: true,
        fixedWidth: {
          pixels: 340,
          anchor: "Right",
        },
        offsetHeight: {
          anchor: "Bottom",
          pixels: 36,
        },
      },
    },
    electronOptions: {
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: path.join(
          __dirname,
          `../preload/windows/listen-together/preload.cjs`,
        ),
        devTools: !app.isPackaged
          ? true
          : configStore.get("developer.enableDevTools"),
      },
    },
  });
  void listenTogetherView.hide();

  let inHtmlFullscreen = false;
  const getListenTogetherLayout = () => {
    const windowWidth = mainWindow
      ._getElectronWindow()
      .getContentBounds().width;
    const panelOpen = listenTogetherService.getUIState().panelOpen;
    return computeListenTogetherLayout(
      windowWidth,
      panelOpen,
      inHtmlFullscreen,
    );
  };
  const syncListenTogetherLayout = () => {
    applyListenTogetherLayout(
      getListenTogetherLayout(),
      listenTogetherView,
      ytmViewManager.getView(),
    );
  };

  mainWindow.on("electronwindow-resize", () => {
    stateManager.updateState({
      windowBounds: mainWindow._getElectronWindow().getBounds(),
    });
    syncListenTogetherLayout();
  });
  mainWindow.on("electronwindow-move", () => {
    stateManager.updateState({
      windowBounds: mainWindow._getElectronWindow().getBounds(),
    });
  });
  mainWindow.on("electronwindow-maximize", () => {
    stateManager.updateState({
      windowMaximized: true,
    });
    syncListenTogetherLayout();
  });
  mainWindow.on("electronwindow-unmaximize", () => {
    stateManager.updateState({
      windowMaximized: false,
    });
    syncListenTogetherLayout();
  });
  const syncListenTogetherAuthorizedSenders = () => {
    const senderIds = [
      mainWindow.webContents?.id,
      listenTogetherView._getElectronView()?.webContents.id,
    ].filter((id): id is number => typeof id === "number");
    listenTogetherService.setAuthorizedSenderIds(senderIds);
  };
  listenTogetherView.on("recreated", () => {
    syncListenTogetherAuthorizedSenders();
    syncListenTogetherLayout();
  });
  listenTogetherService.on("panel-toggled", () => {
    syncListenTogetherLayout();
  });

  mainWindow.ipcOn("ytmView:switchFocus", (_event, context?: string) => {
    const layout = getListenTogetherLayout();
    if (
      layout.focusTarget === "listenTogether" ||
      (context === "listenTogether" && layout.listenTogetherVisible)
    ) {
      listenTogetherView.webContents?.focus();
    } else {
      ytmViewManager.getView()?.webContents?.focus();
    }
  });

  let allowHostQuitClose = false;
  let hostQuitConfirmPending = false;
  // This event is not called if the app is quitting
  // Do not put critical clean up code here
  mainWindow.on("electronwindow-close", (event) => {
    stateManager.updateState({
      windowBounds: mainWindow._getElectronWindow().getBounds(),
    });
    stateManager.updateState({
      windowMaximized: mainWindow._getElectronWindow().isMaximized(),
    });

    if (configStore.get("general.hideToTrayOnClose")) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }

    if (allowHostQuitClose) {
      return;
    }

    const quitGuard = listenTogetherService.getHostQuitGuardInfo();
    if (quitGuard.shouldConfirm) {
      event.preventDefault();
      if (hostQuitConfirmPending) {
        return;
      }
      hostQuitConfirmPending = true;
      log.info("Listen Together Host quit guard triggered", {
        guestCount: quitGuard.guestCount,
      });
      const friendLabel = quitGuard.guestCount === 1 ? "friend" : "friends";
      void dialog
        .showMessageBox(mainWindow._getElectronWindow(), {
          type: "question",
          title: "Listen Together",
          message: `End Listen Together room for ${quitGuard.guestCount} ${friendLabel} and quit?`,
          buttons: ["Cancel", "End Room & Quit"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(async (result) => {
          hostQuitConfirmPending = false;
          if (result.response === 1) {
            log.info(
              "Host confirmed ending Listen Together room and quitting",
              {
                guestCount: quitGuard.guestCount,
              },
            );
            allowHostQuitClose = true;
            await listenTogetherService.leaveRoom();
            mainWindow.closeWindow();
          } else {
            log.info(
              "Host cancelled quit confirmation; keeping Listen Together room open",
              { guestCount: quitGuard.guestCount },
            );
          }
        })
        .catch((err) => {
          hostQuitConfirmPending = false;
          log.warn("Listen Together Host quit confirmation dialog failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  });

  mainWindow.ipcOn("window:openSettings", () => {
    if (windowManager.hasWindow("Settings")) {
      windowManager.getWindow("Settings").showAndFocus();
      return;
    }

    const mainWindowBounds = mainWindow._getElectronWindow().getBounds();
    const settingsWindow = windowManager.createWindow("Browser", {
      name: "Settings",
      autoRecreate: false,
      waitForViews: true,
      url: resolveAppWindowUrl("settings", "/windows/settings/index.html"),
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
          height: 36,
        },
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: path.join(
            __dirname,
            `../preload/windows/settings/preload.cjs`,
          ),
          devTools: !app.isPackaged
            ? true
            : configStore.get("developer.enableDevTools"),
        },
      },
    });
    settingsWindow.setWindowOpenHandler((details) => {
      if (
        details.url === "https://github.com/ytmdesktop/ytmdesktop" ||
        details.url === "https://ytmdesktop.github.io/"
      ) {
        shell.openExternal(details.url);
      }

      return {
        action: "deny",
      };
    });
  });

  mainWindow.ipcOn("window:openMiniplayer", () => {
    if (windowManager.hasWindow("Miniplayer")) {
      windowManager.getWindow("Miniplayer").showAndFocus();
      return;
    }

    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    const windowBounds = configStore.get("state.miniplayerWindowBounds");

    const mainWindowBounds = mainWindow._getElectronWindow().getBounds();
    const miniplayerWindow = windowManager.createWindow("Browser", {
      name: "Miniplayer",
      autoRecreate: false,
      waitForViews: true,
      url: resolveAppWindowUrl("miniplayer", "/windows/miniplayer/index.html"),
      electronOptions: {
        width: windowBounds?.width ?? 600 / scaleFactor,
        height: windowBounds?.height ?? 400 / scaleFactor,
        minWidth: 240,
        minHeight: 240,
        x:
          windowBounds?.x ??
          Math.round(mainWindowBounds.x + (mainWindowBounds.width / 2 - 400)),
        y:
          windowBounds?.y ??
          Math.round(mainWindowBounds.y + (mainWindowBounds.height / 2 - 300)),
        minimizable: false,
        maximizable: false,
        frame: false,
        show: false,
        icon: getIconPath("ytmd.png"),
        titleBarStyle: "hidden",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: path.join(
            __dirname,
            `../preload/windows/miniplayer/preload.cjs`,
          ),
          devTools: !app.isPackaged
            ? true
            : configStore.get("developer.enableDevTools"),
        },
      },
    });
    // On mac and windows `pop-up-menu` will keep the miniplayer above the dock or taskbar
    miniplayerWindow._getElectronWindow().setAlwaysOnTop(true, "pop-up-menu");
    miniplayerWindow.on("electronwindow-will-resize", () => {
      const playerState = playerStateStore.getState();
      if (playerState.videoDetails?.videoType === VideoType.MusicVideo) {
        miniplayerWindow.setAspectRatio(16 / 9);
      } else if (playerState.videoDetails?.videoType === VideoType.MusicAudio) {
        miniplayerWindow.setAspectRatio(1);
      }
    });
    miniplayerWindow.on("electronwindow-resize", () => {
      stateManager.updateState({
        miniplayerWindowBounds: miniplayerWindow
          ._getElectronWindow()
          .getBounds(),
      });
    });
    miniplayerWindow.on("electronwindow-move", () => {
      stateManager.updateState({
        miniplayerWindowBounds: miniplayerWindow
          ._getElectronWindow()
          .getBounds(),
      });
    });

    miniplayerWindow.once("electronwindow-close", () => {
      stateManager.updateState({
        miniplayerWindowBounds: miniplayerWindow
          ._getElectronWindow()
          .getBounds(),
      });
      mainWindow.showAndFocus();
    });

    miniplayerWindow.ipcOn(
      "remoteControl:execute",
      (event, command: string, ...args: unknown[]) => {
        const remoteControlApi = serviceHost
          .getService(ProtectedAPIManager)
          .createOrGetAPI("RemoteControl");
        remoteControlApi.postMessage("execute", command, ...args);
      },
    );

    miniplayerWindow.ipcHandle("playerStateStore:getState", () => {
      const playerStateStore = serviceHost.getService(PlayerStateStore);
      return playerStateStore.getState();
    });

    miniplayerWindow.ipcHandle(LISTEN_TOGETHER_IPC.getState, () => {
      return listenTogetherService.getUIState();
    });

    mainWindow.hide();
  });

  mainWindow.ipcOn("ytmView:navigateDefault", () => {
    const ytmView = ytmViewManager.getView();
    if (ytmView) ytmView.webContents?.loadURL("https://music.youtube.com/");
  });
  //#endregion

  // Late updater window closure to prevent Electron from emitting window-all-closed before creating the main window
  updaterWindow.destroyWindow();

  //#region Tray creation
  function trayIconFileName(style: TrayIconStyle) {
    if (process.platform === "win32") return "tray.ico";
    if (process.platform === "darwin") return "trayTemplate.png";

    let color: "white" | "black";
    if (style === TrayIconStyle.White) {
      color = "white";
    } else if (style === TrayIconStyle.Black) {
      color = "black";
    } else {
      color = nativeTheme.shouldUseDarkColors ? "white" : "black";
    }
    return `ytmd_${color}.png`;
  }

  function getTrayIconPath() {
    const style = configStore.get("appearance").trayIconStyle;
    const iconsDir = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), "src/assets/icons");
    return path.join(iconsDir, trayIconFileName(style));
  }

  function setTrayIcon() {
    tray.setImage(getTrayIconPath());
  }

  tray = new Tray(getTrayIconPath());
  trayContextMenu = Menu.buildFromTemplate([
    {
      label: "YTMDesktop",
      type: "normal",
      enabled: false,
    },
    {
      type: "separator",
    },
    {
      label: "Show/Hide Window",
      type: "normal",
      click: () => {
        if (windowManager.hasWindow("Miniplayer")) {
          windowManager.getWindow("Miniplayer").closeWindow();
          // Closing the miniplayer automatically shows and focuses the mainWindow so we don't need to continue
          return;
        }

        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.showAndFocus();
        }
      },
    },
    {
      label: "Play/Pause",
      type: "normal",
      click: async () => {
        const remoteControlApi = serviceHost
          .getService(ProtectedAPIManager)
          .createOrGetAPI("RemoteControl");
        remoteControlApi.postMessage("execute", "playPause");
      },
    },
    {
      label: "Previous",
      type: "normal",
      click: async () => {
        const remoteControlApi = serviceHost
          .getService(ProtectedAPIManager)
          .createOrGetAPI("RemoteControl");
        remoteControlApi.postMessage("execute", "previous");
      },
    },
    {
      label: "Next",
      type: "normal",
      click: async () => {
        const remoteControlApi = serviceHost
          .getService(ProtectedAPIManager)
          .createOrGetAPI("RemoteControl");
        remoteControlApi.postMessage("execute", "next");
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      type: "normal",
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setToolTip("YTMDesktop");
  tray.setContextMenu(trayContextMenu);
  tray.on("click", () => {
    mainWindow.showAndFocus();
  });

  nativeTheme.on("updated", setTrayIcon);

  log.info("Created tray icon");
  //#endregion

  // Wait for the main window to be ready
  await mainWindow.ready();

  // Attach events for the ytmviewmanager
  ytmViewManager.on("status-changed", async () => {
    mainView.webContents?.send("ytmView:statusChanged", ytmViewManager.status);
    if (ytmViewManager.status === YTMViewStatus.Ready) {
      await mainView.hide(true);
      if (ytmViewManager.hasError()) {
        const hookError = ytmViewManager.getError();
        const setupFlags = ytmViewManager.getSetupFlags();
        const setupFlagNames = YTMViewSetupCompletionFlagsNames.filter(
          (key) => key != "LocationNotApplicable",
        );
        const setFlags = setupFlagNames.filter(
          (key) => (setupFlags & YTMViewSetupCompletionFlags[key]) !== 0,
        );
        const unsetFlags = setupFlagNames.filter(
          (key) => (setupFlags & YTMViewSetupCompletionFlags[key]) === 0,
        );

        const dialogMessage =
          `Features from YTMDesktop may not be present or function correctly\n\nThis usually means there's a bug and a bug report should be filed on the GitHub\n\nHook log:\n${setFlags.map((flag) => `    ${flag}... OK\n`).join("")}${unsetFlags.map((flag) => `    ${flag}... FAIL\n`).join("")}\n` +
          `${hookError?.stack}`;
        dialog
          .showMessageBox({
            title: "Hook Error",
            message: "YTMDesktop could not hook YouTube Music",
            detail: dialogMessage,
            type: "warning",
            buttons: ["Copy to Clipboard and I understand", "I understand"],
          })
          .then((result) => {
            if (result.response === 0) {
              clipboard.writeText(`${dialogMessage}`);
            }
          });
      }
    } else {
      await mainView.show(true);
    }
  });
  function syncAllowedBinderWebContentsId(reason: "created" | "recreated") {
    const webContentsId = ytmViewManager.getView()?.webContents?.id ?? null;
    if (webContentsId === null) {
      log.warn(
        `protectedapi: ytmView ${reason} without a webContents ID; binder remains restricted`,
      );
    }
    protectedApiManager.setAllowedBinderWebContentsId(webContentsId);
  }

  const bindYtmViewFullscreenListeners = (view: AppView | undefined) => {
    if (!view) return;
    view.on("webcontents-enter-html-full-screen", () => {
      inHtmlFullscreen = true;
      syncListenTogetherLayout();
    });
    view.on("webcontents-leave-html-full-screen", () => {
      inHtmlFullscreen = false;
      syncListenTogetherLayout();
    });
  };

  ytmViewManager.on("view-recreated", async () => {
    syncAllowedBinderWebContentsId("recreated");
    inHtmlFullscreen = false;
    bindYtmViewFullscreenListeners(ytmViewManager.getView());
    syncListenTogetherLayout();
    await mainView.show(true);
  });
  ytmViewManager.on("unresponsive", async () => {
    await mainView.show(true);
  });
  ytmViewManager.on("responsive", async () => {
    await mainView.hide(true);
  });
  ytmViewManager.on("load-errored", () => {
    mainView.webContents?.send("ytmView:loadError", ytmViewManager.loadError);
  });

  const coldStartArgUrl = extractYtmdProtocolUrl(process.argv);
  const coldStartUrls = [
    ...pendingEarlyProtocolUrls.splice(0),
    ...(coldStartArgUrl ? [coldStartArgUrl] : []),
  ];
  if (coldStartUrls.some((url) => isListenInviteProtocolUrl(url))) {
    memoryStore.set("listenTogetherPendingColdStart", true);
    log.info(
      "Cold-start Listen Together invite detected; setting listenTogetherPendingColdStart",
      { count: coldStartUrls.length },
    );
  }

  // Initially create the YTM view and attach it
  ytmViewManager.createView();
  const ytmView = ytmViewManager.getView();
  syncAllowedBinderWebContentsId("created");
  if (ytmView) mainWindow.attachView(ytmView, 0);
  bindYtmViewFullscreenListeners(ytmView);

  mainWindow.attachView(listenTogetherView);
  syncListenTogetherAuthorizedSenders();
  syncListenTogetherLayout();

  if (process.env.YTMD_E2E_MODE === "1") {
    (globalThis as any).__ytmdE2E = {
      serviceHost,
      listenTogetherService,
      mainWindow,
      listenTogetherView,
      ytmViewManager,
    };
  }

  if (coldStartUrls.length > 0) {
    log.info("Dispatching cold-start ytmd:// protocol URLs", {
      urls: coldStartUrls.map((u) => redactInviteUrl(redactLogUrl(u))),
    });
    const protocolManager = serviceHost.getService(ProtocolManager);
    for (const url of coldStartUrls) {
      void protocolManager.handleYTMDProtocol(url);
    }
  }

  // This hides the main view if it was recreated and the YTMView is in a ready state
  await mainView.on("recreated", async () => {
    await ytmViewManager.ready();
    await mainView.hide(true);
  });

  integrationManager.runHook(IntegrationManagerHook.AppReady);

  // Record current app version without fetching upstream changelog
  if (configStore.get("metadata.appVersion") !== app.getVersion()) {
    configStore.set("metadata.appVersion", app.getVersion());
  }
});

app.on("open-url", (event, url) => {
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > MAX_YTMD_PROTOCOL_URL_LENGTH ||
    !url.toLowerCase().startsWith("ytmd://")
  ) {
    return;
  }

  event.preventDefault();
  const safeUrl = redactInviteUrl(redactLogUrl(url));
  if (serviceHost.initialized && ytmViewManagerReadyForProtocol()) {
    log.info("Handling open-url ytmd:// protocol link", { url: safeUrl });
    void serviceHost.getService(ProtocolManager).handleYTMDProtocol(url);
  } else {
    log.info("Queued early open-url ytmd:// protocol link before startup", {
      url: safeUrl,
    });
    pendingEarlyProtocolUrls.push(url);
  }
});

function ytmViewManagerReadyForProtocol(): boolean {
  try {
    return serviceHost.getService(YTMViewManager).getView() !== undefined;
  } catch {
    return false;
  }
}

// @ts-expect-error powerMonitor doesn't have the correct type here
powerMonitor.on("shutdown", (event: Electron.Event) => {
  event.preventDefault();
  const stateManager = serviceHost.getService(StateManager);
  stateManager.forceWrite();
  app.quit();
});
app.on("before-quit", () => {
  log.debug("Application going to quit");

  const windowManager = serviceHost.getService(AppWindowManager);
  windowManager.forceWindowClosures();
});
app.on("quit", () => {
  log.debug("Application quit");

  // At this stage the next lifecycle is Terminated
  serviceHost.runNextLifecycle();
});
