import { Notification, NotificationConstructorOptions, nativeImage } from "electron";
import { PlayerState, Thumbnail, VideoDetails, VideoState } from "../../player-state-store";
import BaseIntegration from "../base-integration";
import https from "https";
import log from "electron-log";

// Visualiser - https://apps.microsoft.com/store/detail/notifications-visualizer/9NBLGGH5XSL1?hl=en-gb&gl=gb&rtc=1
// Documentation / Examples - https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts?tabs=xml

function getLowestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 1024;
  let currentHeight = 1024;
  let url = null;

  if (!thumbnails || !Array.isArray(thumbnails)) {
    return null;
  }

  for (const thumbnail of thumbnails) {
    // If the thumbnail is smaller than the current one, but bigger than 100x100
    if (thumbnail && thumbnail.width < currentWidth && thumbnail.height < currentHeight && thumbnail.width > 100 && thumbnail.height > 100) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

function displayNotification(videoDetails: VideoDetails, imageData: string) {
  try {
    if (!videoDetails) {
      log.warn("Attempted to display notification with null videoDetails");
      return;
    }

    const notificationData: NotificationConstructorOptions = {
      title: videoDetails.title || "Unknown Title",
      body: videoDetails.author || "Unknown Artist",
      silent: true,
      urgency: "low" // Linux only
    };

    if (imageData !== null) {
      try {
        const notificationImage = nativeImage.createFromDataURL("data:image/jpeg;base64," + imageData);
        notificationData.icon = notificationImage;
      } catch (error) {
        log.error("Error creating notification image:", error);
      }
    }

    const notification = new Notification(notificationData);
    notification.show();
    setTimeout(() => {
      notification.close();
    }, 5 * 1000);
  } catch (error) {
    log.error("Error displaying notification:", error);
  }
}

/**
 * Fetches an image from a URL and returns it as a base64 encoded string
 * @param url URL of the image to fetch
 * @returns Promise<string> Base64 encoded image data
 */
function getUrlContents(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("Invalid URL"));
      return;
    }

    const request = https.get(url, res => {
      const data: Array<Buffer> = [];

      res.on("data", chunk => {
        data.push(chunk);
      });

      res.on("end", () => {
        try {
          resolve(Buffer.concat(data).toString("base64"));
        } catch (error) {
          reject(error);
        }
      });

      res.on("error", err => {
        reject(err);
      });
    });

    request.on("error", function (e) {
      reject(e);
    });

    // Set a timeout to avoid hanging requests
    request.setTimeout(5000, () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

export default class NowPlayingNotifications extends BaseIntegration {
  private lastDetails: VideoDetails = null;

  private async updateVideoDetails(state: PlayerState): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      // Make sure we have valid videoDetails and the track is playing
      if (state?.videoDetails && state.trackState === VideoState.Playing && state.videoDetails.id) {
        // Skip if this is the same track
        if (this.lastDetails && this.lastDetails.id === state.videoDetails.id) {
          return;
        }

        this.lastDetails = state.videoDetails;

        if (state.videoDetails.thumbnails && Array.isArray(state.videoDetails.thumbnails) && state.videoDetails.thumbnails.length > 0) {
          try {
            const thumbnailUrl = getLowestResThumbnail(state.videoDetails.thumbnails);
            if (thumbnailUrl) {
              const data = await getUrlContents(thumbnailUrl);
              displayNotification(state.videoDetails, data);
            } else {
              displayNotification(state.videoDetails, null);
            }
          } catch (error) {
            log.error(`Error getting thumbnail:`, error);
            displayNotification(state.videoDetails, null);
          }
        } else {
          displayNotification(state.videoDetails, null);
        }
      }
    } catch (error) {
      log.error(`Error in notifications updateVideoDetails:`, error);
    }
  }

  public provide(): void {
    // No implementation needed
  }

  public enable(): void {
    if (this.isEnabled) {
      return;
    }

    this.isEnabled = true;
    this.registerPlayerStateListener((state: PlayerState) => this.updateVideoDetails(state));
    log.info("Notifications integration enabled");
  }

  public override disable(): void {
    if (!this.isEnabled) {
      return;
    }

    // Let the base class handle the event listener cleanup
    super.disable();
    log.info("Notifications integration disabled");
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
