import { safeStorage } from "electron";
import Conf from "conf";

import playerStateStore, { PlayerState, VideoDetails, VideoState } from "../../player-state-store";
import MemoryStore from "../../memory-store";

import IIntegration from "../integration";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { ListenBrainzSubmitBody } from "./schemas";
import log from "electron-log";

const LISTENBRAINZ_API_URL = "https://api.listenbrainz.org/1/submit-listens";

export default class ListenBrainz implements IIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private isEnabled = false;

  private possibleVideoIds: string[] | null;
  private userToken: string | null = null;
  private scrobbleTimer: NodeJS.Timeout | null = null;
  private playerStateFunction: (state: PlayerState) => void;

  // ----------------------------------------------------------

  private async updatePlayerState(state: PlayerState): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    if (state.videoDetails && state.trackState === VideoState.Playing) {
      const videoIsPrepped = this.possibleVideoIds && this.possibleVideoIds.indexOf(state.videoDetails.id) !== -1;
      const queueExists = state.queue && state.queue.items && state.queue.items.length > 0;

      if (videoIsPrepped && queueExists) {
        return;
      }

      this.possibleVideoIds = state.queue.items[state.queue.selectedItemIndex]?.counterparts?.map(item => item.videoId) || [];
      this.possibleVideoIds.push(state.queue.items[state.queue.selectedItemIndex]?.videoId);

      if (!this.userToken) {
        return;
      }

      clearTimeout(this.scrobbleTimer);

      // Track must be longer than 30 seconds
      if (state.videoDetails.durationSeconds < 30) {
        return;
      }

      this.updateNowPlaying(state.videoDetails);

      const scrobblePercent = this.store.get("listenbrainz.scrobblePercent");
      const scrobblePercentDecimal = scrobblePercent / 100;
      const scrobbleTimeRequired = Math.min(Math.round(state.videoDetails.durationSeconds * scrobblePercentDecimal), 240);
      const scrobbleTime = new Date().getTime();
      this.scrobbleTimer = setTimeout(() => {
        this.scrobbleSong(state.videoDetails, scrobbleTime);
      }, scrobbleTimeRequired * 1000);
    }
  }

  private async updateNowPlaying(videoDetails: VideoDetails): Promise<void> {
    const body: ListenBrainzSubmitBody = {
      listen_type: "playing_now",
      payload: [
        {
          track_metadata: {
            artist_name: videoDetails.author,
            track_name: videoDetails.title,
            release_name: videoDetails.album
          }
        }
      ]
    };

    this.sendToListenBrainz(body);
  }

  private async scrobbleSong(videoDetails: VideoDetails, scrobbleTime: number): Promise<void> {
    const body: ListenBrainzSubmitBody = {
      listen_type: "single",
      payload: [
        {
          listened_at: Math.floor(scrobbleTime / 1000),
          track_metadata: {
            artist_name: videoDetails.author,
            track_name: videoDetails.title,
            release_name: videoDetails.album
          }
        }
      ]
    };

    this.sendToListenBrainz(body);
  }

  private async sendToListenBrainz(body: ListenBrainzSubmitBody): Promise<void> {
    try {
      const response = await fetch(LISTENBRAINZ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Token ${this.userToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (response.status === 401) {
        log.warn("ListenBrainz: Invalid user token. Please update your token in settings.");
      } else if (!response.ok) {
        log.error(`ListenBrainz: API error ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      log.error("ListenBrainz: Failed to send request", error);
    }
  }

  // ----------------------------------------------------------

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  public enable(): void {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable ListenBrainz Integration with reason: safeStorage unavailable");
      return;
    }

    if (this.isEnabled) {
      return;
    }
    this.isEnabled = true;

    this.userToken = this.getToken();

    this.playerStateFunction = (state: PlayerState) => this.updatePlayerState(state);
    playerStateStore.addEventListener(this.playerStateFunction);
  }

  public disable(): void {
    if (!this.isEnabled) {
      return;
    }

    clearTimeout(this.scrobbleTimer);
    playerStateStore.removeEventListener(this.playerStateFunction);
    this.isEnabled = false;
  }

  public refreshToken(): void {
    this.userToken = this.getToken();
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private getToken(): string | null {
    const encryptedToken = this.store.get("listenbrainz.userToken");
    if (!encryptedToken) {
      return null;
    }

    try {
      return safeStorage.decryptString(Buffer.from(encryptedToken, "hex"));
    } catch (e) {
      log.error("ListenBrainz: Failed to decrypt user token", e);
      return null;
    }
  }
}
