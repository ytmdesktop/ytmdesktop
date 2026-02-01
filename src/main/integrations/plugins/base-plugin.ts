export interface PluginConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export interface PluginSettings {
  [key: string]: {
    type: "boolean" | "string" | "number" | "select";
    label: string;
    description?: string;
    default: unknown;
    options?: { value: unknown; label: string }[];
  };
}

export abstract class BasePlugin {
  protected config: PluginConfig;
  protected settings: Record<string, unknown>;

  constructor(config: PluginConfig) {
    this.config = config;
    this.settings = config.settings || {};
  }

  // Plugin lifecycle methods
  abstract onEnable(): Promise<void> | void;
  abstract onDisable(): Promise<void> | void;

  // Optional lifecycle methods
  onSettingsChanged?(newSettings: Record<string, unknown>): void;
  onAppReady?(): Promise<void> | void;
  onAppClose?(): Promise<void> | void;

  // Getters
  get id(): string {
    return this.config.id;
  }
  get name(): string {
    return this.config.name;
  }
  get description(): string {
    return this.config.description;
  }
  get version(): string {
    return this.config.version;
  }
  get author(): string {
    return this.config.author;
  }
  get enabled(): boolean {
    return this.config.enabled;
  }
  get currentSettings(): Record<string, unknown> {
    return this.settings;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  // Settings management
  updateSettings(newSettings: Record<string, unknown>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.onSettingsChanged?.(this.settings);
  }

  // Plugin metadata
  static getSettingsSchema(): PluginSettings | null {
    return null;
  }
}
