import { shell, safeStorage } from "electron";
import Conf from "conf";

import { PlayerState, VideoDetails, VideoState } from "../../player-state-store";
import MemoryStore from "../../memory-store";

import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { LastfmErrorResponse, LastfmRequestBody, LastfmSessionResponse, LastfmTokenResponse } from "./schemas";
import log from "electron-log";
import { createBody, createApiSig, createQueryString } from "./utils";
import BaseIntegration from "../base-integration";

export default class LastFM extends BaseIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private possibleVideoIds: string[] | null;
  private lastfmDetails: StoreSchema["lastfm"] = null;
  private scrobbleTimer: NodeJS.Timeout | null = null;
  private playerStateFunction: (state: PlayerState) => void;
  private lastScrobbledVideoId: string | null = null;
  private lastScrobbleTime: number = 0;

  constructor(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>) {
    super();
    this.store = store;
    this.memoryStore = memoryStore;
    this.possibleVideoIds = null;
  }

  private async createToken(): Promise<string> {
    const data: LastfmRequestBody = {
      method: "auth.gettoken",
      format: "json",

      api_key: this.lastfmDetails.api_key
    };
    const api_sig = createApiSig(data, this.lastfmDetails.secret);

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/` + `?${createQueryString(data, api_sig)}`);

    const json = (await response.json()) as LastfmTokenResponse;
    return json?.token;
  }

  private async authenticateUser() {
    this.lastfmDetails.token = await this.createToken();
    this.saveSettings();

    shell.openExternal(
      `https://www.last.fm/api/auth/` + `?api_key=${encodeURIComponent(this.lastfmDetails.api_key)}` + `&token=${encodeURIComponent(this.lastfmDetails.token)}`
    );
  }

  private async getSession() {
    const params: LastfmRequestBody = {
      method: "auth.getSession",
      format: "json",
      api_key: this.lastfmDetails.api_key,
      token: this.lastfmDetails.token
    };

    const api_sig = createApiSig(params, this.lastfmDetails.secret);

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/` + `?${createQueryString(params, api_sig)}`);

    const json = (await response.json()) as LastfmSessionResponse;

    if (json.error) {
      await this.authenticateUser();
    } else if (json.session) {
      this.lastfmDetails.sessionKey = json.session.key;
      this.saveSettings();
    }
  }

  // ----------------------------------------------------------

  private async updatePlayerState(state: PlayerState): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      // Make sure we have a valid state with videoDetails and a valid queue
      if (
        state?.videoDetails &&
        state.trackState === VideoState.Playing &&
        state.queue &&
        state.queue.items &&
        state.queue.items.length > 0 &&
        state.queue.selectedItemIndex !== undefined &&
        state.queue.selectedItemIndex >= 0 &&
        state.queue.selectedItemIndex < state.queue.items.length
      ) {
        // Check if we need to re-scrobble a track that's on repeat
        const currentTime = new Date().getTime();
        const timeSinceLastScrobble = currentTime - this.lastScrobbleTime;
        const minScrobbleInterval = 5 * 60 * 1000; // 5 minutes minimum between scrobbles of the same track
        const isRepeatTrack = this.lastScrobbledVideoId === state.videoDetails.id;
        const shouldRescrobble = isRepeatTrack && timeSinceLastScrobble > minScrobbleInterval;

        // Either this is a new track, or we're eligible to re-scrobble
        const shouldProceed = !isRepeatTrack || shouldRescrobble;

        // Should we update now playing?
        // Do not set now playing if scrobbling is already in progress
        if (shouldProceed && !this.scrobbleTimer) {
          this.updateNowPlaying(state.videoDetails);
          // Get the scrobble percentage from the store
          const scrobblePercent = this.lastfmDetails.scrobblePercent || 50;
          // Get the video duration
          const duration = state.videoDetails.durationSeconds;
          // Calculate the time to wait before scrobbling, now with a sane default
          let scrobbleTime = Math.floor((duration * scrobblePercent) / 100) * 1000;

          if (isNaN(scrobbleTime) || scrobbleTime <= 0) {
            // If we can't calculate, set a reasonable default (30 seconds)
            scrobbleTime = 30 * 1000;
          }

          // Clear any existing timer
          if (this.scrobbleTimer) {
            clearTimeout(this.scrobbleTimer);
          }

          // Set a new timer
          this.scrobbleTimer = setTimeout(() => {
            this.scrobbleTrack(state.videoDetails);
            this.scrobbleTimer = null;

            // Track the scrobbled video ID and time
            this.lastScrobbledVideoId = state.videoDetails.id;
            this.lastScrobbleTime = new Date().getTime();
          }, scrobbleTime);
        }
      }
    } catch (error) {
      log.error("Error in LastFM updatePlayerState:", error);
    }
  }

  private async updateNowPlaying(videoDetails: VideoDetails): Promise<void> {
    const data = {
      method: "track.updateNowPlaying"
    };

    this.sendToLastFM(videoDetails, data);
  }

  private async scrobbleTrack(videoDetails: VideoDetails): Promise<void> {
    const data: Partial<LastfmRequestBody> = {
      method: "track.scrobble",
      timestamp: Math.floor(new Date().getTime() / 1000)
    };

    this.sendToLastFM(videoDetails, data);
  }

  // This method is now deprecated and replaced by scrobbleTrack
  private async scrobbleSong(videoDetails: VideoDetails): Promise<void> {
    return this.scrobbleTrack(videoDetails);
  }

  private async sendToLastFM(videoDetails: VideoDetails, params: Partial<LastfmRequestBody>): Promise<void> {
    const data: Partial<LastfmRequestBody> = {
      // Add specific data to the request
      ...params,

      artist: videoDetails.author,
      track: videoDetails.title,
      album: videoDetails.album,
      duration: videoDetails.durationSeconds,
      // albumArtist, trackNumber, chosenByUser

      format: "json",
      api_key: this.lastfmDetails.api_key,
      sk: this.lastfmDetails.sessionKey
    };

    try {
      data.api_sig = createApiSig(data, this.lastfmDetails.secret);

      const response = await fetch(`https://ws.audioscrobbler.com/2.0/`, {
        method: "POST",
        body: createBody(data)
      });

      if (!response.ok) {
        const errorData = (await response.json()) as LastfmErrorResponse;
        // Check Errors against https://www.last.fm/api/show/track.scrobble#errors
        switch (errorData.error) {
          case 9: // Invalid session key
            log.warn("Last.fm session key invalid, attempting to reauthenticate");
            this.lastfmDetails.sessionKey = null;
            this.authenticateUser();
            break;
          case 11: // Service offline
          case 16: // Service temporarily unavailable
            log.warn(`Last.fm service unavailable: ${errorData.message}`);
            // Will retry on next track
            break;
          default:
            log.error(`Last.fm API error: ${errorData.message} (code: ${errorData.error})`);
        }
      } else {
        // Request successful
        log.debug(`Last.fm ${params.method} successful`);
      }
    } catch (error) {
      // Handle network errors and other exceptions
      log.error(`Last.fm API request failed: ${error.message || "Unknown error"}`);
    }
  }

  // ----------------------------------------------------------

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  public enable(): void {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Safe Storage not available for LastFM Integration, using insecure storage instead (credentials will not be encrypted)");
      // Continue anyway, but warn the user in the UI
      this.memoryStore.set("lastfmUsingInsecureStorage", true);
    } else {
      this.memoryStore.set("lastfmUsingInsecureStorage", false);
    }

    if (this.isEnabled) {
      return;
    }
    this.isEnabled = true;

    this.lastfmDetails = this.getSettings();

    if (!this.lastfmDetails || !this.lastfmDetails.sessionKey) {
      this.getSession();
    }

    // Use the base class method for player state registration
    this.registerPlayerStateListener((state: PlayerState) => this.updatePlayerState(state));
  }

  public override disable(): void {
    if (!this.isEnabled) {
      return;
    }

    if (this.scrobbleTimer) {
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = null;
    }

    // Call the base class implementation to cleanup event listeners
    super.disable();
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private getSettings(): StoreSchema["lastfm"] {
    const decryptedValues = this.store.get("lastfm");
    const safeStorageAvailable = this.memoryStore.get("safeStorageAvailable");

    // Grab the session key and token from the store and decrypt them if safeStorage is available
    if (decryptedValues.sessionKey) {
      try {
        if (safeStorageAvailable) {
          decryptedValues.sessionKey = safeStorage.decryptString(Buffer.from(decryptedValues.sessionKey, "hex"));
        }
        // If safeStorage is not available, we're already using the unencrypted values
      } catch (e) {
        decryptedValues.sessionKey = null;
        log.error(e);
      }
    }

    if (decryptedValues.token) {
      try {
        if (safeStorageAvailable) {
          decryptedValues.token = safeStorage.decryptString(Buffer.from(decryptedValues.token, "hex"));
        }
        // If safeStorage is not available, we're already using the unencrypted values
      } catch (e) {
        decryptedValues.token = null;
        log.error(e);
      }
    }

    return decryptedValues;
  }

  private async saveSettings(): Promise<void> {
    try {
      const safeStorageAvailable = this.memoryStore.get("safeStorageAvailable");

      if (this.lastfmDetails.sessionKey) {
        if (safeStorageAvailable) {
          this.store.set("lastfm.sessionKey", safeStorage.encryptString(this.lastfmDetails.sessionKey).toString("hex"));
        } else {
          // Store directly without encryption
          this.store.set("lastfm.sessionKey", this.lastfmDetails.sessionKey);
        }
      }

      if (this.lastfmDetails.token) {
        if (safeStorageAvailable) {
          this.store.set("lastfm.token", safeStorage.encryptString(this.lastfmDetails.token).toString("hex"));
        } else {
          // Store directly without encryption
          this.store.set("lastfm.token", this.lastfmDetails.token);
        }
      }
    } catch (error) {
      log.error(`Failed to save LastFM settings: ${error.message || "Unknown error"}`);
    }
  }
}
