import Conf from "conf";
import { OnDidAnyChangeCallback, OnDidChangeCallback } from "conf/dist/source/types";
import { app, ipcMain } from "electron";
import log from "electron-log";
import { StoreSchema, TrayIconStyle } from "~shared/store/schema";
import { DependencyConstructor, Paths, ValueAtPath } from "~shared/types";
import Service from "../service";
import AppWindowManager from "../windowmanager";

export default class ConfigStore extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [AppWindowManager];

  private conf: Conf<StoreSchema>;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public override onPreInitialized() {
    this.conf = new Conf<StoreSchema>({
      configName: "config",
      cwd: app.getPath("userData"),
      projectVersion: app.getVersion(),
      watch: true,
      defaults: {
        metadata: {
          version: 1
        },
        general: {
          disableHardwareAcceleration: false,
          hideToTrayOnClose: false,
          showNotificationOnSongChange: false,
          startOnBoot: false,
          startMinimized: false
        },
        appearance: {
          alwaysShowVolumeSlider: false,
          customCSSEnabled: false,
          customCSSPath: null,
          zoom: 100,
          trayIconStyle: TrayIconStyle.Auto
        },
        playback: {
          continueWhereYouLeftOff: true,
          continueWhereYouLeftOffPaused: true,
          enableSpeakerFill: false,
          progressInTaskbar: false,
          ratioVolume: false
        },
        integrations: {
          companionServerEnabled: false,
          companionServerAuthTokens: null,
          companionServerCORSWildcardEnabled: true,
          discordPresenceEnabled: false,
          lastFMEnabled: false,
          enhancedMediaServiceEnabled: true
        },
        shortcuts: {
          playPause: "",
          next: "",
          previous: "",
          thumbsUp: "",
          thumbsDown: "",
          volumeUp: "",
          volumeDown: "",
          volumeMute: "",
          toggleShuffle: "",
          toggleRepeat: ""
        },
        state: {
          lastUrl: "https://music.youtube.com/",
          lastPlaylistId: "",
          lastVideoId: "",
          windowBounds: null,
          windowMaximized: false,
          miniplayerWindowBounds: null
        },
        lastfm: {
          // Last FM Keys belong to @Alipoodle
          api_key: "2a69bcf769a7a28a8bf2f6a5100accad",
          secret: "46eea23770a459a49eb4d26cbf46b41c",
          token: null,
          sessionKey: null,
          scrobblePercent: 50
        },
        developer: {
          enableDevTools: false
        }
      },
      beforeEachMigration: (store, context) => {
        log.info(`Performing store migration from ${context.fromVersion} to ${context.toVersion}`);
      },
      migrations: {
        ">=2.0.0": store => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          store.delete("integrations.companionServerAuthWindowEnabled");
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          store.delete("state.companionServerAuthWindowEnableTime");
          if (!store.has("appearance.zoom")) {
            store.set("appearance.zoom", 100);
          }
        },
        ">=2.0.1": store => {
          if (!store.has("lastfm.scrobblePercent")) {
            store.set("lastfm.scrobblePercent", 50);
          }
        },
        ">=2.0.7": store => {
          if (!store.has("appearance.trayIconStyle")) {
            store.set("appearance.trayIconStyle", 0);
          }
        },
        ">=2.1.0": store => {
          if (!store.has("shortcuts.volumeMute")) {
            store.set("shortcuts.volumeMute", "");
          }

          if (!store.has("shortcuts.toggleShuffle")) {
            store.set("shortcuts.toggleShuffle", "");
          }

          if (!store.has("shortcuts.toggleRepeat")) {
            store.set("shortcuts.toggleRepeat", "");
          }

          if (!store.has("integrations.enhancedMediaServiceEnabled")) {
            store.set("integrations.enhancedMediaServiceEnabled", true);
          }

          if (!store.has("state.miniplayerWindowBounds")) {
            store.set("state.miniplayerWindowBounds", null);
          }
        }
      }
    });

    if (this.conf.get("general.disableHardwareAcceleration")) {
      app.disableHardwareAcceleration();
      log.info("Hardware acceleration disabled");
    }
    if (this.conf.get("playback.enableSpeakerFill")) {
      app.commandLine.appendSwitch("try-supported-channel-layouts");
      log.info("Speaker fill enabled");
    }
  }

  public override onInitialized() {
    if (this._initialized) throw new Error("ConfigStore is already initialized!");
    this._initialized = true;

    const windowManager = this.getDependency(AppWindowManager);
    this.conf.onDidAnyChange((newState, oldState) => {
      for (const window of windowManager.getWindows()) {
        window.ipcBroadcast("configStore:stateChanged", newState, oldState);
      }

      this.reconcileConfig(newState, oldState);
    });

    ipcMain.handle("configStore:get", (_event, key) => {
      return this.get(key);
    });

    ipcMain.on("configStore:set", (_event, key, value) => {
      return this.set(key, value);
    });

    log.info("ConfigStore initialized");
  }

  public override onPostInitialized() {}

  public override onTerminated() {}

  public get<Key extends Paths<StoreSchema>>(key: Key, defaultValue?: ValueAtPath<StoreSchema, Key>): ValueAtPath<StoreSchema, Key> {
    return this.conf.get(key as string, defaultValue);
  }

  public set<Key extends Paths<StoreSchema>>(key: Key, value?: ValueAtPath<StoreSchema, Key>) {
    return this.conf.set(key as string, value);
  }

  public onDidChange<Key extends keyof StoreSchema>(key: Key, callback: OnDidChangeCallback<StoreSchema[Key]>) {
    return this.conf.onDidChange(key, callback);
  }

  public onDidAnyChange(callback: OnDidAnyChangeCallback<StoreSchema>) {
    return this.conf.onDidAnyChange(callback);
  }

  // TODO: This should probably be moved somewhere else as this isn't the job of the config store
  private reconcileConfig(newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>) {
    if (newState.general.startOnBoot != oldState.general.startOnBoot) {
      app.setLoginItemSettings({
        openAtLogin: newState.general.startOnBoot
      });
    }
  }
}
