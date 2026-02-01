import { BasePlugin, PluginSettings } from "./base-plugin";
import { NotificationEnhancerPlugin } from "./builtin/notification-enhancer";
import { CustomThemesPlugin } from "./builtin/custom-themes";
import { KeyboardShortcutsPlugin } from "./builtin/keyboard-shortcuts";
import { VinylPlayerPlugin } from "./builtin/vinyl-player";
import { NotionSyncPlugin } from "./builtin/notion-sync";
import { SixKLabsWidgetPlugin } from "./builtin/6klabs-widget";
import Conf from "conf";
import { app } from "electron";
import log from "electron-log";

type PluginStoreSchema = Record<string, { enabled?: boolean; settings: Record<string, unknown> }>;

export class PluginManager {
  private plugins: Map<string, BasePlugin> = new Map();
  private enabledPlugins: Set<string> = new Set();
  private _pluginStore: Conf<PluginStoreSchema> | null = null;

  constructor() {
    this.registerBuiltinPlugins();
  }

  /**
   * Initialize the plugin store and load persisted settings. Call this after app.whenReady()
   * so app.getPath("userData") is safe.
   */
  init(): void {
    if (this._pluginStore !== null) return;
    this._pluginStore = new Conf<PluginStoreSchema>({
      configName: "plugins",
      cwd: app.getPath("userData")
    });
    this.loadPluginSettings();
    this.autoEnablePlugins();
  }

  private get pluginStore(): Conf<PluginStoreSchema> {
    if (this._pluginStore === null) {
      throw new Error("PluginManager not initialized; call init() after app.whenReady()");
    }
    return this._pluginStore;
  }

  private registerBuiltinPlugins(): void {
    // Register built-in plugins
    this.registerPlugin(new NotificationEnhancerPlugin());
    this.registerPlugin(new CustomThemesPlugin());
    this.registerPlugin(new KeyboardShortcutsPlugin());
    this.registerPlugin(new VinylPlayerPlugin());
    this.registerPlugin(new NotionSyncPlugin());
    this.registerPlugin(new SixKLabsWidgetPlugin());
  }

  private loadPluginSettings(): void {
    // Load saved settings and enabled state for all plugins
    this.plugins.forEach(plugin => {
      const savedData = this.pluginStore.get(plugin.id) as { enabled?: boolean; settings?: Record<string, unknown> } | undefined;

      if (savedData) {
        // Load enabled state if available
        if (savedData.enabled !== undefined) {
          plugin.setEnabled(savedData.enabled);
        }

        // Load settings if available
        if (savedData.settings) {
          plugin.updateSettings(savedData.settings);
        }
      }
    });
  }

  private autoEnablePlugins(): void {
    // Auto-enable plugins that were previously enabled (after settings are loaded)
    this.plugins.forEach(plugin => {
      if (plugin.enabled) {
        this.enablePlugin(plugin.id);
      }
    });
  }

  private savePluginSettings(pluginId: string, settings: Record<string, unknown>): void {
    // Get existing data to preserve enabled state
    const existingData = this.pluginStore.get(pluginId) as { enabled?: boolean; settings?: Record<string, unknown> } | undefined;
    this.pluginStore.set(pluginId, {
      enabled: existingData?.enabled,
      settings
    });
  }

  private savePluginEnabled(pluginId: string, enabled: boolean): void {
    // Get existing data to preserve settings
    const existingData = this.pluginStore.get(pluginId) as { enabled?: boolean; settings?: Record<string, unknown> } | undefined;
    this.pluginStore.set(pluginId, {
      enabled,
      settings: existingData?.settings || {}
    });
  }

  registerPlugin(plugin: BasePlugin): void {
    this.plugins.set(plugin.id, plugin);

    // Don't auto-enable here - it will be done after settings are loaded
  }

  unregisterPlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      this.disablePlugin(pluginId);
      this.plugins.delete(pluginId);
    }
  }

  enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.warn(`Plugin ${pluginId} not found`);
      return false;
    }

    if (this.enabledPlugins.has(pluginId)) {
      console.warn(`Plugin ${pluginId} is already enabled`);
      return false;
    }

    try {
      plugin.onEnable();
      plugin.setEnabled(true);
      this.enabledPlugins.add(pluginId);
      this.savePluginEnabled(pluginId, true);
      log.debug(`Plugin ${pluginId} enabled successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to enable plugin ${pluginId}:`, error);
      return false;
    }
  }

  disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.warn(`Plugin ${pluginId} not found`);
      return false;
    }

    if (!this.enabledPlugins.has(pluginId)) {
      console.warn(`Plugin ${pluginId} is not enabled`);
      return false;
    }

    try {
      plugin.onDisable();
      plugin.setEnabled(false);
      this.enabledPlugins.delete(pluginId);
      this.savePluginEnabled(pluginId, false);
      log.debug(`Plugin ${pluginId} disabled successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to disable plugin ${pluginId}:`, error);
      return false;
    }
  }

  getPlugin(pluginId: string): BasePlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getEnabledPlugins(): BasePlugin[] {
    return Array.from(this.enabledPlugins).map(id => this.plugins.get(id)!);
  }

  isPluginEnabled(pluginId: string): boolean {
    return this.enabledPlugins.has(pluginId);
  }

  updatePluginSettings(pluginId: string, settings: Record<string, unknown>): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.warn(`Plugin ${pluginId} not found`);
      return false;
    }

    plugin.updateSettings(settings);

    // Save to persistent store
    this.savePluginSettings(pluginId, settings);

    return true;
  }

  getPluginSettingsSchema(pluginId: string): PluginSettings | null {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return null;
    }

    return (plugin.constructor as typeof BasePlugin).getSettingsSchema?.() || null;
  }

  getAllPlugins(): Array<{ id: string; name: string; description: string; version: string; author: string; enabled: boolean }> {
    const plugins: Array<{ id: string; name: string; description: string; version: string; author: string; enabled: boolean }> = [];

    this.plugins.forEach(plugin => {
      plugins.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: plugin.author,
        // Return the actual runtime enabled state from enabledPlugins set
        enabled: this.isPluginEnabled(plugin.id)
      });
    });

    return plugins;
  }

  getAllPluginSettingsSchemas(): Record<string, PluginSettings> {
    const schemas: Record<string, PluginSettings> = {};

    this.plugins.forEach(plugin => {
      const schema = (plugin.constructor as typeof BasePlugin).getSettingsSchema?.();
      if (schema) {
        schemas[plugin.id] = schema;
      }
    });

    return schemas;
  }

  getPluginSetting(pluginId: string, key: string): unknown {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    return plugin.currentSettings[key];
  }

  updatePluginSetting(pluginId: string, key: string, value: unknown): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.warn(`Plugin ${pluginId} not found`);
      return false;
    }

    const newSettings = { ...plugin.currentSettings };
    newSettings[key] = value;
    plugin.updateSettings(newSettings);

    // Save to persistent store
    this.savePluginSettings(pluginId, newSettings);

    return true;
  }

  // Lifecycle methods
  async onAppReady(): Promise<void> {
    for (const plugin of this.getEnabledPlugins()) {
      try {
        await plugin.onAppReady?.();
      } catch (error) {
        console.error(`Error in plugin ${plugin.id} onAppReady:`, error);
      }
    }
  }

  async onAppClose(): Promise<void> {
    for (const plugin of this.getEnabledPlugins()) {
      try {
        await plugin.onAppClose?.();
      } catch (error) {
        console.error(`Error in plugin ${plugin.id} onAppClose:`, error);
      }
    }
  }
}

// Export singleton instance
export const pluginManager = new PluginManager();
