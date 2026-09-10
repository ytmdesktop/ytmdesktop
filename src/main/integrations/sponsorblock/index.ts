import { BrowserView } from "electron";
import { createHash } from "crypto";
import log from "electron-log";

import IIntegration from "../integration";
import playerStateStore, { PlayerState } from "../../player-state-store";

type SkipSegment = {
  start: number;
  end: number;
  uuid: string;
};

type CacheEntry = {
  segments: SkipSegment[];
  fetchedAt: number;
};

const API_BASE = "https://sponsor.ajay.app/api/skipSegments";
const HASH_PREFIX_LENGTH = 4;
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SKIP_THRESHOLD = 1.5; // seconds — only skip if enough time remains in the segment

export default class SponsorBlock implements IIntegration {
  private ytmView: BrowserView;
  private isEnabled = false;
  private currentVideoId: string | null = null;
  private currentSegments: SkipSegment[] = [];
  private skippedSegments: Set<string> = new Set();
  private cache: Map<string, CacheEntry> = new Map();
  private stateListener: ((state: PlayerState) => void) | null = null;
  private pendingFetch: AbortController | null = null;
  private counterpartsFetched = false;

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  public enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;

    this.stateListener = (state: PlayerState) => {
      this.onStateChanged(state);
    };
    playerStateStore.addEventListener(this.stateListener);
  }

  public disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;

    if (this.stateListener) {
      playerStateStore.removeEventListener(this.stateListener);
      this.stateListener = null;
    }

    if (this.pendingFetch) {
      this.pendingFetch.abort();
      this.pendingFetch = null;
    }

    this.currentVideoId = null;
    this.currentSegments = [];
    this.skippedSegments.clear();
    this.counterpartsFetched = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private onStateChanged(state: PlayerState): void {
    if (!state.videoDetails?.id) return;

    const videoId = state.videoDetails.id;

    // New video started
    if (videoId !== this.currentVideoId) {
      this.currentVideoId = videoId;
      this.currentSegments = [];
      this.skippedSegments.clear();
      this.counterpartsFetched = false;
      this.fetchSegments(videoId);
      return;
    }

    // If primary video had no segments, try counterpart video IDs once the queue is populated
    if (this.currentSegments.length === 0 && !this.counterpartsFetched && state.queue?.items?.length > 0 && state.queue.selectedItemIndex >= 0) {
      const counterpartIds = this.getCounterpartVideoIds(state);
      if (counterpartIds.length > 0) {
        this.counterpartsFetched = true;
        this.fetchCounterpartSegments(videoId, counterpartIds);
      }
    }

    // Check if we need to skip
    if (this.currentSegments.length === 0) return;

    const progress = state.videoProgress;
    for (const segment of this.currentSegments) {
      if (this.skippedSegments.has(segment.uuid)) continue;

      const inSegment = progress >= segment.start && progress < segment.end;
      const enoughTimeLeft = segment.end - progress > SKIP_THRESHOLD;

      if (inSegment && enoughTimeLeft) {
        this.skippedSegments.add(segment.uuid);
        log.info(`SponsorBlock: Skipped non-music section ${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s`);
        this.seekTo(segment.end);
        break;
      }
    }
  }

  private getCounterpartVideoIds(state: PlayerState): string[] {
    if (!state.queue?.items || state.queue.selectedItemIndex < 0) return [];

    const currentItem = state.queue.items[state.queue.selectedItemIndex];
    if (!currentItem?.counterparts) return [];

    return currentItem.counterparts.map(c => c.videoId).filter(id => id && id !== this.currentVideoId);
  }

  private seekTo(time: number): void {
    if (!this.ytmView?.webContents || this.ytmView.webContents.isDestroyed()) return;
    this.ytmView.webContents.send("remoteControl:execute", "seekTo", time);
  }

  private async fetchCounterpartSegments(primaryVideoId: string, counterpartIds: string[]): Promise<void> {
    for (const counterpartId of counterpartIds) {
      if (this.currentVideoId !== primaryVideoId) return;

      const segments = await this.fetchSegmentsForVideoId(counterpartId);
      if (segments.length > 0) {
        this.applySegments(primaryVideoId, segments);
        return;
      }
    }
  }

  private async fetchSegments(videoId: string): Promise<void> {
    const segments = await this.fetchSegmentsForVideoId(videoId);
    this.applySegments(videoId, segments);
  }

  private async fetchSegmentsForVideoId(videoId: string): Promise<SkipSegment[]> {
    // Check cache first
    const cached = this.cache.get(videoId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.segments;
    }

    // Abort any in-flight request
    if (this.pendingFetch) {
      this.pendingFetch.abort();
    }

    const abortController = new AbortController();
    this.pendingFetch = abortController;

    try {
      const hashPrefix = createHash("sha256").update(videoId).digest("hex").substring(0, HASH_PREFIX_LENGTH);
      const url = `${API_BASE}/${hashPrefix}?categories=${encodeURIComponent('["music_offtopic"]')}`;

      const response = await fetch(url, {
        signal: abortController.signal,
        headers: {
          "User-Agent": "YTMDesktop/2.0 (https://github.com/ytmdesktop/ytmdesktop)"
        }
      });

      if (response.status === 404) {
        this.cacheSegments(videoId, []);
        return [];
      }

      if (!response.ok) {
        log.warn(`SponsorBlock: API returned status ${response.status}`);
        return [];
      }

      const data = await response.json();

      // The hashed endpoint returns segments for multiple videos — filter to ours
      let segments: SkipSegment[] = [];
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.videoID === videoId && Array.isArray(entry.segments)) {
            segments = entry.segments
              .filter((seg: { actionType: string }) => seg.actionType === "skip")
              .map((seg: { segment: number[]; UUID: string }) => ({
                start: seg.segment[0],
                end: seg.segment[1],
                uuid: seg.UUID
              }));
            break;
          }
        }
      }

      this.cacheSegments(videoId, segments);
      return segments;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return [];
      log.warn("SponsorBlock: Failed to fetch segments", error);
      return [];
    } finally {
      if (this.pendingFetch === abortController) {
        this.pendingFetch = null;
      }
    }
  }

  private applySegments(videoId: string, segments: SkipSegment[]): void {
    if (this.currentVideoId !== videoId) return;
    this.currentSegments = segments;
  }

  private cacheSegments(videoId: string, segments: SkipSegment[]): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(videoId, {
      segments,
      fetchedAt: Date.now()
    });
  }
}
