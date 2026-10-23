import { shell, safeStorage, ipcMain } from "electron";

import PlayerStateStore from "../../services/playerstatestore";
import MemoryStore from "../../services/memorystore";
import ConfigStore from "../../services/configstore";

import log from "electron-log";
import Integration from "../integration";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { PlayerSignal, PlayerState, VideoState } from "~shared/playerstatestore/types";
import LastFMClient from "./last-fm-client";

declare const LASTFM_API_KEY: string | null | undefined;
declare const LASTFM_API_SECRET: string | null | undefined;

export default class LastFM extends Integration {
  public name = "LastFM";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.lastFMEnabled";
  public override disableFlags = ["disable_last_fm"];

  private possibleVideoIds: string[] | null = null;
  private lastFMDetails: StoreSchema["lastfm"] | null = null;
  private scrobbleTimer: NodeJS.Timeout | string | number | undefined = undefined;
  private playerStateFunction: ((state: PlayerState) => void) | null = null;
  private playerSignalFunction: ((signal: PlayerSignal) => void) | null = null;

  private lastFMClient?: LastFMClient;

  public onSetup() {}

  public async onEnabled() {
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);

    if (
      (typeof LASTFM_API_KEY === "undefined" || !LASTFM_API_KEY?.trim()) ||
      (typeof LASTFM_API_SECRET === "undefined" || !LASTFM_API_SECRET?.trim())
    ) {
      log.info("Refusing to enable LastFM Integration with reason: invalid api key or secret");
      return;
    }

    if (!memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable LastFM Integration with reason: safeStorage unavailable");
      return;
    }

    this.lastFMDetails = await this.getSettings();
    this.lastFMClient = new LastFMClient(LASTFM_API_KEY, LASTFM_API_SECRET, this.lastFMDetails.sessionKey ?? undefined);

    if (!this.lastFMDetails.sessionKey) {
      memoryStore.set("lastFMAuthenticationStep", 0);
    } else {
      memoryStore.set("lastFMAuthenticationStep", 2);
    }

    this.playerStateFunction = (state: PlayerState) => this.updatePlayerState(state);
    this.playerSignalFunction = (signal: PlayerSignal) => this.updateFromPlayerSignal(signal);

    const playerStateStore = this.getService(PlayerStateStore);
    playerStateStore.on("state-changed", this.playerStateFunction);
    playerStateStore.on("player-signal", this.playerSignalFunction);

    ipcMain.on("lastfm:authenticate", async () => {
      const authStep = memoryStore.get("lastFMAuthenticationStep");
      if (authStep === 0) {
        memoryStore.set("lastFMAuthenticationStep", 1);

        const token = await this.lastFMClient?.getToken();
        memoryStore.set("lastFMToken", token);
        shell.openExternal(
          `https://www.last.fm/api/auth/` + `?api_key=${encodeURIComponent(LASTFM_API_KEY)}` + `&token=${encodeURIComponent(token)}`
        );
      } else if (authStep === 1) {
        if (!this.lastFMClient) return;

        const sessionKey = await this.lastFMClient.getSession(memoryStore.get("lastFMToken") as string);
        if (this.lastFMDetails) this.lastFMDetails.sessionKey = sessionKey;
        this.saveSettings();
        memoryStore.set("lastFMAuthenticationStep", 2);
      }
    });
  }

  public onDisabled(): void {
    const playerStateStore = this.getService(PlayerStateStore);
    if (this.playerStateFunction) playerStateStore.off("state-changed", this.playerStateFunction);
    if (this.playerSignalFunction) playerStateStore.off("player-signal", this.playerSignalFunction);
  }

  private async getSettings(): Promise<StoreSchema["lastfm"]> {
    const configStore = this.getService(ConfigStore);
    const decryptedValues = configStore.get("lastfm");

    // Grab the session key and token from the store and decrypt them
    if (decryptedValues.sessionKey) {
      try {
        decryptedValues.sessionKey = (await safeStorage.decryptStringAsync(Buffer.from(decryptedValues.sessionKey, "hex"))).result;
      } catch (e) {
        decryptedValues.sessionKey = null;
        log.error(e);
      }
    }

    if (decryptedValues.token) {
      try {
        decryptedValues.token = (await safeStorage.decryptStringAsync(Buffer.from(decryptedValues.token, "hex"))).result;
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
      if (this.lastFMDetails) {
        if (this.lastFMDetails.sessionKey) {
          configStore.set("lastfm.sessionKey", (await safeStorage.encryptStringAsync(this.lastFMDetails.sessionKey)).toString("hex"));
        }
      }
    } catch {
      // Do nothing, the values are not valid and can be ignored
    }
  }

  private async updatePlayerState(state: PlayerState): Promise<void> {
    if (!this.isEnabled || !this.lastFMDetails?.sessionKey) {
      return;
    }

    if (state.videoDetails && state.trackState === VideoState.Playing) {
      // Check if the video has changed
      const videoIsPrepped = this.possibleVideoIds && this.possibleVideoIds.indexOf(state.videoDetails.id) !== -1;
      const queueExists = state.queue && state.queue.items && state.queue.items.length > 0;

      if (videoIsPrepped && queueExists) {
        return;
      }

      const hasFullMetadata = state.hasFullMetadata;
      if (!hasFullMetadata) {
        return;
      }

      // Store all the IDs of videos for this song.
      if (state.queue) {
        this.possibleVideoIds = state.queue.items[state.queue.selectedItemIndex]?.counterparts?.map(item => item.videoId) || [];
        const possibleVideoId = state.queue.items[state.queue.selectedItemIndex]?.videoId;
        if (possibleVideoId) this.possibleVideoIds.push(possibleVideoId);
      }

      // Track must be longer than 30 seconds
      // https://www.last.fm/api/scrobbling "When is a scrobble a scrobble?"
      if (state.videoDetails.durationSeconds < 30) {
        return;
      }

      try {
        await this.lastFMClient?.updateNowPlaying({
          artist: state.videoDetails.author,
          track: state.videoDetails.title,
          album: state.videoDetails.album ?? undefined,
          duration: state.videoDetails.durationSeconds
        });
      } catch(err) {
        log.error("lastfm: failed to update now playing", err);
      }

      const configStore = this.getService(ConfigStore);

      this.lastFMDetails.scrobblePercent = configStore.get("lastfm.scrobblePercent");
      const scrobblePercentDecimal = this.lastFMDetails.scrobblePercent / 100;
      const scrobbleTimeRequired = Math.min(
        // Scrobble the track if it has been played to the percent picked by the user
        Math.round(state.videoDetails.durationSeconds * scrobblePercentDecimal),
        // OR if it has been played for more than 4 minutes, scrobble maximum time: https://www.last.fm/api/scrobbling
        240
      );
      const scrobbleTime = new Date().getTime();
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = setTimeout(async () => {
        try {
          if (state.videoDetails) {
            await this.lastFMClient?.scrobble({
              artist: state.videoDetails.author,
              track: state.videoDetails.title,
              timestamp: Math.floor(scrobbleTime / 1000),
              album: state.videoDetails.album ?? undefined,
              duration: state.videoDetails.durationSeconds
            });
          }
        } catch(err) {
          log.error("lastfm: failed to scrobble", err);
        }
      }, scrobbleTimeRequired * 1000);
    }
  }

  private updateFromPlayerSignal(signal: PlayerSignal) {
    // NewPlayback signal is considered a fresh playback e.g. a new video or a looped video
    if (signal === PlayerSignal.NewPlayback) {
      clearTimeout(this.scrobbleTimer);
      this.possibleVideoIds = [];
    }
  }
}
