import { BasePlugin, PluginSettings } from "../../base-plugin";
import NotionIntegration from "../../../notion";
import log from "electron-log";

/**
 * NotionSyncPlugin
 * A plugin to sync data with Notion and provide user-facing features
 * for integration with Notion workspaces
 */
export class NotionSyncPlugin extends BasePlugin {
  private notionIntegration: NotionIntegration | null = null;

  constructor() {
    super({
      id: "notion-sync",
      name: "Notion Sync",
      description: "Sync data with Notion and add features for Notion integration",
      version: "1.0.0",
      author: "YTMDesktop Team",
      enabled: false,
      settings: {
        syncEnabled: true,
        syncInterval: 3600, // in seconds (1 hour)
        bugReportTemplate: "**Title**: {title}\n**Version**: {version}\n**Description**:\n{description}",
        featureRequestTemplate: "**Title**: {title}\n**Description**:\n{description}",
        includeSystemInfo: true,
        notifyOnSync: false,
        syncOnStartup: true
      }
    });
  }

  onEnable(): void {
    log.debug("Notion Sync Plugin enabled");
    this.initializeNotion();
  }

  onDisable(): void {
    log.debug("Notion Sync Plugin disabled");
    // No cleanup needed as the Notion integration is managed separately
  }

  onSettingsChanged(newSettings: Record<string, unknown>): void {
    log.debug("Notion Sync settings changed:", newSettings);
  }

  private initializeNotion(): void {
    try {
      // Get the Notion integration instance
      // Note: In a real implementation, this would be injected or provided from the main app
      this.notionIntegration = new NotionIntegration();

      // The actual initialization would happen through the main app's integration system
      log.info("Notion integration initialized from plugin");
    } catch (error) {
      log.error("Failed to initialize Notion integration from plugin:", error);
    }
  }

  /**
   * Report a bug to Notion
   * @param title Bug title
   * @param description Bug description
   * @param severity Bug severity
   * @returns ID of the created bug report or null if failed
   */
  public async reportBug(title: string, description: string, severity: "Critical" | "High" | "Medium" | "Low"): Promise<string | null> {
    if (!this.notionIntegration) {
      log.error("Notion integration not available");
      return null;
    }

    try {
      const bugReport = {
        title,
        description,
        severity,
        version: this.getAppVersion(),
        reproducible: true
      };

      return await this.notionIntegration.createBugReport(bugReport);
    } catch (error) {
      log.error("Failed to report bug to Notion:", error);
      return null;
    }
  }

  /**
   * Submit a feature request to Notion
   * @param title Feature title
   * @param description Feature description
   * @param priority Feature priority
   * @returns ID of the created feature request or null if failed
   */
  public async requestFeature(title: string, description: string, priority: "High" | "Medium" | "Low"): Promise<string | null> {
    if (!this.notionIntegration) {
      log.error("Notion integration not available");
      return null;
    }

    try {
      const featureRequest = {
        title,
        description,
        priority
      };

      return await this.notionIntegration.createFeatureRequest(featureRequest);
    } catch (error) {
      log.error("Failed to submit feature request to Notion:", error);
      return null;
    }
  }

  /**
   * Create documentation page in Notion
   * @param title Page title
   * @param content Page content in markdown format
   * @param category Optional category for the page
   * @param tags Optional tags for the page
   * @returns ID of the created page or null if failed
   */
  public async createDocumentation(title: string, content: string, category?: string, tags?: string[]): Promise<string | null> {
    if (!this.notionIntegration) {
      log.error("Notion integration not available");
      return null;
    }

    try {
      const docPage = {
        title,
        content,
        category,
        tags
      };

      return await this.notionIntegration.createDocumentationPage(docPage);
    } catch (error) {
      log.error("Failed to create documentation page in Notion:", error);
      return null;
    }
  }

  /**
   * Get the app version
   * @returns The app version string
   */
  private getAppVersion(): string {
    try {
      // Import electron at the top level instead
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require("electron");
      return app.getVersion();
    } catch {
      return "Unknown";
    }
  }

  /**
   * Get the plugin settings schema
   * @returns Plugin settings schema
   */
  static getSettingsSchema(): PluginSettings {
    return {
      syncEnabled: {
        type: "boolean",
        label: "Enable Sync",
        description: "Enable syncing data with Notion",
        default: true
      },
      syncInterval: {
        type: "number",
        label: "Sync Interval",
        description: "How often to sync data with Notion (in seconds)",
        default: 3600
      },
      bugReportTemplate: {
        type: "string",
        label: "Bug Report Template",
        description: "Template for bug reports (markdown)",
        default: "**Title**: {title}\n**Version**: {version}\n**Description**:\n{description}"
      },
      featureRequestTemplate: {
        type: "string",
        label: "Feature Request Template",
        description: "Template for feature requests (markdown)",
        default: "**Title**: {title}\n**Description**:\n{description}"
      },
      includeSystemInfo: {
        type: "boolean",
        label: "Include System Info",
        description: "Include system information in bug reports",
        default: true
      },
      notifyOnSync: {
        type: "boolean",
        label: "Notify on Sync",
        description: "Show notifications when syncing with Notion",
        default: false
      },
      syncOnStartup: {
        type: "boolean",
        label: "Sync on Startup",
        description: "Sync with Notion when the app starts",
        default: true
      }
    };
  }
}
