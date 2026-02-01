import playerStateStore, { PlayerState, Thumbnail, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema } from "~shared/store/schema";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";

const DISCORD_CLIENT_ID = "1143202598460076053";

function getHighestResThumbnail(thumbnails: Thumbnail[]): string {
  return thumbnails.reduce(
    (accumulator, current) => (current.height * current.width <= accumulator.height * accumulator.width ? accumulator : current),
    thumbnails[0]
  ).url;
}

function getSmallImageKey(state: VideoState) {
  // Developer Note:
  // You can add "-invert" to the end of the image key to invert (Black with White Border)
  switch (state) {
    case VideoState.Playing: {
      return "play-border";
    }
    default: {
      return "pause-border";
    }
  }
}

function getSmallImageText(state: VideoState) {
  switch (state) {
    case VideoState.Playing: {
      return "Playing";
    }
    default: {
      return "Paused";
    }
  }
}

function stringLimit(str: string, limit: number, minimum: number) {
  if (str.length > limit) {
    return str.substring(0, limit - 3).trim() + "...";
  }
  if (str.length < minimum) {
    return str.padEnd(minimum, "​"); // There's a zero width space here
  }
  return str;
}

export default class DiscordPresence implements IIntegration {
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private discordClient: DiscordClient = null;
  private enabled = false;
  private ready = false;
  private activityDebounceTimeout: NodeJS.Timeout | null = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private stateCallback: (event: PlayerState) => void = null;

  private videoState: VideoState | null = null;
  private videoDetails: Partial<VideoDetails> | null = null;
  private progress: number | null = null;

  private connectionRetries: number = 0;

  private UpdateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      try {
        if (!this.videoDetails || !this.discordClient) {
          if (this.discordClient) {
            this.discordClient.clearActivity();
          }
          this.activityDebounceTimeout = null;
          return;
        }

        const { title, author, album, id, thumbnails, durationSeconds } = this.videoDetails;
        if (!thumbnails || !title || !author || !id) {
          this.discordClient.clearActivity();
          this.activityDebounceTimeout = null;
          return;
        }

        const thumbnail = thumbnails && thumbnails.length > 0 ? getHighestResThumbnail(thumbnails) : null;
        this.discordClient.setActivity({
          type: DiscordActivityType.Listening,
          details: stringLimit(title, 128, 2),
          state: stringLimit(author, 128, 2),
          timestamps: {
            start: this.videoState === VideoState.Playing ? Date.now() - (this.progress || 0) * 1000 : undefined,
            end: this.videoState === VideoState.Playing && durationSeconds ? Date.now() + (durationSeconds - (this.progress || 0)) * 1000 : undefined
          },
          assets: {
            large_image: (thumbnail?.length ?? 0) <= 256 ? thumbnail : "ytmd-logo",
            large_text: album ? stringLimit(album, 128, 2) : undefined,
            small_image: getSmallImageKey(this.videoState),
            small_text: getSmallImageText(this.videoState)
          },
          instance: false,
          buttons: [
            {
              label: "Play on YouTube Music",
              url: `https://music.youtube.com/watch?v=${id}`
            },
            {
              label: "Play on YouTube Music Desktop",
              url: `ytmd://play/${id}`
            }
          ]
        });
      } catch (error) {
        log.error(`Error in Discord Presence UpdateActivity: ${error.message || "Unknown error"}`);
        if (this.discordClient) {
          this.discordClient.clearActivity();
        }
      }

      this.activityDebounceTimeout = null;
    }, 1000);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.ready) return;

    try {
      const { videoDetails, videoProgress, trackState, hasFullMetadata } = state || {};
      if (!videoDetails) {
        this.discordClient.clearActivity();
        return;
      }

      const oldState = this.videoState ?? null;
      const oldId = this.videoDetails?.id ?? null;
      const oldProgress = this.progress ?? null;

      this.videoState = trackState;
      this.videoDetails = videoDetails;
      this.progress = Math.floor(videoProgress || 0);

      if (
        hasFullMetadata &&
        (oldState !== this.videoState ||
          oldId !== this.videoDetails?.id ||
          Math.abs((this.progress || 0) - (oldProgress || 0)) > 1 ||
          (oldProgress || 0) > (this.progress || 0))
      ) {
        this.UpdateActivity();
      }

      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
      if (state.trackState == VideoState.Playing) return;
      this.pauseTimeout = setTimeout(() => {
        if (!this.discordClient && !this.ready) return;
        this.discordClient.clearActivity();
        this.pauseTimeout = null;
      }, 30 * 1000);
    } catch (error) {
      log.error(`Error in Discord Presence playerStateChanged: ${error.message || "Unknown error"}`);
    }
  }

  public provide(memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.memoryStore = memoryStore;
  }

  private retryDiscordConnection() {
    if (!this.enabled) return;
    if (this.connectionRetries >= 30) {
      this.memoryStore.set("discordPresenceConnectionFailed", true);
      return;
    }

    this.connectionRetries++;
    log.info(`Connecting to Discord attempt ${this.connectionRetries}/30`);

    clearTimeout(this.connectionRetryTimeout);
    this.connectionRetryTimeout = setTimeout(() => {
      if (!this.discordClient) return;
      this.discordClient.connect().catch(() => this.retryDiscordConnection());
    }, 5 * 1000);
  }

  public enable(): void {
    this.enabled = true;
    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.ready = true;
      this.connectionRetries = 0;
      this.memoryStore.set("discordPresenceConnectionFailed", false);
    });
    this.discordClient.on("close", () => {
      log.info("Discord connection closed");
      this.ready = false;
      this.retryDiscordConnection();
    });
    this.discordClient.connect().catch(() => this.retryDiscordConnection());
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };

    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    this.enabled = false;
    this.connectionRetries = 0;
    this.memoryStore.set("discordPresenceConnectionFailed", false);

    clearTimeout(this.activityDebounceTimeout);
    clearTimeout(this.pauseTimeout);
    clearTimeout(this.connectionRetryTimeout);
    this.activityDebounceTimeout = this.pauseTimeout = this.connectionRetryTimeout = null;

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }

    if (!this.discordClient) return;
    this.ready = false;
    this.discordClient.destroy();
    this.discordClient = null;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
