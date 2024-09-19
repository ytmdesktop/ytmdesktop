import { app, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import configStore from "./config-store";

export const assetFolder = path.join(!app.isPackaged ? path.join(app.getAppPath(), "src/assets") : process.resourcesPath);

export function getIconPath(icon: string) {
  return path.join(assetFolder, `${!app.isPackaged ? "icons/" : ""}${icon}`);
}
export function getControlsIconPath(icon: string) {
  return getIconPath(`${!app.isPackaged ? "controls/" : ""}${icon}`);
}

export async function v1ConfigMigration() {
  const firstRunPath = path.join(app.getPath("userData"), ".first-run");
  try {
    await fs.access(firstRunPath, fs.constants.F_OK);
  } catch (_) {
    // This is the first run of the program
    const firstRunTouch = await fs.open(firstRunPath, "a");
    await firstRunTouch.close();

    const v1ConfigPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "config.json");
    try {
      const v1Config = JSON.parse(await fs.readFile(v1ConfigPath, { encoding: "utf-8" }));
      const migrateDialog = await dialog.showMessageBox({
        type: "question",
        message: "Would you like to migrate your settings?",
        detail:
          "A configuration file for YouTube Music Desktop App v1 was found. Your settings can be migrated.\n\nWARNING: Not all settings will be migrated as they may no longer be available in v2.",
        buttons: ["No", "Migrate Settings"]
      });

      if (migrateDialog.response === 1) {
        if ("settings-companion-server" in v1Config) {
          configStore.set("integrations.companionServerEnabled", v1Config["settings-companion-server"]);
        }

        if ("settings-continue-where-left-of" in v1Config) {
          configStore.set("playback.continueWhereYouLeftOff", v1Config["settings-continue-where-left-of"]);
        }

        if ("settings-custom-css-page" in v1Config) {
          if (v1Config["settings-custom-css-page"]) {
            const v1CustomCSSPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "custom", "css", "page.css");
            const copyPath = path.join(app.getPath("userData"), "custom_css.css");
            await fs.copyFile(v1CustomCSSPath, copyPath);

            configStore.set("appearance.customCSSPath", copyPath);
            configStore.set("appearance.customCSSEnabled", true);
          }
        }

        if ("settings-decibel-volume" in v1Config) {
          configStore.set("playback.ratioVolume", v1Config["settings-decibel-volume"]);
        }

        if ("settings-discord-rich-presence" in v1Config) {
          configStore.set("integrations.discordPresenceEnabled", v1Config["settings-discord-rich-presence"]);
        }

        if ("settings-page-zoom" in v1Config) {
          configStore.set("appearance.zoom", v1Config["settings-page-zoom"]);
        }

        if ("settings-keep-background" in v1Config) {
          configStore.set("general.hideToTrayOnClose", v1Config["settings-keep-background"]);
        }

        if ("settings-show-notifications" in v1Config) {
          configStore.set("general.showNotificationOnSongChange", v1Config["settings-show-notifications"]);
        }

        if ("settings-start-minimized" in v1Config) {
          configStore.set("general.startMinimized", v1Config["settings-start-minimized"]);
        }

        if ("settings-start-on-boot" in v1Config) {
          configStore.set("general.startOnBoot", v1Config["settings-start-on-boot"]);
        }

        if ("settings-surround-sound" in v1Config) {
          configStore.set("playback.enableSpeakerFill", v1Config["settings-surround-sound"]);
        }

        if ("settings-accelerators" in v1Config) {
          if ("media-play-pause" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-play-pause"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.playPause", v1Config["settings-accelerators"]["media-play-pause"]);
            }
          }

          if ("media-track-next" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-next"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.next", v1Config["settings-accelerators"]["media-track-next"]);
            }
          }

          if ("media-track-previous" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-previous"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.previous", v1Config["settings-accelerators"]["media-track-previous"]);
            }
          }

          if ("media-track-like" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-like"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.thumbsUp", v1Config["settings-accelerators"]["media-track-like"]);
            }
          }

          if ("media-track-dislike" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-dislike"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.thumbsDown", v1Config["settings-accelerators"]["media-track-dislike"]);
            }
          }

          if ("media-volume-up" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-volume-up"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.volumeUp", v1Config["settings-accelerators"]["media-volume-up"]);
            }
          }

          if ("media-volume-down" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-volume-down"].toLowerCase() !== "disabled") {
              configStore.set("shortcuts.volumeDown", v1Config["settings-accelerators"]["media-volume-down"]);
            }
          }
        }

        if ("last-fm-login" in v1Config) {
          const usernameEmpty = v1Config["last-fm-login"]["username"] === null || v1Config["last-fm-login"]["username"].trim() === "";
          const passwordEmpty = v1Config["last-fm-login"]["password"] === null || v1Config["last-fm-login"]["password"].trim() === "";
          if (!usernameEmpty && !passwordEmpty) {
            configStore.set("integrations.lastFMEnabled", true);

            await dialog.showMessageBox({
              type: "info",
              message: "Last.fm",
              detail: "Last.fm configuration was found and has NOT been migrated. Re-authentication is required."
            });
          }
        }

        await dialog.showMessageBox({
          type: "info",
          message: "Settings migrated.",
          detail: "Your settings have been migrated."
        });
      }
    } catch (_) {
      await dialog.showMessageBox({
        type: "warning",
        message: "Settings not migrated!",
        detail: "Your settings could not be fully migrated."
      });
    }
  }
}
