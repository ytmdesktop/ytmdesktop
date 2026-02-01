/**
 * Sentry configuration for YouTube Music Desktop App
 * This file contains configuration for Sentry error tracking
 */
export const SENTRY_CONFIG = {
  // Sentry DSN (Data Source Name). Leave empty to disable Sentry.
  dsn: process.env.SENTRY_DSN || "",

  // Environment (production, staging, development)
  environment: process.env.NODE_ENV || "development",

  // Release version (optional)
  release: process.env.SENTRY_RELEASE || "",

  // The percentage of transactions to track (0.0 to 1.0)
  tracesSampleRate: 1.0,

  // Maximum breadcrumbs to record
  maxBreadcrumbs: 50,

  // Whether to enable auto-session tracking
  autoSessionTracking: true,

  // Whether to capture errors in development mode
  captureInDevelopment: false, // Set to false to reduce noise during development

  // Paths to ignore when capturing errors
  ignoreErrors: [
    // Ignore Chrome/Electron third-party cookie errors
    /third-party cookie/i,
    /Autofill\.enable/i,
    /Autofill\.setAddresses/i
    // Temporarily removed tray icon errors to test Sentry capture
  ],

  // Tags to include with every event
  initialTags: {
    app: "youtube-music-desktop-app",
    electronVersion: process.versions.electron || "",
    nodeVersion: process.versions.node || "",
    chromeVersion: process.versions.chrome || "",
    platform: process.platform || ""
  },

  // Update monitoring configuration
  updateMonitoring: {
    // Whether to track update events in Sentry
    enabled: true,

    // Events to track
    trackEvents: {
      updateCheck: true,
      updateAvailable: true,
      updateDownloaded: true,
      updateInstalled: true,
      updateError: true
    }
  }
};
