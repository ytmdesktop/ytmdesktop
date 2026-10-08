import { shell, safeStorage } from "electron";
import cypto from "crypto";

import PlayerStateStore from "../../services/playerstatestore";
import MemoryStore from "../../services/memorystore";
import ConfigStore from "../../services/configstore";

import { LastfmErrorResponse, LastfmRequestBody, LastfmSessionResponse, LastfmTokenResponse } from "./schemas";
import log from "electron-log";
import Integration from "../integration";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { PlayerState, VideoDetails, VideoState } from "~shared/playerstatestore/types";
import assert from "node:assert";

export default class LastFM extends Integration {
  public name = "LastFM";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.lastFMEnabled";
  public override disableFlags = ["disable_last_fm"];

  private possibleVideoIds: string[] | null = null;
  private lastfmDetails: StoreSchema["lastfm"] | null = null;
  private scrobbleTimer: NodeJS.Timeout | string | number | undefined = undefined;
  private playerStateFunction: ((state: PlayerState) => void) | null = null;

  private async createToken(): Promise<string> {
    assert(this.lastfmDetails, new Error("LastFM information not available from config store integration may not have been enabled"));

    const data: LastfmRequestBody = {
      method: "auth.gettoken",
      format: "json",

      api_key: this.lastfmDetails.api_key
    };
    const api_sig = this.createApiSig(data, this.lastfmDetails.secret);

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/` + `?${this.createQueryString(data, api_sig)}`);

    const json = (await response.json()) as LastfmTokenResponse;
    return json?.token;
  }

  private async authenticateUser() {
    assert(this.lastfmDetails, new Error("LastFM information not available from config store integration may not have been enabled"));

    this.lastfmDetails.token = await this.createToken();
    this.saveSettings();

    shell.openExternal(
      `https://www.last.fm/api/auth/` + `?api_key=${encodeURIComponent(this.lastfmDetails.api_key)}` + `&token=${encodeURIComponent(this.lastfmDetails.token)}`
    );
  }

  private async getSession() {
    assert(this.lastfmDetails, new Error("LastFM information not available from config store integration may not have been enabled"));

    if (!!this.lastfmDetails.token) {
      await this.authenticateUser();
    }

    const params: LastfmRequestBody = {
      method: "auth.getSession",
      format: "json",
      api_key: this.lastfmDetails.api_key,
      token: this.lastfmDetails.token!
    };

    const api_sig = this.createApiSig(params, this.lastfmDetails.secret);

    const response = await fetch(`https://ws.audioscrobbler.com/2.0/` + `?${this.createQueryString(params, api_sig)}`);

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

    if (state.videoDetails && state.trackState === VideoState.Playing) {
      // Check if the video has changed (TO DO: Fix song on repeat not scrobbling)

      const videoIsPrepped = this.possibleVideoIds && this.possibleVideoIds.indexOf(state.videoDetails.id) !== -1;
      const queueExists = state.queue && state.queue.items && state.queue.items.length > 0;

      if (videoIsPrepped && queueExists) {
        return;
      }

      // Store all the IDs of videos for this song.
      if (state.queue) {
        this.possibleVideoIds = state.queue.items[state.queue.selectedItemIndex]?.counterparts?.map(item => item.videoId) || [];
        const possibleVideoId = state.queue.items[state.queue.selectedItemIndex]?.videoId;
        if (possibleVideoId) this.possibleVideoIds.push(possibleVideoId);
      }

      if (!this.lastfmDetails || !this.lastfmDetails.sessionKey) {
        this.getSession();
        return;
      }

      clearTimeout(this.scrobbleTimer);

      // Track must be longer than 30 seconds
      // https://www.last.fm/api/scrobbling "When is a scrobble a scrobble?"
      if (state.videoDetails.durationSeconds < 30) {
        return;
      }

      this.updateNowPlaying(state.videoDetails);

      const configStore = this.getService(ConfigStore);

      this.lastfmDetails.scrobblePercent = configStore.get("lastfm.scrobblePercent");
      const scrobblePercentDecimal = this.lastfmDetails.scrobblePercent / 100;
      const scrobbleTimeRequired = Math.min(
        // Scrobble the track if it has been played to the percent picked by the user
        Math.round(state.videoDetails.durationSeconds * scrobblePercentDecimal),
        // OR if it has been played for more than 4 minutes, scrobble maximum time: https://www.last.fm/api/scrobbling
        240
      );
      const scrobbleTime = new Date().getTime();
      this.scrobbleTimer = setTimeout(() => {
        if (state.videoDetails) this.scrobbleSong(state.videoDetails, scrobbleTime);
      }, scrobbleTimeRequired * 1000);
    }
  }

  private async updateNowPlaying(videoDetails: VideoDetails): Promise<void> {
    const data = {
      method: "track.updateNowPlaying"
    };

    this.sendToLastFM(videoDetails, data);
  }

  private async scrobbleSong(videoDetails: VideoDetails, scrobbleTime: number): Promise<void> {
    const data: Partial<LastfmRequestBody> = {
      method: "track.scrobble",
      timestamp: Math.floor(scrobbleTime / 1000)
    };

    this.sendToLastFM(videoDetails, data);
  }

  private async sendToLastFM(videoDetails: VideoDetails, params: Partial<LastfmRequestBody>): Promise<void> {
    assert(this.lastfmDetails, new Error("LastFM information not available from config store integration may not have been enabled"));
    assert(this.lastfmDetails.sessionKey, new Error("LastFM session key not available from config store authentication may not have occurred"));

    const data: Partial<LastfmRequestBody> = {
      // Add specific data to the request
      ...params,

      artist: videoDetails.author,
      track: videoDetails.title,
      album: videoDetails.album ?? undefined,
      duration: videoDetails.durationSeconds,
      // albumArtist, trackNumber, chosenByUser

      format: "json",
      api_key: this.lastfmDetails.api_key,
      sk: this.lastfmDetails.sessionKey
    };
    data.api_sig = this.createApiSig(data, this.lastfmDetails.secret);

    const response = fetch(`https://ws.audioscrobbler.com/2.0/`, {
      method: "POST",
      body: this.createBody(data)
    });

    response.catch((error: LastfmErrorResponse) => {
      // Check Errors against https://www.last.fm/api/show/track.scrobble#errors
      switch (error.code) {
        case 9: // Invalid session key
          if (this.lastfmDetails) this.lastfmDetails.sessionKey = null;
          this.authenticateUser();
          break;

        default:
          console.error(error);
      }
    });
  }

  // ----------------------------------------------------------

  public onSetup() {}

  public onEnabled(): void {
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);

    if (!memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable LastFM Integration with reason: safeStorage unavailable");
      return;
    }

    this.lastfmDetails = this.getSettings();

    if (!this.lastfmDetails || !this.lastfmDetails.sessionKey) {
      this.getSession();
    }

    this.playerStateFunction = (state: PlayerState) => this.updatePlayerState(state);

    const playerStateStore = this.getService(PlayerStateStore);
    playerStateStore.on("state-changed", this.playerStateFunction);
  }

  public onDisabled(): void {
    const playerStateStore = this.getService(PlayerStateStore);
    if (this.playerStateFunction) playerStateStore.off("state-changed", this.playerStateFunction);
  }

  /**
   * Format the data to be sent to the Last.fm API as a query string
   * @param params data to send
   * @param api_sig signature to append to the data
   * @returns URL encoded query string to be used in the request
   */
  private createQueryString(params: LastfmRequestBody, api_sig: string) {
    const data: string[] = [];
    params.api_sig = api_sig;

    for (const key in params) {
      const value = params[key as keyof LastfmRequestBody];
      if (!value) {
        continue;
      }

      data.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toString())}`);
    }
    return data.join("&");
  }

  private createBody(params: Partial<LastfmRequestBody>) {
    const data = new URLSearchParams();
    for (const key in params) {
      const value = params[key as keyof LastfmRequestBody];
      if (value === null || value === undefined) {
        continue;
      }

      data.append(key, value.toString());
    }
    return data;
  }

  /**
   * Create a Signature for the Last.fm API
   * @see {@link https://www.last.fm/api/authspec#_8-signing-calls} for details on how to create the signature
   * @param params Data to be signed
   * @param secret Secret key
   * @returns Signature for the data
   */
  private createApiSig(params: Partial<LastfmRequestBody>, secret: string) {
    const keys = Object.keys(params).sort();
    const data: string[] = [];

    for (const key of keys) {
      // Ignore format and callback parameters
      if (key === "format" || key === "callback") {
        continue;
      }

      const value = params[key as keyof LastfmRequestBody];
      if (!value) {
        continue;
      }

      data.push(`${key}${value.toString()}`);
    }

    data.push(secret);
    return md5(data.join(""));
  }

  private getSettings(): StoreSchema["lastfm"] {
    const configStore = this.getService(ConfigStore);
    const decryptedValues = configStore.get("lastfm");

    // Grab the session key and token from the store and decrypt them
    if (decryptedValues.sessionKey) {
      try {
        decryptedValues.sessionKey = safeStorage.decryptString(Buffer.from(decryptedValues.sessionKey, "hex"));
      } catch (e) {
        decryptedValues.sessionKey = null;
        log.error(e);
      }
    }

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

  private async saveSettings(): Promise<void> {
    const configStore = this.getService(ConfigStore);
    try {
      if (this.lastfmDetails) {
        if (this.lastfmDetails.sessionKey) {
          configStore.set("lastfm.sessionKey", safeStorage.encryptString(this.lastfmDetails.sessionKey).toString("hex"));
        }
        if (this.lastfmDetails.token) {
          configStore.set("lastfm.token", safeStorage.encryptString(this.lastfmDetails.token).toString("hex"));
        }
      }
    } catch {
      // Do nothing, the values are not valid and can be ignored
    }
  }
}

function md5(string: string): string {
  return cypto.createHash("md5").update(string).digest("hex");
}
