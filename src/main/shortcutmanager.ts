import { globalShortcut } from "electron";
import configStore from "./config-store";
import log from "electron-log";
import ytmviewmanager from "./ytmviewmanager";
import memoryStore from "./memory-store";
import Manager from "./manager";

class ShortcutManager implements Manager {
  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public initialize() {
    if (this._initialized) throw new Error("ShortcutManager is already initialized!");
    this._initialized = true;

    this.reconcileShortcuts();
    configStore.onDidChange("shortcuts", () => {
      this.reconcileShortcuts();
    });

    log.info("ShortcutManager initialized");
  }

  public reconcileShortcuts() {
    const shortcuts = configStore.get("shortcuts");

    globalShortcut.unregisterAll();
    log.info("Unregistered shortcuts");

    if (shortcuts.playPause) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.playPause, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "playPause");
        });
      } catch {
        /* ignored */
      }

      if (!registered) {
        log.info("Failed to register shortcut: playPause");
        memoryStore.set("shortcutsPlayPauseRegisterFailed", true);
      } else {
        log.info("Registered shortcut: playPause");
        memoryStore.set("shortcutsPlayPauseRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsPlayPauseRegisterFailed", false);
    }

    if (shortcuts.next) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.next, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "next");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: next");
        memoryStore.set("shortcutsNextRegisterFailed", true);
      } else {
        log.info("Registered shortcut: next");
        memoryStore.set("shortcutsNextRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsNextRegisterFailed", false);
    }

    if (shortcuts.previous) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.previous, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "previous");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: previous");
        memoryStore.set("shortcutsPreviousRegisterFailed", true);
      } else {
        log.info("Registered shortcut: previous");
        memoryStore.set("shortcutsPreviousRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsPreviousRegisterFailed", false);
    }

    if (shortcuts.thumbsUp) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.thumbsUp, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "toggleLike");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: thumbsUp");
        memoryStore.set("shortcutsThumbsUpRegisterFailed", true);
      } else {
        log.info("Registered shortcut: thumbsUp");
        memoryStore.set("shortcutsThumbsUpRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsThumbsUpRegisterFailed", false);
    }

    if (shortcuts.thumbsDown) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.thumbsDown, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "toggleDislike");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: thumbsDown");
        memoryStore.set("shortcutsThumbsDownRegisterFailed", true);
      } else {
        log.info("Registered shortcut: thumbsDown");
        memoryStore.set("shortcutsThumbsDownRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsThumbsDownRegisterFailed", false);
    }

    if (shortcuts.volumeUp) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.volumeUp, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "volumeUp");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: volumeUp");
        memoryStore.set("shortcutsVolumeUpRegisterFailed", true);
      } else {
        log.info("Registered shortcut: volumeUp");
        memoryStore.set("shortcutsVolumeUpRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsVolumeUpRegisterFailed", false);
    }

    if (shortcuts.volumeDown) {
      let registered = false;
      try {
        registered = globalShortcut.register(shortcuts.volumeDown, async () => {
          await ytmviewmanager.ready();
          ytmviewmanager.getView().webContents.send("remoteControl:execute", "volumeDown");
        });
      } catch {
        /* empty */
      }

      if (!registered) {
        log.info("Failed to register shortcut: volumeDown");
        memoryStore.set("shortcutsVolumeDownRegisterFailed", true);
      } else {
        log.info("Registered shortcut: volumeDown");
        memoryStore.set("shortcutsVolumeDownRegisterFailed", false);
      }
    } else {
      memoryStore.set("shortcutsVolumeDownRegisterFailed", false);
    }

    log.info("Registered shortcuts");
  }
}

export default new ShortcutManager();
