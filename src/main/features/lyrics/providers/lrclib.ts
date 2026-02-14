import { parseSyncedLyricsToLines } from "../lrc";
import { LyricsProvider, LyricsResult, TrackInfo } from "../types";

type LRCLibResponse = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

const API_BASE = "https://lrclib.net/api";

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  let normalized = value.toLowerCase().trim();
  normalized = normalized.replace(/\((feat\.|ft\.|featuring)[^)]+\)/gi, "");
  normalized = normalized.replace(/\[(feat\.|ft\.|featuring)[^\]]+\]/gi, "");
  normalized = normalized.replace(/[–—-]\s*(feat\.|ft\.|featuring)\s+.+$/gi, "");
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/[^a-z0-9\s]/g, "");
  return normalized.trim();
}

function normalizeArtistName(artist: string): string {
  let normalized = artist.trim();
  normalized = normalized.replace(/\s*-\s*topic$/i, "");
  return normalized;
}

function artistVariants(artist: string): string[] {
  const source = normalizeArtistName(artist);
  const variants = new Set<string>();
  variants.add(source);

  const splitters = [",", "&", " x ", " and ", " feat. ", " ft. ", " featuring "];
  for (const splitter of splitters) {
    if (source.toLowerCase().includes(splitter)) {
      variants.add(source.split(new RegExp(splitter, "i"))[0].trim());
    }
  }

  return Array.from(variants).filter(Boolean);
}

function titleVariants(title: string): string[] {
  const variants = new Set<string>();
  variants.add(title);
  variants.add(title.replace(/\(([^)]+)\)/g, ""));
  variants.add(title.replace(/\[[^\]]+\]/g, ""));
  variants.add(title.replace(/[–—-]\s*(live|remaster(ed)?|mono|stereo).+$/gi, ""));
  return Array.from(variants)
    .map(variant => variant.trim())
    .filter(Boolean);
}

function createTrackFingerprint(track: TrackInfo) {
  if (track.videoId) {
    return `ytid:${track.videoId}`;
  }

  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const duration = typeof track.durationSeconds === "number" ? String(Math.round(track.durationSeconds)) : "";
  return `${artist}|${title}|${duration}`;
}

function scoreCandidate(track: TrackInfo, candidate: LRCLibResponse) {
  const normalizedTitle = normalizeText(track.title);
  const normalizedArtist = normalizeText(track.artist);
  const normalizedAlbum = normalizeText(track.album);
  const candidateTitle = normalizeText(candidate.trackName);
  const candidateArtist = normalizeText(candidate.artistName);
  const candidateAlbum = normalizeText(candidate.albumName);

  let score = 0;
  if (candidateTitle === normalizedTitle) {
    score += 6;
  }
  if (normalizedTitle && candidateTitle.includes(normalizedTitle)) {
    score += 2;
  }
  if (candidateArtist === normalizedArtist) {
    score += 5;
  }
  if (normalizedAlbum && candidateAlbum === normalizedAlbum) {
    score += 2;
  }
  if (typeof track.durationSeconds === "number" && Number.isFinite(candidate.duration)) {
    const delta = Math.abs(Math.round(track.durationSeconds) - Math.round(candidate.duration));
    if (delta <= 1) score += 5;
    else if (delta <= 3) score += 3;
    else if (delta <= 7) score += 1;
  }
  if (candidate.syncedLyrics) {
    score += 1;
  }
  return score;
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class LRCLibProvider implements LyricsProvider {
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  private async scheduleRateLimit() {
    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    const now = Date.now();
    const minimumGapMs = 350;
    const waitMs = Math.max(0, minimumGapMs - (now - this.lastRequestAt));
    if (waitMs > 0) {
      await wait(waitMs);
    }
    this.lastRequestAt = Date.now();
    release();
  }

  private async fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    await this.scheduleRateLimit();

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 12_000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        });

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          if (response.status >= 500 && attempt < maxAttempts) {
            await wait(250 * attempt);
            continue;
          }
          throw new Error(`LRCLib request failed with status ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        const isLastAttempt = attempt === maxAttempts;
        if (isLastAttempt) {
          throw error;
        }
        await wait(250 * attempt);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      }
    }

    return null;
  }

  private buildResult(track: TrackInfo, payload: LRCLibResponse, preferSynced: boolean): LyricsResult {
    const fingerprint = createTrackFingerprint(track);
    const syncedLyrics = payload.syncedLyrics?.trim() ?? "";
    const plainLyrics = payload.plainLyrics?.trim() ?? "";
    const parsedLines = syncedLyrics ? parseSyncedLyricsToLines(syncedLyrics) : [];

    if (preferSynced && parsedLines.length > 0) {
      return {
        type: "synced",
        lines: parsedLines,
        source: "lrclib",
        trackFingerprint: fingerprint
      };
    }

    if (plainLyrics) {
      return {
        type: "plain",
        plainText: plainLyrics,
        source: "lrclib",
        trackFingerprint: fingerprint
      };
    }

    if (parsedLines.length > 0) {
      return {
        type: "synced",
        lines: parsedLines,
        source: "lrclib",
        trackFingerprint: fingerprint
      };
    }

    return {
      type: "none",
      source: "lrclib",
      trackFingerprint: fingerprint
    };
  }

  public async search(track: TrackInfo, preferSynced: boolean, signal?: AbortSignal): Promise<LyricsResult> {
    const fingerprint = createTrackFingerprint(track);

    const variants = titleVariants(track.title);
    const artists = artistVariants(track.artist);

    for (const titleVariant of variants) {
      for (const artistVariant of artists) {
        const getParams = new URLSearchParams();
        getParams.set("track_name", titleVariant);
        getParams.set("artist_name", artistVariant);
        if (track.album) {
          getParams.set("album_name", track.album);
        }
        if (typeof track.durationSeconds === "number" && Number.isFinite(track.durationSeconds)) {
          getParams.set("duration", String(Math.round(track.durationSeconds)));
        }

        const exactMatch = await this.fetchJson<LRCLibResponse>(`${API_BASE}/get?${getParams.toString()}`, signal);
        if (exactMatch) {
          return this.buildResult(track, exactMatch, preferSynced);
        }
      }
    }

    let bestCandidate: LRCLibResponse | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const titleVariant of variants) {
      for (const artistVariant of artists) {
        const searchParams = new URLSearchParams();
        searchParams.set("track_name", titleVariant);
        searchParams.set("artist_name", artistVariant);

        const searchResults = await this.fetchJson<LRCLibResponse[]>(`${API_BASE}/search?${searchParams.toString()}`, signal);
        if (!searchResults || searchResults.length === 0) {
          continue;
        }

        for (const candidate of searchResults) {
          const score = scoreCandidate(track, candidate);
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        }
      }
    }

    if (!bestCandidate) {
      for (const titleVariant of variants) {
        const searchParams = new URLSearchParams();
        searchParams.set("track_name", titleVariant);

        const searchResults = await this.fetchJson<LRCLibResponse[]>(`${API_BASE}/search?${searchParams.toString()}`, signal);
        if (!searchResults || searchResults.length === 0) {
          continue;
        }

        for (const candidate of searchResults) {
          const score = scoreCandidate(track, candidate);
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        }
      }
    }

    if (bestCandidate) {
      return this.buildResult(track, bestCandidate, preferSynced);
    }

    return {
      type: "none",
      source: "lrclib",
      trackFingerprint: fingerprint
    };
  }
}

export { createTrackFingerprint };
