import playerStateStore, { PlayerState, Thumbnail, VideoState, VideoDetails } from "../../player-state-store";
import IIntegration from "../integration";
import Conf from "conf";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { Unsubscribe } from "conf/dist/source/types";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";

const DISCORD_CLIENT_ID = "1143202598460076053";

function getBestThumbnail(thumbnails: Thumbnail[]): string {
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
  private store: Conf<StoreSchema>;

  private storeListener: Unsubscribe | null = null;

  private discordClient: DiscordClient = null;
  private enabled = false;
  private ready = false;
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private stateCallback: (event: PlayerState) => void = null;

  private videoDetails: Partial<VideoDetails> | null = null;
  private videoState: VideoState | null = null;
  private progress: number | null = null;

  private connectionRetries: number = 0;

  private setActivity() {
    if (!this.videoDetails) {
      this.discordClient.clearActivity();
      return;
    }
    const { title, author, album, id, thumbnails, durationSeconds } = this.videoDetails;
    const thumbnail: string | null = getBestThumbnail(thumbnails);

    this.discordClient.setActivity({
      type: this.store.get("integrations").discordPresenceListening ? DiscordActivityType.Listening : DiscordActivityType.Game,
      details: stringLimit(title, 128, 2),
      state: stringLimit(author, 128, 2),
      timestamps: {
        start: this.videoState === VideoState.Playing ? Date.now() - this.progress * 1000 : undefined,
        end: this.videoState === VideoState.Playing ? Date.now() + (durationSeconds - this.progress) * 1000 : undefined
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
  }

  private playerStateChanged(state: PlayerState) {
    if (this.ready && state.videoDetails) {
      const oldState = this.videoState ?? null;
      const oldProgress = this.progress ?? null;
      const oldId = this.videoDetails?.id ?? null;

      this.videoDetails = {
        title: state.videoDetails.title,
        author: state.videoDetails.author,
        album: state.videoDetails.album,
        id: state.videoDetails.id,
        thumbnails: state.videoDetails.thumbnails,
        durationSeconds: state.videoDetails.durationSeconds
      };
      this.progress = Math.floor(state.videoProgress);
      this.videoState = state.trackState;

      if (
        this.videoDetails &&
        this.videoDetails.id &&
        (oldState !== this.videoState || this.progress - oldProgress > 1 || oldProgress > this.progress || oldId !== this.videoDetails.id)
      )
        this.setActivity();

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

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
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
      if (this.storeListener) {
        this.storeListener();
        this.storeListener = null;
      }
      this.storeListener = this.store.onDidChange("integrations", (oldState, newState) => {
        if (oldState.discordPresenceListening !== newState.discordPresenceListening) {
          this.setActivity();
        }
      });
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
    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
