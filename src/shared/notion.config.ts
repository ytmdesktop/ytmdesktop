/**
 * Notion API configuration for YouTube Music Desktop App
 * This file contains configuration for the Notion integration
 */
export const NOTION_CONFIG = {
  // Notion API key (obtained from Notion integrations page)
  apiKey: process.env.NOTION_API_KEY || "",

  // Database IDs for different content types
  databases: {
    // Database for tracking features and development
    features: process.env.NOTION_FEATURES_DB || "",

    // Database for tracking bugs
    bugs: process.env.NOTION_BUGS_DB || "",

    // Database for tracking user feedback
    feedback: process.env.NOTION_FEEDBACK_DB || "",

    // Database for documentation
    documentation: process.env.NOTION_DOCS_DB || ""
  },

  // Page IDs for important pages
  pages: {
    // Home page for the integration
    home: process.env.NOTION_HOME_PAGE || "",

    // Development roadmap
    roadmap: process.env.NOTION_ROADMAP_PAGE || "",

    // User guide
    userGuide: process.env.NOTION_USER_GUIDE_PAGE || ""
  },

  // Default properties for creating new items
  defaults: {
    // Default properties for bug reports
    bugReport: {
      status: "New",
      priority: "Medium"
    },

    // Default properties for feature requests
    featureRequest: {
      status: "Requested",
      priority: "Medium"
    }
  },

  // Configuration for syncing data
  sync: {
    // How often to sync data (in milliseconds)
    interval: 3600000, // 1 hour

    // Maximum number of pages to sync at once
    pageLimit: 100
  }
};
