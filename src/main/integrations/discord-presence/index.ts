import playerStateStore from "../../player-state-store";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";
import Integration from "../integration";
import MemoryStore from "../../services/memorystore";
import { MemoryStoreSchema } from "~shared/store/schema";
import { PlayerState, Thumbnail, VideoDetails, VideoState } from "~shared/playerstatestore/types";

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

export default class DiscordPresence extends Integration {
  public name = "DiscordPresence";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.discordPresenceEnabled";

  private discordClient: DiscordClient = null;
  private ready = false;
  private activityDebounceTimeout: NodeJS.Timeout | null = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private stateCallback: (event: PlayerState) => void = null;

  private videoState: VideoState | null = null;
  private videoDetails: Partial<VideoDetails> | null = null;
  private progress: number | null = null;

  private connectionRetries: number = 0;

  private updateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      if (!this.videoDetails) {
        this.discordClient.clearActivity();
        return;
      }
      const { title, author, album, id, thumbnails, durationSeconds, channelId, albumId } = this.videoDetails;
      const thumbnail = getHighestResThumbnail(thumbnails);
      this.discordClient.setActivity({
        type: DiscordActivityType.Listening,
        status_display_type: 1,
        details: stringLimit(title, 128, 2),
        details_url: `https://music.youtube.com/watch?v=${id}`,
        state: stringLimit(author, 128, 2),
        state_url: `https://music.youtube.com/channel/${channelId}`,
        timestamps: {
          start: this.videoState === VideoState.Playing ? Date.now() - this.progress * 1000 : undefined,
          end: this.videoState === VideoState.Playing ? Date.now() + (durationSeconds - this.progress) * 1000 : undefined
        },
        assets: {
          large_image: (thumbnail?.length ?? 0) <= 256 ? thumbnail : "ytmd-logo",
          large_text: album ? stringLimit(album, 128, 2) : undefined,
          large_url: `https://music.youtube.com/browse/${albumId}`,
          small_image: getSmallImageKey(this.videoState),
          small_text: getSmallImageText(this.videoState)
        },
        instance: false,
        buttons: [
          {
            label: "Play on YTMDesktop",
            url: `ytmd://play/${id}`
          }
        ]
      });
      this.activityDebounceTimeout = null;
    }, 1000);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.ready) return;

    const { videoDetails, videoProgress, trackState, hasFullMetadata } = state;
    if (!videoDetails) {
      this.discordClient.clearActivity();
      return;
    }
    const oldState = this.videoState ?? null;
    const oldId = this.videoDetails?.id ?? null;
    const oldProgress = this.progress ?? null;
    this.videoState = trackState;
    this.videoDetails = videoDetails;
    this.progress = Math.floor(videoProgress);
    if (
      hasFullMetadata &&
      (oldState !== this.videoState || oldId !== this.videoDetails.id || Math.abs(this.progress - oldProgress) > 1 || oldProgress > this.progress)
    ) {
      this.updateActivity();
    }

    clearTimeout(this.pauseTimeout);
    this.pauseTimeout = null;
    if (state.trackState == VideoState.Playing) return;
    this.pauseTimeout = setTimeout(() => {
      if (!this.discordClient && !this.ready) return;
      this.discordClient.clearActivity();
      this.pauseTimeout = null;
    }, 30 * 1000);
  }

  private retryDiscordConnection() {
    if (!this.isEnabled) return;
    if (this.connectionRetries >= 30) {
      const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
      memoryStore.set("discordPresenceConnectionFailed", true);
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

  public onSetup() {}

  public onEnabled(): void {
    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.ready = true;
      this.connectionRetries = 0;
      const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
      memoryStore.set("discordPresenceConnectionFailed", false);
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

  public onDisabled(): void {
    this.connectionRetries = 0;
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("discordPresenceConnectionFailed", false);

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
}
