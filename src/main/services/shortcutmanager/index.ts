import { globalShortcut } from "electron";
import log from "electron-log";
import Service from "../service";
import ConfigStore from "../configstore";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import YTMViewManager from "../ytmviewmanager";
import { DependencyConstructor, Paths } from "~shared/types";
import MemoryStore from "../memorystore";

export default class ShortcutManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [ConfigStore, YTMViewManager, MemoryStore<MemoryStoreSchema>];

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public override onPreInitialized(): void {}
  public onInitialized() {
    if (this._initialized) throw new Error("ShortcutManager is already initialized!");
    this._initialized = true;

    log.info("ShortcutManager initialized");
  }
  public override onPostInitialized(): void {
    const configStore = this.getDependency(ConfigStore);
    configStore.onDidChange("shortcuts", shortcuts => {
      this.reconcileShortcuts(shortcuts);
    });

    this.reconcileShortcuts();
  }
  public override onTerminated(): void {}

  public reconcileShortcuts(state?: StoreSchema["shortcuts"]) {
    let shortcuts = state;
    if (!state) {
      const configStore = this.getDependency(ConfigStore);
      shortcuts = configStore.get("shortcuts");
    }

    globalShortcut.unregisterAll();
    log.info("Unregistered shortcuts");

    const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);

    if (shortcuts.playPause) {
      this.tryRegisterShortcut(shortcuts.playPause, "playPause", "shortcutsPlayPauseRegisterFailed");
    } else {
      memoryStore.set("shortcutsPlayPauseRegisterFailed", false);
    }

    if (shortcuts.next) {
      this.tryRegisterShortcut(shortcuts.next, "next", "shortcutsNextRegisterFailed");
    } else {
      memoryStore.set("shortcutsNextRegisterFailed", false);
    }

    if (shortcuts.previous) {
      this.tryRegisterShortcut(shortcuts.previous, "previous", "shortcutsPreviousRegisterFailed");
    } else {
      memoryStore.set("shortcutsPreviousRegisterFailed", false);
    }

    if (shortcuts.thumbsUp) {
      this.tryRegisterShortcut(shortcuts.thumbsUp, "toggleLike", "shortcutsThumbsUpRegisterFailed");
    } else {
      memoryStore.set("shortcutsThumbsUpRegisterFailed", false);
    }

    if (shortcuts.thumbsDown) {
      this.tryRegisterShortcut(shortcuts.thumbsDown, "toggleDislike", "shortcutsThumbsDownRegisterFailed");
    } else {
      memoryStore.set("shortcutsThumbsDownRegisterFailed", false);
    }

    if (shortcuts.volumeUp) {
      this.tryRegisterShortcut(shortcuts.volumeUp, "volumeUp", "shortcutsVolumeUpRegisterFailed");
    } else {
      memoryStore.set("shortcutsVolumeUpRegisterFailed", false);
    }

    if (shortcuts.volumeDown) {
      this.tryRegisterShortcut(shortcuts.volumeDown, "volumeDown", "shortcutsVolumeDownRegisterFailed");
    } else {
      memoryStore.set("shortcutsVolumeDownRegisterFailed", false);
    }

    if (shortcuts.volumeMute) {
      this.tryRegisterShortcut(shortcuts.volumeMute, "toggleMute", "shortcutsVolumeMuteRegisterFailed");
    } else {
      memoryStore.set("shortcutsVolumeMuteRegisterFailed", false);
    }

    if (shortcuts.toggleShuffle) {
      this.tryRegisterShortcut(shortcuts.toggleShuffle, "shuffle", "shortcutsToggleShuffleRegisterFailed");
    } else {
      memoryStore.set("shortcutsToggleShuffleRegisterFailed", false);
    }

    if (shortcuts.toggleRepeat) {
      this.tryRegisterShortcut(shortcuts.toggleRepeat, "cycleRepeatMode", "shortcutsToggleRepeatRegisterFailed");
    } else {
      memoryStore.set("shortcutsToggleRepeatRegisterFailed", false);
    }

    log.info("Registered shortcuts");
  }

  private tryRegisterShortcut(accelerator: string, remoteControl: string, failFlag: Paths<MemoryStoreSchema>) {
    const ytmViewManager = this.getDependency(YTMViewManager);
    const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);

    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, async () => {
        await ytmViewManager.ready();
        ytmViewManager.getView().webContents.send("remoteControl:execute", remoteControl);
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info(`Failed to register shortcut: ${remoteControl}`);
      memoryStore.set(failFlag, true);
    } else {
      log.info(`Registered shortcut: ${remoteControl}`);
      memoryStore.set(failFlag, false);
    }
  }
}
