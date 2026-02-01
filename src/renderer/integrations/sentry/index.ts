import * as Sentry from "@sentry/electron/renderer";
import { SENTRY_CONFIG } from "../../../shared/sentry.config";

/**
 * Sentry Integration for the renderer process
 * Tracks errors and exceptions in the renderer Electron process
 */
export default class RendererSentryIntegration {
  private isInitialized = false;
  private isEnabled = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    // Don't initialize Sentry in development unless configured to do so
    if (process.env.NODE_ENV === "development" && !SENTRY_CONFIG.captureInDevelopment) {
      return;
    }

    if (!SENTRY_CONFIG.dsn) {
      console.debug("Sentry DSN not set; skipping renderer-process Sentry initialization");
      return;
    }

    try {
      Sentry.init({
        dsn: SENTRY_CONFIG.dsn,
        environment: SENTRY_CONFIG.environment,
        release: SENTRY_CONFIG.release,

        // Performance monitoring
        tracesSampleRate: SENTRY_CONFIG.tracesSampleRate,

        // Set maximum breadcrumbs
        maxBreadcrumbs: SENTRY_CONFIG.maxBreadcrumbs,

        // Debug mode to help with troubleshooting
        debug: process.env.NODE_ENV === "development",

        // Include app info
        initialScope: {
          tags: {
            ...SENTRY_CONFIG.initialTags,
            process: "renderer"
          }
        },

        // Specify which errors to ignore
        ignoreErrors: SENTRY_CONFIG.ignoreErrors,

        // Before sending an event to Sentry
        beforeSend(event) {
          // Don't send events in development unless configured to do so
          if (process.env.NODE_ENV === "development" && !SENTRY_CONFIG.captureInDevelopment) {
            return null;
          }
          return event;
        }
      });

      this.isInitialized = true;
      this.isEnabled = true;
      console.debug("Sentry integration initialized in renderer process");
    } catch (error) {
      console.error("Failed to initialize Sentry in renderer process:", error);
    }
  }

  enable(): void {
    if (this.isEnabled) {
      return;
    }

    if (process.env.NODE_ENV === "development" && !SENTRY_CONFIG.captureInDevelopment) {
      console.debug("Sentry integration not enabled in development mode");
      return;
    }

    try {
      if (!this.isInitialized) {
        Sentry.init({
          dsn: SENTRY_CONFIG.dsn,
          environment: SENTRY_CONFIG.environment,
          release: SENTRY_CONFIG.release,
          tracesSampleRate: SENTRY_CONFIG.tracesSampleRate,
          maxBreadcrumbs: SENTRY_CONFIG.maxBreadcrumbs,
          debug: process.env.NODE_ENV === "development",
          initialScope: { tags: { ...SENTRY_CONFIG.initialTags, process: "renderer" } },
          ignoreErrors: SENTRY_CONFIG.ignoreErrors,
          beforeSend(event) {
            if (process.env.NODE_ENV === "development" && !SENTRY_CONFIG.captureInDevelopment) return null;
            return event;
          }
        });
        this.isInitialized = true;
      }
      this.isEnabled = true;
      console.debug("Sentry integration enabled in renderer process");
    } catch (error) {
      console.error("Failed to enable Sentry in renderer process:", error);
    }
  }

  disable(): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      // Note: `@sentry/electron/renderer` does not reliably expose `close()`/`flush()` APIs.
      // We simply stop emitting new events by toggling `isEnabled`.
      this.isEnabled = false;
      console.debug("Sentry integration disabled in renderer process");
    } catch (error) {
      console.error("Failed to disable Sentry in renderer process:", error);
    }
  }

  /**
   * Manually capture an exception
   * @param error The error to capture
   * @param context Additional context information
   */
  captureException(error: Error, context?: Record<string, unknown>): string | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      return Sentry.captureException(error, {
        contexts: { additional: context || {} }
      });
    } catch (captureError) {
      console.error("Failed to capture exception with Sentry:", captureError);
      return null;
    }
  }

  /**
   * Manually capture a message
   * @param message The message to capture
   * @param level The severity level
   * @param context Additional context information
   */
  captureMessage(message: string, level: Sentry.SeverityLevel = "info", context?: Record<string, unknown>): string | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      return Sentry.captureMessage(message, {
        level,
        contexts: { additional: context || {} }
      });
    } catch (captureError) {
      console.error("Failed to capture message with Sentry:", captureError);
      return null;
    }
  }

  /**
   * Add breadcrumb to the current scope
   * @param breadcrumb The breadcrumb to add
   */
  addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      Sentry.addBreadcrumb(breadcrumb);
    } catch (error) {
      console.error("Failed to add breadcrumb to Sentry:", error);
    }
  }

  /**
   * Set tag for the current scope
   * @param key Tag key
   * @param value Tag value
   */
  setTag(key: string, value: string): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      Sentry.setTag(key, value);
    } catch (error) {
      console.error("Failed to set Sentry tag:", error);
    }
  }

  /**
   * Set user information
   * @param user User information object
   */
  setUser(user: Sentry.User | null): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      Sentry.setUser(user);
    } catch (error) {
      console.error("Failed to set Sentry user:", error);
    }
  }
}
