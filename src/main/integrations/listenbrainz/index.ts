import { app, safeStorage } from "electron";
import Conf from "conf";

import playerStateStore, { PlayerState, VideoDetails, VideoState } from "../../player-state-store";
import MemoryStore from "../../memory-store";

import IIntegration from "../integration";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { ListenBrainzResponse, ListenBrainzSubmission, ListenBrainzSubmissionType } from "./schemas";
import log from "electron-log";

export default class ListenBrainz implements IIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private isEnabled = false;

  private possibleVideoIds: string[] | null;
  private listenbrainzDetails: StoreSchema["listenbrainz"] = null;
  private scrobbleTimer: NodeJS.Timeout | null = null;
  private playerStateFunction: (state: PlayerState) => void;

  private version = app.getVersion();

  // ----------------------------------------------------------

  private async updatePlayerState(state: PlayerState): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    //console.log('updatePlayerState called with state:', state);

    if (state.videoDetails && state.trackState === VideoState.Playing) {
      // Check if the video has changed (TO DO: Fix song on repeat not scrobbling)

      const videoIsPrepped = this.possibleVideoIds && this.possibleVideoIds.indexOf(state.videoDetails.id) !== -1;
      const queueExists = state.queue && state.queue.items && state.queue.items.length > 0;

      if (videoIsPrepped && queueExists) {
        return;
      }

      // Store all the IDs of videos for this song.
      this.possibleVideoIds = state.queue.items[state.queue.selectedItemIndex]?.counterparts?.map(item => item.videoId) || [];
      this.possibleVideoIds.push(state.queue.items[state.queue.selectedItemIndex]?.videoId);

      if (!this.listenbrainzDetails || !this.listenbrainzDetails.token) {
        console.error("ListenBrainz token not found");
        return;
      }

      clearTimeout(this.scrobbleTimer);

      this.updateNowPlaying(state.videoDetails);

      const scrobbleTimeRequired = Math.min(
        // Scrobble the track if it has been played for more than 50% of its duration
        Math.round(state.videoDetails.durationSeconds / 2),
        // OR if it has been played for more than 4 minutes
        240
      );
      const scrobbleTime = new Date().getTime();

      this.scrobbleTimer = setTimeout(() => {
        this.scrobbleSong(state.videoDetails, scrobbleTime);
      }, scrobbleTimeRequired * 1000);
    }
  }

  private createListenBrainzSubmission(videoDetails: VideoDetails, listenType: ListenBrainzSubmissionType, scrobbleTime?: number): ListenBrainzSubmission {
    return {
      listen_type: listenType,
      payload: [
        {
          listened_at: scrobbleTime ? Math.floor(scrobbleTime / 1000) : undefined,
          track_metadata: {
            artist_name: videoDetails.author,
            track_name: videoDetails.title,
            additional_info: {
              media_player: "YTM Desktop",
              media_player_version: this.version,
              submission_client: "YTM Desktop ListenBrainz Scobbler",
              submission_client_version: "1.0.0",
              music_service: "music.youtube.com",
              origin_url: `https://music.youtube.com/watch?v=${videoDetails.id}`,
              duration: videoDetails.durationSeconds
            }
          }
        }
      ]
    };
  }

  private async updateNowPlaying(videoDetails: VideoDetails): Promise<void> {
    const listen = this.createListenBrainzSubmission(videoDetails, "playing_now");
    this.sendToListenBrainz(listen);
  }

  private async scrobbleSong(videoDetails: VideoDetails, scrobbleTime: number): Promise<void> {
    const listen = this.createListenBrainzSubmission(videoDetails, "single", scrobbleTime);
    this.sendToListenBrainz(listen);
  }

  private async sendToListenBrainz(listen: ListenBrainzSubmission): Promise<void> {
    try {
      const response = await fetch(`https://api.listenbrainz.org/1/submit-listens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Token ${this.listenbrainzDetails.token}`
        },
        body: JSON.stringify(listen)
      });

      if (!response.ok) {
        const responseBody: ListenBrainzResponse = await response.json();
        throw new Error(`Error in sendToListenBrainz: ${response.status} - ${responseBody.message}`);
      }
    } catch (error) {
      console.error(`Error in sendToListenBrainz: ${error.message}`);
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

    this.listenbrainzDetails = this.getSettings();

    this.playerStateFunction = (state: PlayerState) => this.updatePlayerState(state);
    playerStateStore.addEventListener(this.playerStateFunction);
  }

  public disable(): void {
    if (!this.isEnabled) {
      return;
    }

    playerStateStore.removeEventListener(this.playerStateFunction);
    this.isEnabled = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private getSettings(): StoreSchema["listenbrainz"] {
    const decryptedValues = this.store.get("listenbrainz");

    // Decrypt the token if it exists
    if (decryptedValues.token) {
      try {
        decryptedValues.token = safeStorage.decryptString(Buffer.from(decryptedValues.token, "hex"));
      } catch (e) {
        decryptedValues.token = null;
        log.error(e);
      }
    }

    return decryptedValues;
  }
}
