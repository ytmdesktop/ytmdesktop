import playerStateStore, { PlayerState, Thumbnail, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema } from "~shared/store/schema";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityStatusDisplayType, DiscordActivityType } from "./minimal-discord-client/types";

const DISCORD_CLIENT_ID = "1143202598460076053";
const INITIAL_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 1000;
const CONNECTION_FAILED_TIMEOUT_MS = 30 * 1000;

function getHighestResThumbnail(thumbnails?: Thumbnail[]): string | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined;
  return thumbnails.reduce(
    (accumulator, current) => (current.height * current.width <= accumulator.height * accumulator.width ? accumulator : current),
    thumbnails[0]
  ).url;
}

function getSmallImageKey(state: VideoState | null) {
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

function getSmallImageText(state: VideoState | null) {
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
    return str.padEnd(minimum, "\u200b");
  }
  return str;
}

export default class DiscordPresence implements IIntegration {
  private memoryStore: MemoryStore<MemoryStoreSchema> | null = null;

  private discordClient: DiscordClient | null = null;
  private enabled = false;
  private ready = false;
  private activityDebounceTimeout: NodeJS.Timeout | null = null;
  private pauseTimeout: NodeJS.Timeout | null = null;
  private connectionRetryTimeout: NodeJS.Timeout | null = null;
  private connectionFailedTimeout: NodeJS.Timeout | null = null;
  private stateCallback: ((event: PlayerState) => void) | null = null;

  private videoState: VideoState | null = null;
  private videoDetails: Partial<VideoDetails> | null = null;
  private progress: number | null = null;

  private connectionRetries: number = 0;

  private UpdateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      if (!this.videoDetails || !this.discordClient) {
        this.discordClient?.clearActivity();
        this.activityDebounceTimeout = null;
        return;
      }
      const { title, author, album, id, thumbnails, durationSeconds, channelId, albumId } = this.videoDetails;
      const thumbnail = getHighestResThumbnail(thumbnails);
      this.discordClient.setActivity({
        type: DiscordActivityType.Listening,
        status_display_type: DiscordActivityStatusDisplayType.State,
        details: title ? stringLimit(title, 128, 2) : undefined,
        details_url: id ? `https://music.youtube.com/watch?v=${id}` : undefined,
        state: author ? stringLimit(author, 128, 2) : undefined,
        state_url: channelId ? `https://music.youtube.com/channel/${channelId}` : undefined,
        timestamps: {
          start: this.videoState === VideoState.Playing && this.progress !== null ? Date.now() - this.progress * 1000 : undefined,
          end:
            this.videoState === VideoState.Playing && durationSeconds !== undefined && this.progress !== null
              ? Date.now() + (durationSeconds - this.progress) * 1000
              : undefined
        },
        assets: {
          large_image: thumbnail && thumbnail.length <= 256 ? thumbnail : "ytmd-logo",
          large_text: album ? stringLimit(album, 128, 2) : undefined,
          large_url: albumId ? `https://music.youtube.com/browse/${albumId}` : undefined,
          small_image: getSmallImageKey(this.videoState),
          small_text: getSmallImageText(this.videoState)
        },
        instance: false,
        buttons: id
          ? [
              {
                label: "Play on YTMDesktop",
                url: `ytmd://play/${id}`
              }
            ]
          : undefined
      });
      this.activityDebounceTimeout = null;
    }, 1000);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.ready) return;

    const { videoDetails, videoProgress, trackState, hasFullMetadata } = state;
    if (!videoDetails) {
      this.videoState = null;
      this.videoDetails = null;
      this.progress = null;
      this.discordClient?.clearActivity();
      return;
    }
    const oldState = this.videoState ?? null;
    const oldId = this.videoDetails?.id ?? null;
    const oldProgress = this.progress;
    this.videoState = trackState;
    this.videoDetails = videoDetails;
    this.progress = Math.floor(videoProgress);
    if (
      hasFullMetadata &&
      (oldState !== this.videoState ||
        oldId !== this.videoDetails.id ||
        oldProgress === null ||
        Math.abs(this.progress - oldProgress) > 1 ||
        oldProgress > this.progress)
    ) {
      this.UpdateActivity();
    }

    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }
    if (state.trackState === VideoState.Playing) return;
    this.pauseTimeout = setTimeout(() => {
      if (!this.discordClient || !this.ready) {
        this.pauseTimeout = null;
        return;
      }
      this.discordClient.clearActivity();
      this.pauseTimeout = null;
    }, 30 * 1000);
  }

  public provide(memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.memoryStore = memoryStore;
  }

  private retryDiscordConnection() {
    if (!this.enabled) return;

    if (!this.connectionFailedTimeout && !this.ready) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.ready && this.enabled) {
          this.memoryStore?.set("discordPresenceConnectionFailed", true);
        }
        this.connectionFailedTimeout = null;
      }, CONNECTION_FAILED_TIMEOUT_MS);
    }

    this.connectionRetries++;
    const retryDelay = Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, Math.min(this.connectionRetries - 1, 10)), MAX_RETRY_DELAY_MS);
    log.info(`Connecting to Discord attempt ${this.connectionRetries} (retrying in ${retryDelay / 1000}s)`);

    if (this.connectionRetryTimeout) {
      clearTimeout(this.connectionRetryTimeout);
    }
    this.connectionRetryTimeout = setTimeout(() => {
      if (!this.discordClient) return;
      this.discordClient.connect().catch(() => this.retryDiscordConnection());
    }, retryDelay);
  }

  public enable(): void {
    this.enabled = true;
    this.memoryStore?.set("discordPresenceConnectionFailed", false);

    if (!this.connectionFailedTimeout && !this.ready) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.ready && this.enabled) {
          this.memoryStore?.set("discordPresenceConnectionFailed", true);
        }
        this.connectionFailedTimeout = null;
      }, CONNECTION_FAILED_TIMEOUT_MS);
    }

    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.ready = true;
      this.connectionRetries = 0;
      if (this.connectionFailedTimeout) {
        clearTimeout(this.connectionFailedTimeout);
        this.connectionFailedTimeout = null;
      }
      this.memoryStore?.set("discordPresenceConnectionFailed", false);
      this.playerStateChanged(playerStateStore.getState());
    });
    this.discordClient.on("close", () => {
      log.info("Discord connection closed");
      this.ready = false;
      this.videoState = null;
      this.videoDetails = null;
      this.progress = null;
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
    this.memoryStore?.set("discordPresenceConnectionFailed", false);

    if (this.activityDebounceTimeout) {
      clearTimeout(this.activityDebounceTimeout);
      this.activityDebounceTimeout = null;
    }
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }
    if (this.connectionRetryTimeout) {
      clearTimeout(this.connectionRetryTimeout);
      this.connectionRetryTimeout = null;
    }
    if (this.connectionFailedTimeout) {
      clearTimeout(this.connectionFailedTimeout);
      this.connectionFailedTimeout = null;
    }

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }

    if (!this.discordClient) return;
    this.ready = false;
    this.videoState = null;
    this.videoDetails = null;
    this.progress = null;
    this.discordClient.destroy();
    this.discordClient = null;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
