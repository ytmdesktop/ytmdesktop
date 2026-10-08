import {
  Notification,
  NotificationConstructorOptions,
  nativeImage,
} from "electron";
import https from "https";
import Integration from "../integration";
import {
  PlayerState,
  Thumbnail,
  VideoDetails,
  VideoState,
} from "~shared/playerstatestore/types";
import PlayerStateStore from "../../services/playerstatestore";

// Visualiser - https://apps.microsoft.com/store/detail/notifications-visualizer/9NBLGGH5XSL1?hl=en-gb&gl=gb&rtc=1
// Documentation / Examples - https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts?tabs=xml

function getLowestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 1024;
  let currentHeight = 1024;
  let url: string | null = null;
  for (const thumbnail of thumbnails) {
    // If the thumbnail is smaller than the current one, but bigger than 100x100
    if (
      thumbnail.width < currentWidth &&
      thumbnail.height < currentHeight &&
      thumbnail.width > 100 &&
      thumbnail.height > 100
    ) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

function displayNotification(
  videoDetails: VideoDetails,
  imageData: string | null,
) {
  const notificationData: NotificationConstructorOptions = {
    title: videoDetails.title,
    body: videoDetails.author,
    silent: true,
    urgency: "low", // Linux only
  };

  if (imageData !== null) {
    const notificationImage = nativeImage.createFromDataURL(
      "data:image/jpeg;base64," + imageData,
    );

    notificationData.icon = notificationImage;
  }

  const notification = new Notification(notificationData);
  notification.show();
  setTimeout(() => {
    notification.close();
  }, 5 * 1000);
}

/**
 *
 * @param url
 * @returns Promise<string>
 */
function getUrlContents(url: string) {
  return new Promise<string>((resolve, reject) => {
    const request = https.get(url, (res) => {
      const data: Array<Buffer> = [];
      res.on("data", (chunk) => {
        data.push(chunk);
      });

      res.on("end", () => {
        resolve(Buffer.concat(data).toString("base64"));
      });
      res.on("error", (err) => {
        reject(err);
      });
    });

    request.on("error", function (e) {
      reject(e);
    });
  });
}

export default class NowPlayingNotifications extends Integration {
  public name = "NowPlayingNotifications";
  public storeEnableProperty: Integration["storeEnableProperty"] =
    "general.showNotificationOnSongChange";
  public override disableFlags = ["disable_now_playing_notifications"];

  private lastDetails: VideoDetails | null = null;
  private playerStateFunction: ((state: PlayerState) => void) | null = null;

  private async updateVideoDetails(state: PlayerState): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    if (state.videoDetails && state.trackState === VideoState.Playing) {
      if (this.lastDetails && this.lastDetails.id === state.videoDetails.id) {
        return;
      }

      this.lastDetails = state.videoDetails;

      if (
        state.videoDetails.thumbnails &&
        state.videoDetails.thumbnails.length > 0
      ) {
        const thumbnailUrl = getLowestResThumbnail(
          state.videoDetails.thumbnails,
        );
        if (thumbnailUrl) {
          try {
            let data = await getUrlContents(thumbnailUrl);
            displayNotification(state.videoDetails, data);
          } catch(err) {
            displayNotification(state.videoDetails, null);
          }
        } else {
          displayNotification(state.videoDetails, null);
        }
      } else {
        displayNotification(state.videoDetails, null);
      }
    }
  }

  public onSetup() {}

  public onEnabled() {
    this.playerStateFunction = (state: PlayerState) =>
      this.updateVideoDetails(state);

    const playerStateStore = this.getService(PlayerStateStore);
    playerStateStore.on("state-changed", this.playerStateFunction);
  }

  public onDisabled(): void {
    const playerStateStore = this.getService(PlayerStateStore);
    if (this.playerStateFunction) playerStateStore.off("state-changed", this.playerStateFunction);
  }
}
