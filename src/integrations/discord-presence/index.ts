import DiscordRPC from "discord-rpc";
import playerStateStore, { PlayerState, Thumbnail, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema } from "../../shared/store/schema";

const DISCORD_CLIENT_ID = "1143202598460076053";

function getHighestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 0;
  let currentHeight = 0;
  let url = null;
  for (const thumbnail of thumbnails) {
    if (thumbnail.width > currentWidth && thumbnail.height > currentHeight) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

function getSmallImageKey(state: number) {
  // Developer Note:
  // You can add "-invert" to the end of the image key to invert (Black with White Border)
  switch (state) {
    case VideoState.Playing: {
      return "play-border";
    }

    case VideoState.Paused: {
      return "pause-border";
    }

    case VideoState.Buffering: {
      return "play-outline-border";
    }

    default: {
      return "pause-border";
    }
  }
}

function getSmallImageText(state: number) {
  switch (state) {
    case VideoState.Playing: {
      return "Playing";
    }

    case VideoState.Paused: {
      return "Paused";
    }

    case VideoState.Buffering: {
      return "Buffering";
    }

    default: {
      return "Unknown";
    }
  }
}

function stringLimit(str: string, limit: number) {
  if (str.length > limit) {
    return str.substring(0, limit - 3) + "...";
  }
  return str;
}

export default class DiscordPresence implements IIntegration {
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private discordClient: DiscordRPC.Client = null;
  private enabled = false;
  private ready = false;
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private endTimestamp: number | null = null;
  private stateCallback: (event: PlayerState) => void = null;
  
  private lastTimeSeconds: number | null = null;
  private lastDuration: number | null = null;

  private connectionRetries: number = 0;

  private playerStateChanged(state: PlayerState) {
    if (this.ready && state.videoDetails) {
      const date = Date.now();
      const timeSeconds = Math.floor(date / 1000);
      const videoProgress = Math.floor(state.videoProgress);
      const duration = state.videoDetails.durationSeconds - videoProgress;

      let adjustedTimeSeconds = timeSeconds;

      if (!this.lastTimeSeconds) this.lastTimeSeconds = timeSeconds;
      if (!this.lastDuration) this.lastDuration = duration;
      if (timeSeconds - this.lastTimeSeconds > 0) {
        if (this.lastDuration === duration) {
          // The time changed seconds but the duration hasn't. We use the old timestamp to prevent weird deviations
          adjustedTimeSeconds = this.lastTimeSeconds;
        } else {
          this.lastDuration = duration;
          this.lastTimeSeconds = timeSeconds;
        }
      } else {
        this.lastDuration = duration;
        this.lastTimeSeconds = timeSeconds;
      }

      this.endTimestamp = state.trackState === VideoState.Playing ? adjustedTimeSeconds + (state.videoDetails.durationSeconds - videoProgress) : undefined;

      const thumbnail = getHighestResThumbnail(state.videoDetails.thumbnails);
      this.discordClient.setActivity({
        details: stringLimit(state.videoDetails.title, 128),
        state: stringLimit(state.videoDetails.author, 128),
        largeImageKey: thumbnail,
        largeImageText: stringLimit(state.videoDetails.title, 128),
        smallImageKey: getSmallImageKey(state.trackState),
        smallImageText: getSmallImageText(state.trackState),
        instance: false,
        endTimestamp: state.trackState === VideoState.Playing ? this.endTimestamp : undefined,
        buttons: [
          {
            label: "Play on YouTube Music",
            url: `https://music.youtube.com/watch?v=${state.videoDetails.id}`
          },
          {
            label: "Play on YouTube Music Desktop",
            url: `ytmd://play/${state.videoDetails.id}`
          }
        ]
      });

      if (state.trackState === VideoState.Buffering || state.trackState === VideoState.Paused) {
        if (this.pauseTimeout) {
          clearTimeout(this.pauseTimeout);
          this.pauseTimeout = null;
        }

        this.pauseTimeout = setTimeout(() => {
          if (this.discordClient && this.ready) {
            this.discordClient.clearActivity();
          }
          this.pauseTimeout = null;
        }, 30 * 1000);
      } else {
        if (this.pauseTimeout) {
          clearTimeout(this.pauseTimeout);
          this.pauseTimeout = null;
        }
      }
    } else if (this.ready && !state.videoDetails) {
      this.discordClient.clearActivity();
    }
  }

  public provide(memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.memoryStore = memoryStore;
  }

  private retryDiscordConnection() {
    if (this.enabled) {
      if (this.connectionRetries < 30) {
        this.connectionRetries++;
        this.connectionRetryTimeout = setTimeout(() => {
          if (this.discordClient) {
            this.discordClient.connect(DISCORD_CLIENT_ID).catch(() => this.retryDiscordConnection());
          }
        }, 5 * 50);
      } else {
        this.memoryStore.set("discordPresenceConnectionFailed", true);
      }
    }
  }

  public enable(): void {
    this.enabled = true;
    if (!this.discordClient) {
      this.discordClient = new DiscordRPC.Client({
        transport: "ipc"
      });
      this.discordClient.on("connected", () => {
        this.ready = true;
        this.connectionRetries = 0;
        this.memoryStore.set("discordPresenceConnectionFailed", false);
      });
      this.discordClient.on("disconnected", () => {
        this.ready = false;
        this.retryDiscordConnection();
      });
      this.discordClient.connect(DISCORD_CLIENT_ID).catch(() => this.retryDiscordConnection());
      this.stateCallback = event => {
        this.playerStateChanged(event);
      };
      playerStateStore.addEventListener(this.stateCallback);
    }
  }

  public disable(): void {
    this.enabled = false;
    this.connectionRetries = 0;
    this.memoryStore.set("discordPresenceConnectionFailed", false);
    if (this.connectionRetryTimeout) {
      clearTimeout(this.connectionRetryTimeout);
      this.connectionRetryTimeout = null;
    }
    if (this.discordClient) {
      this.ready = false;
      this.discordClient.destroy().catch(() => {});
      this.discordClient = null;
    }
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }
}
