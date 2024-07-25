import playerStateStore, { PlayerState, Thumbnail, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema } from "~shared/store/schema";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";

const DISCORD_CLIENT_ID = "1143202598460076053";

interface VideoDetails {
  title: string;
  author: string;
  album?: string; // Optional
  id: string;
  trackState: VideoState;
  thumbnail?: string; // Optional
  progress: number;
  duration: number;
}
// More appropriate name
function getBestThumbnail(thumbnails: Thumbnail[]) {
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
// Simplify these, when buffering it will just show as being paused
function getSmallImageKey(state: number) {
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

function getSmallImageText(state: number) {
  switch (state) {
    case VideoState.Playing: {
      return "Playing";
    }

    default: {
      return "Paused";
    }
  }
}

function removeTrailingSpace(str: string) {
  return str.endsWith(' ') ? str.slice(0, -1) : str;
}

function stringLimit(str: string, limit: number, minimum: number) {
  if (str.length > limit) {
    return removeTrailingSpace(str.substring(0, limit - 3)) + "...";
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
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private stateCallback: (event: PlayerState) => void = null;

  private videoDetails: VideoDetails | null = null;

  private connectionRetries: number = 0;

  private setActivity() {
    const { title, author, album, id, thumbnail, progress, duration, trackState } = this.videoDetails;

    this.discordClient.setActivity({
      type: DiscordActivityType.Listening,
      details: stringLimit(title, 128, 2),
      state: stringLimit(author, 128, 2),
      timestamps: {
        end: trackState === VideoState.Playing ? Date.now() + ((duration - progress) * 1000) : undefined
      },
      assets: {
        large_image: (thumbnail?.length ?? 0) <= 256 ? thumbnail : "ytmd-logo",
        large_text: stringLimit(album ?? "", 128, 2),
        small_image: getSmallImageKey(trackState),
        small_text: getSmallImageText(trackState)
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
  }

  private playerStateChanged(state: PlayerState) {
    if (this.ready && state.videoDetails) {
      const oldTitle = this.videoDetails ? this.videoDetails.title : null
      const oldProgress = this.videoDetails ? this.videoDetails.progress : 0;

      this.videoDetails = {
        title: state.videoDetails.title,
        author: state.videoDetails.author,
        album: state.videoDetails.album,
        id: state.videoDetails.id,
        thumbnail: getBestThumbnail(state.videoDetails.thumbnails),
        progress: Math.floor(state.videoProgress),
        duration: state.videoDetails.durationSeconds,
        trackState: state.trackState
      };
      
      if (oldTitle !== this.videoDetails.title || Math.abs(oldProgress - this.videoDetails.progress) > 5 ) {
        this.setActivity();
      }

      if (state.trackState === VideoState.Buffering || state.trackState === VideoState.Paused || state.trackState === VideoState.Unknown) {
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
    log.info(`Connecting to Discord attempt ${this.connectionRetries}/30`);
    if (this.enabled) {
      if (this.connectionRetries < 30) {
        this.connectionRetries++;
        this.connectionRetryTimeout = setTimeout(() => {
          if (this.discordClient) {
            this.discordClient.connect().catch(() => this.retryDiscordConnection());
          }
        }, 5 * 1000);
      } else {
        this.memoryStore.set("discordPresenceConnectionFailed", true);
      }
    }
  }

  public enable(): void {
    this.enabled = true;
    if (!this.discordClient) {
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
      this.discordClient.destroy();
      this.discordClient = null;
    }
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
