import { BasePlugin, PluginSettings } from "../../base-plugin";
import log from "electron-log";

export class NotificationEnhancerPlugin extends BasePlugin {
  constructor() {
    super({
      id: "notification-enhancer",
      name: "Notification Enhancer",
      description: "Enhances notifications with additional information and styling",
      version: "1.0.0",
      author: "YTMDesktop Team",
      enabled: false,
      settings: {
        showAlbumArt: true,
        showProgress: false,
        customDuration: 5000,
        notificationStyle: "default"
      }
    });
  }

  onEnable(): void {
    log.debug("Notification Enhancer Plugin enabled");
    // Hook into notification system
    this.setupNotificationHooks();
  }

  onDisable(): void {
    log.debug("Notification Enhancer Plugin disabled");
    // Clean up hooks
    this.cleanupNotificationHooks();
  }

  onSettingsChanged(newSettings: Record<string, unknown>): void {
    log.debug("Notification Enhancer settings changed:", newSettings);
    // Reapply notification styling if needed
    if (newSettings.notificationStyle !== undefined) {
      const validStyles = ["default", "minimal", "detailed"];
      const styleValue =
        typeof newSettings.notificationStyle === "string"
          ? validStyles.includes(newSettings.notificationStyle)
            ? newSettings.notificationStyle
            : "default"
          : String(newSettings.notificationStyle ?? this.settings.notificationStyle ?? "default");
      this.updateNotificationStyle(styleValue);
    }
  }

  private setupNotificationHooks(): void {
    // This would hook into the existing notification system
    // For now, just log that we're setting up
    log.debug("Setting up notification enhancement hooks");
  }

  private cleanupNotificationHooks(): void {
    // Clean up any hooks we set up
    log.debug("Cleaning up notification enhancement hooks");
  }

  private updateNotificationStyle(style: string): void {
    log.debug(`Updating notification style to: ${style}`);
  }

  static getSettingsSchema(): PluginSettings {
    return {
      showAlbumArt: {
        type: "boolean",
        label: "Show Album Art",
        description: "Include album artwork in notifications",
        default: true
      },
      showProgress: {
        type: "boolean",
        label: "Show Progress Bar",
        description: "Display song progress in notifications",
        default: false
      },
      customDuration: {
        type: "number",
        label: "Notification Duration (ms)",
        description: "How long to show notifications",
        default: 5000
      },
      notificationStyle: {
        type: "select",
        label: "Notification Style",
        description: "Choose the visual style for notifications",
        default: "default",
        options: [
          { value: "default", label: "Default" },
          { value: "minimal", label: "Minimal" },
          { value: "detailed", label: "Detailed" }
        ]
      }
    };
  }
}
