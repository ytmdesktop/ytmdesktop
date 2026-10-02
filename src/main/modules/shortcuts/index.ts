import { BrowserView, globalShortcut } from "electron";
import log from "electron-log";
import mmodules from "../module";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import ShortcutDefinitions, { ShortcutId } from "./shortcuts";
import Conf from "conf";

/**
 * Shortcut Module
 * Registers the shortcuts used for the application.
 * Requires multiple dependencies through {@link provide} before shortcuts are be registered
 * @author Akiisqt <aki@devours.rocks>
 */
export class Shortcuts implements mmodules {
  /** ConfigStore for the application, assigned by {@link provide} */
  private configStore!: Conf<StoreSchema>;

  /** MemoryStore for the application, assigned by {@link provide} */
  private memoryStore!: MemoryStore<MemoryStoreSchema>;

  /** Browser view for the application, assigned by {@link provide} */
  private ytmView!: BrowserView;

  /**
   * Checks whether any shortcut has changed, and if so, reregisters the shortcuts.
   * @param newState - The lastest store state
   * @param oldState - The previous store state
   */
  public anyShortcutChanged(newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>): void {
    for (const definition of ShortcutDefinitions.all) {
      if (newState.shortcuts[definition.id] !== oldState.shortcuts[definition.id]) {
        this.registerAll();
        break;
      }
    }
  }

  /**
   * Registers all the global shortcuts.
   */
  public registerAll(): void {
    globalShortcut.unregisterAll();
    log.info("Unregistered shortcuts");
    log.info("Registering shortcuts");

    const shortcuts = this.configStore.get("shortcuts");
    const webContents = this.ytmView.webContents; // deprecated
    const memoryStore = this.memoryStore;

    for (const definition of ShortcutDefinitions.all) {
      const accelerator = shortcuts[definition.id];
      let success: boolean = false;

      if (!accelerator) {
        success = true;
      } else {
        try {
          success = globalShortcut.register(accelerator, () => {
            webContents.send("remoteControl:execute", definition.command);
          });
        } catch (error) {
          log.warn(error);
        }
      }

      if (!success) {
        memoryStore.set(definition.key, true);
        log.info(`Failed to register shortcut ${definition.id}`);
        continue;
      }

      memoryStore.set(definition.key, false);
      log.info(`Registered shortcut ${definition.id}`);
    }

    log.info("Registered All Shortcuts");
  }

  /**
   * Initializes the module, unused for this module.
   */
  public initialize(): void {}

  /**
   * Provides the dependencies for this module.
   * @param configStore - ConfigStore for the application
   * @param memoryStore - MemoryStore for the application
   * @param ytmView - Browser view for the application
   */
  public provide(configStore: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: BrowserView): void {
    this.configStore = configStore;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  /**
   * Stops the module and cleans up global shortcuts.
   */
  public terminate(): void {
    globalShortcut.unregisterAll();
    log.info("Unregistered shortcuts");
    log.info("Terminated shortcuts");
  }
}

/** Hacky way to access the old configuration for shortcuts */
type V1Config = {
  "settings-accelerators"?: Record<ShortcutId, string>;
};

/**
 * Imports old shortcut settings from version 1.
 * @param v1Config - Configuration object from verson 1
 * @param confStore - ConfigStore for the application
 */
export function importV1Shortcuts(v1Config: V1Config, confStore: Conf<StoreSchema>): void {
  const oldAccelerators = v1Config ? ["settings-accelerators"] : false;
  if (!oldAccelerators) return;

  for (const definition of ShortcutDefinitions.all) {
    // @ts-expect-error cannot figure out why this won't type correctly...
    const oldValue = oldAccelerators[definition.v1Name];

    if (!oldValue || typeof oldValue !== "string") continue;
    if (oldValue && oldValue.toLowerCase() == "disabled") continue;

    confStore.set(`shortcuts.${definition.id}`, oldValue);
  }
}
