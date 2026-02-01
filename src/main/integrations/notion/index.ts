import { Client } from "@notionhq/client";
import BaseIntegration from "../base-integration";
import { NOTION_CONFIG } from "../../../shared/notion.config";
import log from "electron-log";
import Conf from "conf";
import { StoreSchema } from "../../../shared/store/schema";
import MemoryStore from "../../memory-store";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";
import type { MemoryStoreSchema } from "../../../shared/store/schema";

/**
 * Types for Notion integration
 */
interface NotionBugReport {
  title: string;
  description: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status?: string;
  reproducible?: boolean;
  version?: string;
  reporter?: string;
  labels?: string[];
  screenshots?: string[];
}

interface NotionFeatureRequest {
  title: string;
  description: string;
  priority: "High" | "Medium" | "Low";
  status?: string;
  requester?: string;
  labels?: string[];
}

interface NotionDocumentationPage {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
}

/**
 * Notion Integration for YouTube Music Desktop App
 * Provides integration with Notion for bug tracking, feature requests, and documentation
 */
export default class NotionIntegration extends BaseIntegration {
  private notion: Client | null = null;
  private enabled = false;
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Provides the store and memory store to the integration
   * @param store The config store
   * @param memoryStore The memory store
   */
  provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  /**
   * Enable the Notion integration
   */
  enable(): void {
    if (this.enabled || !this.store) {
      return;
    }

    try {
      // Get API key from store or config
      const storedKey = this.store?.get("integrations.notionApiKey");
      const apiKey = typeof storedKey === "string" && storedKey.trim().length > 0 ? storedKey : NOTION_CONFIG.apiKey;

      if (!apiKey) {
        log.warn("Notion integration not enabled: missing API key");
        return;
      }

      // Initialize the Notion client
      this.notion = new Client({ auth: apiKey });
      this.enabled = true;

      // Set up sync interval if configured
      if (NOTION_CONFIG.sync.interval > 0) {
        this.syncInterval = setInterval(() => {
          this.syncData().catch(error => {
            log.error("Failed to sync Notion data:", error);
          });
        }, NOTION_CONFIG.sync.interval);
      }

      log.info("Notion integration enabled");
    } catch (error) {
      log.error("Failed to initialize Notion integration:", error);
      this.notion = null;
    }
  }

  /**
   * Disable the Notion integration
   */
  disable(): void {
    if (!this.enabled) {
      return;
    }

    try {
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      }

      this.notion = null;
      this.enabled = false;

      log.info("Notion integration disabled");
    } catch (error) {
      log.error("Failed to disable Notion integration:", error);
    }
  }

  /**
   * Create a new bug report in Notion
   * @param bugReport Bug report details
   * @returns ID of the created page or null if failed
   */
  async createBugReport(bugReport: NotionBugReport): Promise<string | null> {
    if (!this.enabled || !this.notion || !NOTION_CONFIG.databases.bugs) {
      return null;
    }

    try {
      const response = await this.notion.pages.create({
        parent: {
          database_id: NOTION_CONFIG.databases.bugs
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: bugReport.title
                }
              }
            ]
          },
          Status: {
            select: {
              name: bugReport.status || NOTION_CONFIG.defaults.bugReport.status
            }
          },
          Severity: {
            select: {
              name: bugReport.severity
            }
          },
          Version: {
            rich_text: [
              {
                text: {
                  content: bugReport.version || "Unknown"
                }
              }
            ]
          },
          Reproducible: {
            checkbox: !!bugReport.reproducible
          }
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: bugReport.description
                  }
                }
              ]
            }
          }
        ]
      });

      log.info("Created bug report in Notion:", response.id);
      return response.id;
    } catch (error) {
      log.error("Failed to create bug report in Notion:", error);
      return null;
    }
  }

  /**
   * Create a new feature request in Notion
   * @param featureRequest Feature request details
   * @returns ID of the created page or null if failed
   */
  async createFeatureRequest(featureRequest: NotionFeatureRequest): Promise<string | null> {
    if (!this.enabled || !this.notion || !NOTION_CONFIG.databases.features) {
      return null;
    }

    try {
      const response = await this.notion.pages.create({
        parent: {
          database_id: NOTION_CONFIG.databases.features
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: featureRequest.title
                }
              }
            ]
          },
          Status: {
            select: {
              name: featureRequest.status || NOTION_CONFIG.defaults.featureRequest.status
            }
          },
          Priority: {
            select: {
              name: featureRequest.priority
            }
          },
          Requester: {
            rich_text: [
              {
                text: {
                  content: featureRequest.requester || "Anonymous"
                }
              }
            ]
          }
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: featureRequest.description
                  }
                }
              ]
            }
          }
        ]
      });

      log.info("Created feature request in Notion:", response.id);
      return response.id;
    } catch (error) {
      log.error("Failed to create feature request in Notion:", error);
      return null;
    }
  }

  /**
   * Create or update a documentation page in Notion
   * @param doc Documentation page details
   * @returns ID of the created page or null if failed
   */
  async createDocumentationPage(doc: NotionDocumentationPage): Promise<string | null> {
    if (!this.enabled || !this.notion || !NOTION_CONFIG.databases.documentation) {
      return null;
    }

    try {
      // Convert the content to Notion blocks
      const blocks = this.convertMarkdownToBlocks(doc.content);

      const response = await this.notion.pages.create({
        parent: {
          database_id: NOTION_CONFIG.databases.documentation
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: doc.title
                }
              }
            ]
          },
          ...(doc.category
            ? {
                Category: {
                  select: { name: doc.category }
                }
              }
            : {}),
          Tags: {
            multi_select: doc.tags
              ? doc.tags.map(tag => ({
                  name: tag
                }))
              : []
          }
        },
        children: blocks
      });

      log.info("Created documentation page in Notion:", response.id);
      return response.id;
    } catch (error) {
      log.error("Failed to create documentation page in Notion:", error);
      return null;
    }
  }

  /**
   * Sync data with Notion databases
   */
  private async syncData(): Promise<void> {
    if (!this.enabled || !this.notion) {
      return;
    }

    try {
      log.info("Starting Notion data sync");

      // Sync features if database is configured
      if (NOTION_CONFIG.databases.features) {
        const features = await this.queryDatabase(NOTION_CONFIG.databases.features);
        this.memoryStore.set("notionFeatures", features);
      }

      // Sync bugs if database is configured
      if (NOTION_CONFIG.databases.bugs) {
        const bugs = await this.queryDatabase(NOTION_CONFIG.databases.bugs);
        this.memoryStore.set("notionBugs", bugs);
      }

      log.info("Notion data sync completed");
    } catch (error) {
      log.error("Failed to sync Notion data:", error);
    }
  }

  /**
   * Query a Notion database
   * @param databaseId The database ID to query
   * @returns Array of database items
   */
  private async queryDatabase(databaseId: string): Promise<Record<string, unknown>[]> {
    if (!this.enabled || !this.notion) {
      return [];
    }

    try {
      const databasesClient = this.notion.databases as unknown as {
        query?: (args: { database_id: string; page_size?: number }) => Promise<{ results: unknown[] }>;
      };

      if (typeof databasesClient.query !== "function") {
        log.warn("Notion SDK does not expose databases.query in this version");
        return [];
      }

      const response = await databasesClient.query({
        database_id: databaseId,
        page_size: NOTION_CONFIG.sync.pageLimit
      });

      return response.results as Record<string, unknown>[];
    } catch (error) {
      log.error(`Failed to query Notion database ${databaseId}:`, error);
      return [];
    }
  }

  /**
   * Convert markdown content to Notion blocks
   * @param markdown Markdown content
   * @returns Array of Notion blocks
   */
  private convertMarkdownToBlocks(markdown: string): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];
    const paragraphs = markdown.split("\n\n");

    for (const paragraph of paragraphs) {
      if (paragraph.startsWith("# ")) {
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: paragraph.substring(2)
                }
              }
            ]
          }
        });
        continue;
      }

      if (paragraph.startsWith("## ")) {
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: paragraph.substring(3)
                }
              }
            ]
          }
        });
        continue;
      }

      if (paragraph.startsWith("### ")) {
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: paragraph.substring(4)
                }
              }
            ]
          }
        });
        continue;
      }

      if (paragraph.startsWith("- ")) {
        const items = paragraph.split("\n");
        for (const item of items) {
          blocks.push({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: item.substring(2)
                  }
                }
              ]
            }
          });
        }
        continue;
      }

      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: paragraph
              }
            }
          ]
        }
      });
    }

    return blocks;
  }
}
