import { BasePlugin, PluginSettings } from "../../base-plugin";
import log from "electron-log";

interface CustomShortcut {
  id: string;
  key: string;
  action: string;
  enabled: boolean;
}

export class KeyboardShortcutsPlugin extends BasePlugin {
  private customShortcuts: CustomShortcut[] = [];
  private registeredShortcuts: Map<string, () => void> = new Map();

  constructor() {
    super({
      id: "keyboard-shortcuts",
      name: "Custom Keyboard Shortcuts",
      description: "Add custom keyboard shortcuts for various actions",
      version: "1.0.0",
      author: "YTMDesktop Team",
      enabled: false,
      settings: {
        enableGlobalShortcuts: true,
        shortcuts: []
      }
    });
  }

  onEnable(): void {
    log.debug("Keyboard Shortcuts Plugin enabled");
    this.loadCustomShortcuts();
    this.registerShortcuts();
  }

  onDisable(): void {
    log.debug("Keyboard Shortcuts Plugin disabled");
    this.unregisterShortcuts();
  }

  onSettingsChanged(newSettings: Record<string, unknown>): void {
    log.debug("Keyboard Shortcuts settings changed:", newSettings);

    if (newSettings.shortcuts !== undefined) {
      this.unregisterShortcuts();
      this.loadCustomShortcuts();
      this.registerShortcuts();
    }
  }

  private loadCustomShortcuts(): void {
    const rawShortcuts = this.settings.shortcuts;
    if (Array.isArray(rawShortcuts)) {
      this.customShortcuts = rawShortcuts as CustomShortcut[];
    } else if (typeof rawShortcuts === "string") {
      try {
        const parsed = JSON.parse(rawShortcuts);
        this.customShortcuts = Array.isArray(parsed) ? (parsed as CustomShortcut[]) : [];
      } catch {
        this.customShortcuts = [];
      }
    } else {
      this.customShortcuts = [];
    }
  }

  private registerShortcuts(): void {
    for (const shortcut of this.customShortcuts) {
      if (shortcut.enabled) {
        this.registerShortcut(shortcut);
      }
    }
  }

  private unregisterShortcuts(): void {
    this.registeredShortcuts.clear();
  }

  private registerShortcut(shortcut: CustomShortcut): void {
    const handler = () => this.executeAction(shortcut.action);

    // In a real implementation, you'd register with the OS
    // For now, we'll just store the handler
    this.registeredShortcuts.set(shortcut.id, handler);

    log.debug(`Registered shortcut: ${shortcut.key} -> ${shortcut.action}`);
  }

  private executeAction(action: string): void {
    switch (action) {
      case "toggle-playlist":
        this.togglePlaylist();
        break;
      case "shuffle-playlist":
        this.shufflePlaylist();
        break;
      case "toggle-repeat":
        this.toggleRepeat();
        break;
      case "toggle-mute":
        this.toggleMute();
        break;
      case "skip-30-seconds":
        this.skipSeconds(30);
        break;
      case "rewind-10-seconds":
        this.skipSeconds(-10);
        break;
      default:
        log.warn(`Unknown action: ${action}`);
    }
  }

  // Action implementations
  private togglePlaylist(): void {
    log.debug("Toggling playlist visibility");
    // Implementation would interact with the main app
  }

  private shufflePlaylist(): void {
    log.debug("Shuffling playlist");
    // Implementation would interact with the main app
  }

  private toggleRepeat(): void {
    log.debug("Toggling repeat mode");
    // Implementation would interact with the main app
  }

  private toggleMute(): void {
    log.debug("Toggling mute");
    // Implementation would interact with the main app
  }

  private skipSeconds(seconds: number): void {
    log.debug(`Skipping ${seconds} seconds`);
    // Implementation would interact with the main app
  }

  // Public methods for managing shortcuts
  addShortcut(shortcut: CustomShortcut): void {
    this.customShortcuts.push(shortcut);
    this.persistSettings();

    if (shortcut.enabled) {
      this.registerShortcut(shortcut);
    }
  }

  removeShortcut(shortcutId: string): void {
    const index = this.customShortcuts.findIndex(s => s.id === shortcutId);
    if (index !== -1) {
      this.customShortcuts.splice(index, 1);
      this.registeredShortcuts.delete(shortcutId);
      this.persistSettings();
    }
  }

  private persistSettings(): void {
    this.updateSettings({
      shortcuts: this.customShortcuts
    });
  }

  static getSettingsSchema(): PluginSettings {
    return {
      enableGlobalShortcuts: {
        type: "boolean",
        label: "Enable Global Shortcuts",
        description: "Allow shortcuts to work even when app is not focused",
        default: true
      },
      shortcuts: {
        type: "string",
        label: "Custom Shortcuts",
        description: "JSON array of custom shortcuts (advanced)",
        default: "[]"
      }
    };
  }
}
