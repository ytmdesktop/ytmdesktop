import { BrowserView } from "electron";
import Conf from "conf";
import log from "electron-log";

import { StoreSchema } from "../../../shared/store/schema";
import playerStateStore, { PlayerState, VideoState } from "../../player-state-store";
import LyricsCache from "./cache";
import YouTubeProvider from "./providers/youtube";
import { LyricsSyncState, LyricsViewState, TrackInfo, createTrackFingerprint } from "./types";

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
  private youtubeProvider = new YouTubeProvider();
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
    this.sendToUI(this.lastViewState);
    log.info("Lyrics feature listener detached");
  }

  public ytmViewLoaded() {
    this.sendToUI(this.lastViewState);
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
      this.sendToUI({
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
      this.sendToUI({
        status: "loading",
        trackFingerprint
      });
      this.scheduleFetch(100);
    }

    if (trackChanged) {
      this.currentTrackFingerprint = trackFingerprint;
      this.fetchedWithMissingMetadata = false;
      if (trackFingerprint) {
        this.sendToUI({
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
      this.sendToUI({ status: "none", message: "No lyrics found" });
      return;
    }

    const trackFingerprint = createTrackFingerprint(track);
    log.info(`Lyrics fetch requested: ${track.artist} - ${track.title}`);
    if (state.adPlaying) {
      this.sendToUI({
        status: "ad",
        message: "Ad playing",
        trackFingerprint
      });
      return;
    }

    const preferSynced = true;
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

      this.sendToUI({
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
      this.sendToUI({
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
    const fingerprint = createTrackFingerprint(track);

    const tryYoutube = async () => {
      try {
        return await withTimeout(this.youtubeProvider.search(track, preferSynced, signal), 8000, "YouTube timeout");
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        log.warn("YouTube provider failed", error);
        return null;
      }
    };

    const fromYoutube = await tryYoutube();
    if (fromYoutube) {
      return fromYoutube;
    }
    return {
      type: "none" as const,
      source: "youtube" as const,
      trackFingerprint: fingerprint
    };
  }

  private getCacheKey(trackFingerprint: string, preferSynced: boolean) {
    const strategyVersion = 1;
    return `v${strategyVersion}|ps:${preferSynced ? 1 : 0}|${trackFingerprint}`;
  }

  private sendResultState(result: Awaited<ReturnType<YouTubeProvider["search"]>>, trackFingerprint: string, origin: "cache" | "network") {
    if (result.type === "synced" && hasRenderableSyncedLines(result.lines)) {
      this.sendToUI({
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
      this.sendToUI({
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
      this.sendToUI({
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

    this.sendToUI({
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

  private sendToUI(state: LyricsViewState) {
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
