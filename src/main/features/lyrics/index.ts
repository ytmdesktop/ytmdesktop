import { BrowserView } from "electron";
import Conf from "conf";
import log from "electron-log";

import { LyricsProvider as LyricsProviderSetting, StoreSchema } from "../../../shared/store/schema";
import playerStateStore, { PlayerState, VideoState } from "../../player-state-store";
import LyricsCache from "./cache";
import LRCLibProvider, { createTrackFingerprint } from "./providers/lrclib";
import MusixmatchProvider from "./providers/musixmatch";
import { LyricsSyncState, LyricsViewState, TrackInfo } from "./types";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then(value => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function isRenderableLyricsText(text: string) {
  return text.replace(/[\s\u200B-\u200D\uFEFF]/g, "").length > 0;
}

function hasRenderableSyncedLines(lines?: { text: string }[]) {
  if (!lines || lines.length === 0) {
    return false;
  }

  return lines.some(line => isRenderableLyricsText(line.text));
}

export default class LyricsFeature {
  private store: Conf<StoreSchema> | null = null;
  private ytmView: BrowserView | null = null;
  private cache: LyricsCache | null = null;
  private lrclibProvider = new LRCLibProvider();
  private musixmatchProvider = new MusixmatchProvider();
  private enabled = false;

  private lastState: PlayerState | null = null;
  private currentTrackFingerprint = "";
  private fetchedWithMissingMetadata = false;
  private fetchDebounceTimeout: NodeJS.Timeout | null = null;
  private fetchRequestId = 0;
  private stateListener: ((state: PlayerState) => void) | null = null;
  private activeFetchCacheKey: string | null = null;
  private activeFetchAbortController: AbortController | null = null;
  private readonly recentFetchByKey = new Map<string, number>();

  private syncState: LyricsSyncState = {
    trackFingerprint: "",
    progressMs: 0,
    playing: false,
    adPlaying: false
  };
  private lastSyncDispatchAt = 0;
  private lastViewState: LyricsViewState = { status: "idle" };

  public provide(store: Conf<StoreSchema>, ytmView: BrowserView, userDataPath: string): void {
    this.store = store;
    this.ytmView = ytmView;
    if (!this.cache) {
      this.cache = new LyricsCache(userDataPath);
    }
  }

  public enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.stateListener = state => {
      this.onPlayerStateChanged(state);
    };
    playerStateStore.addEventListener(this.stateListener);
    log.info("Lyrics feature listener attached");

    const currentState = playerStateStore.getState();
    this.onPlayerStateChanged(currentState);
  }

  public disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    if (this.stateListener) {
      playerStateStore.removeEventListener(this.stateListener);
      this.stateListener = null;
    }

    if (this.fetchDebounceTimeout) {
      clearTimeout(this.fetchDebounceTimeout);
      this.fetchDebounceTimeout = null;
    }

    if (this.activeFetchAbortController) {
      this.activeFetchAbortController.abort();
      this.activeFetchAbortController = null;
    }

    this.fetchRequestId++;
    this.currentTrackFingerprint = "";
    this.lastViewState = { status: "idle" };
    this.sendLyricsState(this.lastViewState);
    log.info("Lyrics feature listener detached");
  }

  public ytmViewLoaded() {
    this.sendLyricsState(this.lastViewState);
    this.sendLyricsSync(this.syncState, true);
  }

  public async clearCache() {
    if (!this.cache) {
      return;
    }
    await this.cache.clear();
  }

  public async getCacheStats() {
    if (!this.cache) {
      return {
        entries: 0,
        diskBytes: 0
      };
    }
    return this.cache.getStats();
  }

  public handleSettingsChanged(oldState: StoreSchema["playback"], newState: StoreSchema["playback"]) {
    if (!this.enabled) {
      return;
    }

    if (oldState.lyricsProvider !== newState.lyricsProvider) {
      this.scheduleFetch(100);
    }
  }

  private onPlayerStateChanged(state: PlayerState) {
    if (!this.enabled) {
      return;
    }

    this.lastState = state;

    const trackInfo = this.toTrackInfo(state);
    const trackFingerprint = trackInfo ? createTrackFingerprint(trackInfo) : "";
    const trackChanged = trackFingerprint !== this.currentTrackFingerprint;

    if (state.adPlaying) {
      this.currentTrackFingerprint = trackFingerprint;
      this.sendLyricsState({
        status: "ad",
        message: "Ad playing",
        trackFingerprint
      });

      const syncState: LyricsSyncState = {
        trackFingerprint,
        progressMs: Math.floor((state.videoProgress ?? 0) * 1000),
        playing: state.trackState === VideoState.Playing,
        adPlaying: true
      };
      this.syncState = syncState;
      this.sendLyricsSync(syncState);
      return;
    }

    if (!state.adPlaying && this.lastViewState.status === "ad") {
      this.sendLyricsState({
        status: "loading",
        trackFingerprint
      });
      this.scheduleFetch(100);
    }

    if (trackChanged) {
      this.currentTrackFingerprint = trackFingerprint;
      this.fetchedWithMissingMetadata = false;
      if (trackFingerprint) {
        this.sendLyricsState({
          status: "loading",
          trackFingerprint
        });
      }
      this.scheduleFetch(300);
    }

    if (!trackChanged && trackInfo && trackInfo.hasFullMetadata && this.fetchedWithMissingMetadata) {
      this.fetchedWithMissingMetadata = false;
      this.scheduleFetch(100);
    }

    const syncState: LyricsSyncState = {
      trackFingerprint,
      progressMs: Math.floor((state.videoProgress ?? 0) * 1000),
      playing: state.trackState === VideoState.Playing,
      adPlaying: state.adPlaying === true
    };
    this.syncState = syncState;
    this.sendLyricsSync(syncState);
  }

  private scheduleFetch(delayMs: number) {
    if (this.fetchDebounceTimeout) {
      clearTimeout(this.fetchDebounceTimeout);
    }

    this.fetchDebounceTimeout = setTimeout(() => {
      this.fetchDebounceTimeout = null;
      this.fetchLyricsForCurrentState();
    }, delayMs);
  }

  private async fetchLyricsForCurrentState() {
    const state = this.lastState;
    const store = this.store;
    const cache = this.cache;
    if (!state || !store || !cache) {
      return;
    }

    const track = this.toTrackInfo(state);

    if (!track) {
      this.sendLyricsState({ status: "none", message: "No lyrics found" });
      return;
    }

    const trackFingerprint = createTrackFingerprint(track);
    log.info(`Lyrics fetch requested: ${track.artist} - ${track.title}`);
    if (state.adPlaying) {
      this.sendLyricsState({
        status: "ad",
        message: "Ad playing",
        trackFingerprint
      });
      return;
    }

    const preferSynced = true;
    this.musixmatchProvider.setApiKey(store.get("playback.lyricsMusixmatchApiKey"));
    const cacheKey = this.getCacheKey(trackFingerprint, preferSynced);
    const lastFetchAt = this.recentFetchByKey.get(cacheKey) ?? 0;
    if (Date.now() - lastFetchAt < 1200) {
      return;
    }

    if (this.activeFetchCacheKey === cacheKey) {
      return;
    }

    const requestId = ++this.fetchRequestId;
    if (this.activeFetchAbortController) {
      this.activeFetchAbortController.abort();
    }
    const abortController = new AbortController();
    this.activeFetchAbortController = abortController;

    try {
      this.activeFetchCacheKey = cacheKey;
      this.recentFetchByKey.set(cacheKey, Date.now());

      const cached = await cache.get(cacheKey);
      if (cached) {
        if (cached.type === "none") {
          log.info("Ignored cached none result; refetching");
        } else {
          if (requestId !== this.fetchRequestId) {
            return;
          }
          log.info(`Lyrics cache hit (${cached.type})`);
          this.sendResultState(cached, trackFingerprint, "cache");
          return;
        }
      }

      if (!track.hasFullMetadata) {
        this.fetchedWithMissingMetadata = true;
      }

      this.sendLyricsState({
        status: "loading",
        trackFingerprint
      });

      const result = await this.searchFromSelectedProvider(track, preferSynced, abortController.signal);
      if (result.type !== "none") {
        await cache.set(cacheKey, result);
      }
      log.info(`Lyrics provider result: ${result.type} (${result.source})`);

      if (requestId !== this.fetchRequestId) {
        return;
      }

      this.sendResultState(result, trackFingerprint, "network");
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      if (requestId !== this.fetchRequestId) {
        return;
      }

      log.warn("Lyrics fetch failed", error);
      this.sendLyricsState({
        status: "error",
        message: "Lyrics unavailable right now",
        trackFingerprint
      });
    } finally {
      if (this.activeFetchAbortController === abortController) {
        this.activeFetchAbortController = null;
      }

      if (this.activeFetchCacheKey === cacheKey) {
        this.activeFetchCacheKey = null;
      }
    }
  }

  private async searchFromSelectedProvider(track: TrackInfo, preferSynced: boolean, signal: AbortSignal) {
    const selectedProvider = this.store?.get("playback.lyricsProvider") ?? LyricsProviderSetting.Auto;

    const tryLrclib = async () => {
      try {
        return await withTimeout(this.lrclibProvider.search(track, preferSynced, signal), 20_000, "LRCLib timeout");
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        log.warn("LRCLib provider failed", error);
        return null;
      }
    };

    const tryMusixmatch = async () => {
      try {
        return await withTimeout(this.musixmatchProvider.search(track, preferSynced, signal), 8000, "Musixmatch timeout");
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        log.warn("Musixmatch provider failed", error);
        return null;
      }
    };

    switch (selectedProvider) {
      case LyricsProviderSetting.Musixmatch: {
        const fromMusixmatch = await tryMusixmatch();
        if (fromMusixmatch && fromMusixmatch.type !== "none") {
          return fromMusixmatch;
        }
        const fromLrclib = await tryLrclib();
        if (fromLrclib) {
          return fromLrclib;
        }
        return {
          type: "none",
          source: "musixmatch",
          trackFingerprint: createTrackFingerprint(track)
        };
      }

      case LyricsProviderSetting.Auto: {
        const fromLrclib = await tryLrclib();
        if (fromLrclib && fromLrclib.type !== "none") {
          return fromLrclib;
        }

        const fromMusixmatch = await tryMusixmatch();
        if (fromMusixmatch) {
          return fromMusixmatch;
        }

        return {
          type: "none",
          source: "lrclib",
          trackFingerprint: createTrackFingerprint(track)
        };
      }

      case LyricsProviderSetting.LRCLib:
      default: {
        const fromLrclib = await tryLrclib();
        if (fromLrclib) {
          return fromLrclib;
        }
        return {
          type: "none",
          source: "lrclib",
          trackFingerprint: createTrackFingerprint(track)
        };
      }
    }
  }

  private getCacheKey(trackFingerprint: string, preferSynced: boolean) {
    const provider = this.store?.get("playback.lyricsProvider") ?? LyricsProviderSetting.Auto;
    const musixmatchKeyConfigured = this.store?.get("playback.lyricsMusixmatchApiKey") ? 1 : 0;
    const strategyVersion = 5;
    return `v${strategyVersion}|p:${provider}|mxk:${musixmatchKeyConfigured}|ps:${preferSynced ? 1 : 0}|${trackFingerprint}`;
  }

  private sendResultState(result: Awaited<ReturnType<LRCLibProvider["search"]>>, trackFingerprint: string, origin: "cache" | "network") {
    if (result.type === "synced" && hasRenderableSyncedLines(result.lines)) {
      this.sendLyricsState({
        status: "synced",
        result,
        trackFingerprint,
        debug: {
          source: result.source,
          origin
        }
      });
      return;
    }

    if (result.type === "synced" && !hasRenderableSyncedLines(result.lines)) {
      this.sendLyricsState({
        status: "none",
        message: "No lyrics found",
        trackFingerprint,
        debug: {
          source: result.source,
          origin
        }
      });
      return;
    }

    if (result.type === "plain") {
      this.sendLyricsState({
        status: "plain",
        result,
        trackFingerprint,
        debug: {
          source: result.source,
          origin
        }
      });
      return;
    }

    this.sendLyricsState({
      status: "none",
      message: "No lyrics found",
      trackFingerprint,
      debug: {
        source: result.source,
        origin
      }
    });
  }

  private toTrackInfo(state: PlayerState): TrackInfo | null {
    const details = state.videoDetails;
    if (!details || !details.title || !details.author) {
      return null;
    }

    return {
      title: details.title,
      artist: details.author,
      album: details.album,
      durationSeconds: Number.isFinite(details.durationSeconds) ? details.durationSeconds : null,
      videoId: details.id,
      isLive: details.isLive,
      hasFullMetadata: state.hasFullMetadata
    };
  }

  private sendLyricsState(state: LyricsViewState) {
    this.lastViewState = state;
    if (!this.ytmView) {
      return;
    }
    this.ytmView.webContents.send("ytmView:lyricsState", state);
  }

  private sendLyricsSync(state: LyricsSyncState, force = false) {
    if (!this.ytmView) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastSyncDispatchAt < 200) {
      return;
    }

    this.lastSyncDispatchAt = now;
    this.ytmView.webContents.send("ytmView:lyricsSync", state);
  }
}
