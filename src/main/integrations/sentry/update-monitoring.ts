import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import log from "electron-log";
import { SENTRY_CONFIG } from "../../../shared/sentry.config";

/**
 * Update monitoring for Sentry integration
 * Tracks update-related events in Sentry
 */
export class SentryUpdateMonitor {
  private enabled = SENTRY_CONFIG.updateMonitoring?.enabled ?? false;

  constructor() {
    if (!this.enabled) {
      log.info("Sentry update monitoring is disabled");
      return;
    }
    log.info("Sentry update monitoring initialized");
  }

  /**
   * Tracks an update check event in Sentry
   * @param isManualCheck Whether this was triggered manually by the user
   * @param currentVersion Current app version
   */
  trackUpdateCheck(isManualCheck: boolean, currentVersion = app.getVersion()): void {
    if (!this.enabled || !SENTRY_CONFIG.updateMonitoring?.trackEvents.updateCheck) {
      return;
    }

    try {
      Sentry.captureMessage("Auto-update check started", {
        level: "info",
        tags: {
          update_event: "check_started",
          update_manual: isManualCheck ? "true" : "false"
        },
        contexts: {
          update: {
            currentVersion,
            isManualCheck
          }
        }
      });
      log.debug("Tracked update check event in Sentry");
    } catch (error) {
      log.error("Failed to track update check in Sentry:", error);
    }
  }

  /**
   * Tracks when an update is available
   * @param newVersion New version that's available
   * @param currentVersion Current app version
   * @param isStartupCheck Whether this was during app startup
   */
  trackUpdateAvailable(newVersion: string, currentVersion = app.getVersion(), isStartupCheck = false): void {
    if (!this.enabled || !SENTRY_CONFIG.updateMonitoring?.trackEvents.updateAvailable) {
      return;
    }

    try {
      Sentry.captureMessage("Auto-update available", {
        level: "info",
        tags: {
          update_event: "update_available",
          update_startup: isStartupCheck ? "true" : "false"
        },
        contexts: {
          update: {
            currentVersion,
            newVersion,
            isStartupCheck
          }
        }
      });
      log.debug("Tracked update available event in Sentry");
    } catch (error) {
      log.error("Failed to track update available in Sentry:", error);
    }
  }

  /**
   * Tracks when an update has been downloaded
   * @param newVersion New version that was downloaded
   * @param currentVersion Current app version
   * @param autoInstall Whether the update will be auto-installed
   */
  trackUpdateDownloaded(newVersion: string, currentVersion = app.getVersion(), autoInstall = false): void {
    if (!this.enabled || !SENTRY_CONFIG.updateMonitoring?.trackEvents.updateDownloaded) {
      return;
    }

    try {
      Sentry.captureMessage("Auto-update downloaded", {
        level: "info",
        tags: {
          update_event: "update_downloaded",
          update_auto_install: autoInstall ? "true" : "false"
        },
        contexts: {
          update: {
            currentVersion,
            newVersion,
            autoInstall
          }
        }
      });
      log.debug("Tracked update downloaded event in Sentry");
    } catch (error) {
      log.error("Failed to track update downloaded in Sentry:", error);
    }
  }

  /**
   * Tracks when an update is installed
   * @param newVersion New version that was installed
   * @param previousVersion Previous app version
   */
  trackUpdateInstalled(newVersion = app.getVersion(), previousVersion: string): void {
    if (!this.enabled || !SENTRY_CONFIG.updateMonitoring?.trackEvents.updateInstalled) {
      return;
    }

    try {
      Sentry.captureMessage("Auto-update installed", {
        level: "info",
        tags: {
          update_event: "update_installed"
        },
        contexts: {
          update: {
            newVersion,
            previousVersion
          }
        }
      });
      log.debug("Tracked update installed event in Sentry");
    } catch (error) {
      log.error("Failed to track update installed in Sentry:", error);
    }
  }

  /**
   * Tracks when an update error occurs
   * @param error The error that occurred
   * @param currentVersion Current app version
   * @param updateStatus Current update status
   */
  trackUpdateError(error: Error | string, currentVersion = app.getVersion(), updateStatus = "unknown"): void {
    if (!this.enabled || !SENTRY_CONFIG.updateMonitoring?.trackEvents.updateError) {
      return;
    }

    try {
      const errorObj = error instanceof Error ? error : new Error(String(error) || "Unknown update error");

      Sentry.captureException(errorObj, {
        level: "error",
        tags: {
          update_event: "update_error",
          update_status: updateStatus
        },
        contexts: {
          update: {
            currentVersion,
            updateStatus
          }
        }
      });
      log.debug("Tracked update error event in Sentry");
    } catch (captureError) {
      log.error("Failed to track update error in Sentry:", captureError);
    }
  }
}

// Export singleton instance
export const sentryUpdateMonitor = new SentryUpdateMonitor();
