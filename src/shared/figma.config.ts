/**
 * Figma API configuration for YouTube Music Desktop App
 * This file contains configuration for the Figma integration
 */
export const FIGMA_CONFIG = {
  // Figma API key (obtained from Figma user settings)
  personalAccessToken: process.env.FIGMA_PERSONAL_ACCESS_TOKEN || "",

  // Team ID for accessing team files
  teamId: process.env.FIGMA_TEAM_ID || "",

  // Important Figma files
  files: {
    // Main UI design file
    uiKit: process.env.FIGMA_UI_KIT_FILE_KEY || "",

    // Components library
    components: process.env.FIGMA_COMPONENTS_FILE_KEY || "",

    // Icons library
    icons: process.env.FIGMA_ICONS_FILE_KEY || "",

    // Theme definitions
    themes: process.env.FIGMA_THEMES_FILE_KEY || ""
  },

  // Configuration for automatic asset generation
  assetGeneration: {
    // Output directory for generated assets (relative to project root)
    outputDir: "src/assets/generated",

    // Scale factors for exporting assets
    scales: [1, 2],

    // Format for exported assets
    format: "png",

    // Whether to organize assets by component
    organizeByComponent: true,

    // Whether to include metadata file
    includeMetadata: true
  },

  // Configuration for the design token sync
  designTokens: {
    // Output file path for design tokens (relative to project root)
    outputPath: "src/shared/design-tokens.ts",

    // Format for the design tokens
    format: "ts",

    // Whether to transform the tokens to CSS variables
    transformToCSSVariables: true,

    // Whether to include comments from Figma
    includeComments: true
  },

  // Configuration for sync between Figma and code
  sync: {
    // How often to check for updates (in milliseconds)
    checkInterval: 86400000, // 24 hours

    // Whether to sync automatically
    autoSync: false,

    // Who should be notified of design changes
    notifyChanges: ["developers"]
  }
};
