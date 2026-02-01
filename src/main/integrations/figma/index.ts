import * as Figma from "figma-js";
import BaseIntegration from "../base-integration";
import { FIGMA_CONFIG } from "../../../shared/figma.config";
import log from "electron-log";
import fs from "fs/promises";
import path from "path";
import { app } from "electron";
import Conf from "conf";
import { StoreSchema } from "../../../shared/store/schema";
import MemoryStore from "../../memory-store";
import type { MemoryStoreSchema } from "../../../shared/store/schema";

/**
 * Types for Figma integration
 */
interface FigmaFile {
  key: string;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
}

interface FigmaAsset {
  name: string;
  url: string;
  format: string;
  scale: number;
  componentId?: string;
}

interface DesignToken {
  name: string;
  value: string;
  type: "color" | "spacing" | "typography" | "radius" | "shadow" | "other";
  description?: string;
}

/**
 * Figma Integration for YouTube Music Desktop App
 * Provides integration with Figma for design assets and tokens
 */
export default class FigmaIntegration extends BaseIntegration {
  private client: Figma.ClientInterface | null = null;
  private enabled = false;
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private syncInterval: NodeJS.Timeout | null = null;
  private cachedFiles: Map<string, FigmaFile> = new Map();
  private cachedAssets: Map<string, FigmaAsset[]> = new Map();
  private designTokens: DesignToken[] = [];

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
   * Enable the Figma integration
   */
  enable(): void {
    if (this.enabled || !this.store) {
      return;
    }

    try {
      // Get API key from store or config
      const storedToken = this.store?.get("integrations.figmaPersonalAccessToken");
      const personalAccessToken = typeof storedToken === "string" && storedToken.trim().length > 0 ? storedToken : FIGMA_CONFIG.personalAccessToken;

      if (!personalAccessToken) {
        log.warn("Figma integration not enabled: missing personal access token");
        return;
      }

      // Initialize the Figma client
      this.client = Figma.Client({
        personalAccessToken
      });

      this.enabled = true;

      // Set up sync interval if configured
      if (FIGMA_CONFIG.sync.checkInterval > 0 && FIGMA_CONFIG.sync.autoSync) {
        this.syncInterval = setInterval(() => {
          this.syncDesignAssets().catch(error => {
            log.error("Failed to sync Figma design assets:", error);
          });
        }, FIGMA_CONFIG.sync.checkInterval);
      }

      log.info("Figma integration enabled");
    } catch (error) {
      log.error("Failed to initialize Figma integration:", error);
      this.client = null;
    }
  }

  /**
   * Disable the Figma integration
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

      this.client = null;
      this.enabled = false;

      log.info("Figma integration disabled");
    } catch (error) {
      log.error("Failed to disable Figma integration:", error);
    }
  }

  /**
   * Get files from the Figma team
   * @returns Array of Figma files
   */
  async getTeamFiles(): Promise<FigmaFile[]> {
    if (!this.enabled || !this.client) {
      return [];
    }

    if (!FIGMA_CONFIG.teamId) {
      log.error("Figma team ID not specified");
      return [];
    }

    try {
      const response = await this.client.teamProjects(FIGMA_CONFIG.teamId);

      const projects = response.data.projects;
      const files: FigmaFile[] = [];

      for (const project of projects) {
        const filesResponse = await this.client.projectFiles(project.id);

        for (const file of filesResponse.data.files) {
          const figmaFile: FigmaFile = {
            key: file.key,
            name: file.name,
            lastModified: file.last_modified,
            thumbnailUrl: file.thumbnail_url
          };

          files.push(figmaFile);
          this.cachedFiles.set(file.key, figmaFile);
        }
      }

      return files;
    } catch (error) {
      log.error("Failed to get Figma team files:", error);
      return [];
    }
  }

  /**
   * Get design tokens from a Figma file
   * @param fileKey Figma file key
   * @returns Array of design tokens
   */
  async getDesignTokens(fileKey: string): Promise<DesignToken[]> {
    if (!this.enabled || !this.client) {
      return [];
    }

    try {
      const response = await this.client.file(fileKey);
      const file = response.data;

      // This is a simplified implementation - in a real implementation,
      // you would parse the Figma file structure to extract design tokens
      const tokens: DesignToken[] = [];

      // For demonstration, we'll just extract some colors from the first page
      const firstPage = file.document.children?.[0];

      if (firstPage && firstPage.type === "CANVAS") {
        // Look for a "Colors" or "Tokens" frame
        const tokensFrame = firstPage.children.find(
          node => node.type === "FRAME" && (node.name.toLowerCase().includes("color") || node.name.toLowerCase().includes("token"))
        );

        if (tokensFrame && tokensFrame.type === "FRAME") {
          for (const node of tokensFrame.children) {
            if (node.type === "RECTANGLE" && node.name && node.fills && node.fills.length > 0) {
              const fill = node.fills[0];

              if (fill.type === "SOLID" && fill.color) {
                const { r, g, b } = fill.color;
                const rgbColor = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

                tokens.push({
                  name: node.name,
                  value: rgbColor,
                  type: "color",
                  description: node.name.toLowerCase().includes("primary") ? "Primary color" : "Secondary color"
                });
              }
            }
          }
        }
      }

      // Cache design tokens
      this.designTokens = tokens;

      return tokens;
    } catch (error) {
      log.error(`Failed to get design tokens from Figma file ${fileKey}:`, error);
      return [];
    }
  }

  /**
   * Export assets from a Figma file
   * @param fileKey Figma file key
   * @param nodeIds Node IDs to export (optional)
   * @returns Array of exported assets
   */
  async exportAssets(fileKey: string, nodeIds?: string[]): Promise<FigmaAsset[]> {
    if (!this.enabled || !this.client) {
      return [];
    }

    try {
      // Get components to export
      const componentsResponse = nodeIds && nodeIds.length > 0 ? await this.client.fileNodes(fileKey, { ids: nodeIds }) : await this.client.file(fileKey);

      let components: Figma.Node[] = [];

      if (nodeIds && nodeIds.length > 0) {
        const nodesResponse = componentsResponse.data as Figma.FileNodesResponse;
        const nodes = Object.values(nodesResponse.nodes ?? {});
        components = nodes.map(node => ("document" in node ? node.document : null)).filter((node): node is Figma.Node => node !== null);
      } else {
        const fileResponse = componentsResponse.data as Figma.FileResponse;
        components = this.findExportableComponents(fileResponse.document);
      }

      if (!components.length) {
        log.warn("No exportable components found in Figma file");
        return [];
      }

      // Get export settings
      const exportSettings = {
        format: FIGMA_CONFIG.assetGeneration.format as "png" | "jpg" | "svg" | "pdf",
        scale: FIGMA_CONFIG.assetGeneration.scales[0] || 1
      };

      // Request exports
      const ids = components.map(component => component.id);
      const exportResponse = await this.client.fileImages(fileKey, {
        format: exportSettings.format,
        ids,
        scale: exportSettings.scale
      });

      // Process exported assets
      const assets: FigmaAsset[] = [];

      for (const id of ids) {
        const component = components.find(c => c.id === id);
        if (component && exportResponse.data.images[id]) {
          assets.push({
            name: component.name,
            url: exportResponse.data.images[id],
            format: exportSettings.format,
            scale: exportSettings.scale,
            componentId: id
          });
        }
      }

      // Cache assets
      this.cachedAssets.set(fileKey, assets);

      return assets;
    } catch (error) {
      log.error(`Failed to export assets from Figma file ${fileKey}:`, error);
      return [];
    }
  }

  /**
   * Download exported assets
   * @param assets Assets to download
   * @param outputDir Output directory
   * @returns Array of downloaded file paths
   */
  async downloadAssets(assets: FigmaAsset[], outputDir?: string): Promise<string[]> {
    if (!this.enabled) {
      return [];
    }

    try {
      const targetDir = outputDir || path.join(app.getPath("userData"), "figma-assets");

      // Ensure directory exists
      await fs.mkdir(targetDir, { recursive: true });

      const downloadedFiles: string[] = [];

      for (const asset of assets) {
        try {
          // Fetch asset
          const response = await fetch(asset.url);
          if (!response.ok) {
            throw new Error(`Failed to fetch asset: ${response.status} ${response.statusText}`);
          }

          // Get asset data
          const buffer = Buffer.from(await response.arrayBuffer());

          // Generate file name
          const fileName = `${asset.name.replace(/[^a-zA-Z0-9-_]/g, "_")}_${asset.scale}x.${asset.format}`;
          const filePath = path.join(targetDir, fileName);

          // Save file
          await fs.writeFile(filePath, buffer);
          downloadedFiles.push(filePath);

          log.info(`Downloaded Figma asset: ${filePath}`);
        } catch (assetError) {
          log.error(`Failed to download asset ${asset.name}:`, assetError);
        }
      }

      return downloadedFiles;
    } catch (error) {
      log.error("Failed to download Figma assets:", error);
      return [];
    }
  }

  /**
   * Sync design assets from Figma
   */
  async syncDesignAssets(): Promise<void> {
    if (!this.enabled || !this.client) {
      return;
    }

    try {
      log.info("Starting Figma design assets sync");

      // Sync UI kit
      if (FIGMA_CONFIG.files.uiKit) {
        const assets = await this.exportAssets(FIGMA_CONFIG.files.uiKit);
        if (assets.length > 0) {
          await this.downloadAssets(assets, path.join(app.getPath("userData"), "figma-assets", "ui-kit"));
        }
      }

      // Sync icons
      if (FIGMA_CONFIG.files.icons) {
        const assets = await this.exportAssets(FIGMA_CONFIG.files.icons);
        if (assets.length > 0) {
          await this.downloadAssets(assets, path.join(app.getPath("userData"), "figma-assets", "icons"));
        }
      }

      // Sync design tokens
      if (FIGMA_CONFIG.files.themes) {
        const tokens = await this.getDesignTokens(FIGMA_CONFIG.files.themes);
        if (tokens.length > 0) {
          await this.generateDesignTokensFile(tokens);
        }
      }

      log.info("Figma design assets sync completed");
    } catch (error) {
      log.error("Failed to sync Figma design assets:", error);
    }
  }

  /**
   * Generate design tokens file from tokens
   * @param tokens Design tokens
   */
  private async generateDesignTokensFile(tokens: DesignToken[]): Promise<void> {
    if (!tokens.length) {
      return;
    }

    try {
      const outputPath = path.join(app.getPath("userData"), FIGMA_CONFIG.designTokens.outputPath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Generate file content
      let fileContent = "/**\n * Generated design tokens from Figma\n * Do not edit this file directly\n */\n\n";

      if (FIGMA_CONFIG.designTokens.format === "ts") {
        fileContent += "export const DesignTokens = {\n";

        // Group tokens by type
        const tokensByType = tokens.reduce<Record<string, DesignToken[]>>((acc, token) => {
          if (!acc[token.type]) {
            acc[token.type] = [];
          }
          acc[token.type].push(token);
          return acc;
        }, {});

        // Add tokens by type
        for (const [type, typeTokens] of Object.entries(tokensByType)) {
          fileContent += `  ${type}: {\n`;

          for (const token of typeTokens) {
            if (FIGMA_CONFIG.designTokens.includeComments && token.description) {
              fileContent += `    // ${token.description}\n`;
            }
            fileContent += `    ${token.name.replace(/[^a-zA-Z0-9_]/g, "_")}: "${token.value}",\n`;
          }

          fileContent += "  },\n";
        }

        fileContent += "};\n\n";

        // Add CSS variables if configured
        if (FIGMA_CONFIG.designTokens.transformToCSSVariables) {
          fileContent += "// CSS Variables\n";
          fileContent += "export const CSSVariables = `\n";
          fileContent += ":root {\n";

          for (const token of tokens) {
            if (FIGMA_CONFIG.designTokens.includeComments && token.description) {
              fileContent += `  /* ${token.description} */\n`;
            }
            fileContent += `  --${token.name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}: ${token.value};\n`;
          }

          fileContent += "}\n`;\n";
        }
      }

      // Write file
      await fs.writeFile(outputPath, fileContent);

      log.info(`Generated design tokens file: ${outputPath}`);
    } catch (error) {
      log.error("Failed to generate design tokens file:", error);
    }
  }

  /**
   * Find exportable components in a Figma document
   * @param node Figma document node
   * @returns Array of exportable components
   */
  private findExportableComponents(node: Figma.Node): Figma.Node[] {
    const components: Figma.Node[] = [];

    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      components.push(node);
    }

    const withChildren = node as Figma.Node & { children?: Figma.Node[] };
    if (Array.isArray(withChildren.children)) {
      for (const child of withChildren.children) {
        components.push(...this.findExportableComponents(child));
      }
    }

    return components;
  }
}
