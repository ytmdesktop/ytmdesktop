import PlayerStateStore from "../../services/playerstatestore";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityStatusDisplayType, DiscordActivityType } from "./minimal-discord-client/types";
import Integration from "../integration";
import MemoryStore from "../../services/memorystore";
import { MemoryStoreSchema } from "~shared/store/schema";
import { PlayerState, Thumbnail, VideoDetails, VideoState } from "~shared/playerstatestore/types";

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

export default class DiscordPresence extends Integration {
  public name = "DiscordPresence";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.discordPresenceEnabled";
  public override disableFlags = ["disable_discord_presence"];

  private discordClient: DiscordClient | null = null;
  private ready = false;
  private activityDebounceTimeout: NodeJS.Timeout | string | number | undefined = undefined;
  private pauseTimeout: NodeJS.Timeout | string | number | undefined = undefined;
  private connectionRetryTimeout: NodeJS.Timeout | string | number | undefined = undefined;
  private connectionFailedTimeout: NodeJS.Timeout | string | number | undefined = undefined;
  private stateCallback: ((event: PlayerState) => void) | null = null;

  private videoState: VideoState = VideoState.Unknown;
  private videoDetails: VideoDetails | null = null;
  private progress: number = 0;

  private connectionRetries: number = 0;

  private updateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      if (!this.videoDetails || !this.discordClient) {
        this.discordClient?.clearActivity();
        this.activityDebounceTimeout = undefined;
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
      this.activityDebounceTimeout = undefined;
    }, 1000);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.ready) return;

    const { videoDetails, videoProgress, trackState, hasFullMetadata } = state;
    if (!videoDetails) {
      this.videoState = VideoState.Unknown;
      this.videoDetails = null;
      this.progress = 0;
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
      this.updateActivity();
    }

    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = undefined;
    }
    if (state.trackState === VideoState.Playing) return;
    this.pauseTimeout = setTimeout(() => {
      if (!this.discordClient || !this.ready) {
        this.pauseTimeout = undefined;
        return;
      }
      this.discordClient.clearActivity();
      this.pauseTimeout = undefined;
    }, 30 * 1000);
  }

  private retryDiscordConnection() {
    if (!this.isEnabled) return;

    if (!this.connectionFailedTimeout && !this.ready) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.ready && this.isEnabled) {
          const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
          memoryStore.set("discordPresenceConnectionFailed", true);
        }
        this.connectionFailedTimeout = undefined;
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

  public onSetup() {}

  public onEnabled(): void {
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("discordPresenceConnectionFailed", false);

    if (!this.connectionFailedTimeout && !this.ready) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.ready && this.isEnabled) {
          memoryStore.set("discordPresenceConnectionFailed", true);
        }
        this.connectionFailedTimeout = undefined;
      }, CONNECTION_FAILED_TIMEOUT_MS);
    }

    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.ready = true;
      this.connectionRetries = 0;
      if (this.connectionFailedTimeout) {
        clearTimeout(this.connectionFailedTimeout);
        this.connectionFailedTimeout = undefined;
      }
      const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
      memoryStore.set("discordPresenceConnectionFailed", false);
      const playerStateStore = this.getService(PlayerStateStore);
      this.playerStateChanged(playerStateStore.getState());
    });
    this.discordClient.on("close", () => {
      log.info("Discord connection closed");
      this.ready = false;
      this.videoState = VideoState.Unknown;
      this.videoDetails = null;
      this.progress = 0;
      this.retryDiscordConnection();
    });
    this.discordClient.connect().catch(() => this.retryDiscordConnection());
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };

    const playerStateStore = this.getService(PlayerStateStore);
    playerStateStore.on("state-changed", this.stateCallback);
  }

  public onDisabled(): void {
    this.connectionRetries = 0;
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("discordPresenceConnectionFailed", false);

    if (this.activityDebounceTimeout) {
      clearTimeout(this.activityDebounceTimeout);
      this.activityDebounceTimeout = undefined;
    }
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = undefined;
    }
    if (this.connectionRetryTimeout) {
      clearTimeout(this.connectionRetryTimeout);
      this.connectionRetryTimeout = undefined;
    }
    if (this.connectionFailedTimeout) {
      clearTimeout(this.connectionFailedTimeout);
      this.connectionFailedTimeout = undefined;
    }

    if (this.stateCallback) {
      const playerStateStore = this.getService(PlayerStateStore);
      playerStateStore.off("state-changed", this.stateCallback);
    }

    if (!this.discordClient) return;
    this.ready = false;
    this.videoState = VideoState.Unknown;
    this.videoDetails = null;
    this.progress = 0;
    this.discordClient.destroy();
    this.discordClient = null;
  }
}
