import DiscordRPC from "discord-rpc";
import playerStateStore, { PlayerState, Thumbnail } from "../../player-state-store";
import IIntegration from "../integration";

const DISCORD_CLIENT_ID = "495666957501071390";

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
  switch (state) {
    case 1: {
      return "discordrpc-play";
    }

    case 2: {
      return "discordrpc-pause";
    }

    case 3: {
      return "discordrpc-play";
    }

    default: {
      return "discordrpc-pause";
    }
  }
}

function getSmallImageText(state: number) {
  switch (state) {
    case 1: {
      return "Playing";
    }

    case 2: {
      return "Paused";
    }

    case 3: {
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
  private discordClient: DiscordRPC.Client = null;
  private ready = false;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private previousProgress: number | null = null;
  private endTimestamp: number | null = null;

  private playerStateChanged(state: PlayerState) {
    if (this.ready && state.videoDetails) {
      if (!this.previousProgress) {
        this.endTimestamp =
          state.trackState === 1 ? Math.floor(Date.now() / 1000) + (state.videoDetails.durationSeconds - Math.round(state.videoProgress)) : undefined;
        this.previousProgress = state.videoProgress;
      }

      const thumbnail = getHighestResThumbnail(state.videoDetails.thumbnails);
      this.discordClient.setActivity({
        details: stringLimit(state.videoDetails.title, 128),
        state: stringLimit(state.videoDetails.author, 128),
        largeImageKey: thumbnail,
        largeImageText: stringLimit(state.videoDetails.title, 128),
        smallImageKey: getSmallImageKey(state.trackState),
        smallImageText: getSmallImageText(state.trackState),
        instance: false,
        endTimestamp: state.trackState === 1 ? this.endTimestamp : undefined,
        buttons: [
          {
            label: "Play on YouTube Music",
            url: `https://music.youtube.com/watch?v=${state.videoDetails.videoId}`
          }
        ]
      });

      if (state.trackState === 2) {
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

  public provide(): void {
    throw new Error("Discord Presence integration does not need provide");
  }

  public enable(): void {
    if (!this.discordClient) {
      this.discordClient = new DiscordRPC.Client({
        transport: "ipc"
      });
      this.discordClient.on("connected", () => {
        this.ready = true;
      });
      this.discordClient.on("disconnected", () => {
        this.ready = false;
      });
      this.discordClient.connect(DISCORD_CLIENT_ID);
      playerStateStore.addEventListener((state: PlayerState) => this.playerStateChanged(state));
    }
  }

  public disable(): void {
    if (this.discordClient) {
      this.ready = false;
      this.discordClient.destroy();
      this.discordClient = null;
    }
  }
}
