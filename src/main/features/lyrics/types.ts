export type TrackInfo = {
  title: string;
  artist: string;
  album?: string | null;
  durationSeconds?: number | null;
  videoId?: string | null;
  isLive?: boolean;
  hasFullMetadata?: boolean;
};

export type LyricsLine = {
  startMs: number;
  endMs?: number;
  text: string;
};

export type LyricsResult = {
  type: "synced" | "plain" | "none";
  lines?: LyricsLine[];
  plainText?: string;
  source: "lrclib" | "musixmatch" | "youtube";
  trackFingerprint: string;
};

export type LyricsDebugInfo = {
  source?: LyricsResult["source"];
  origin?: "cache" | "network";
};

export type LyricsViewState =
  | {
      status: "idle" | "loading" | "none" | "error" | "ad";
      message?: string;
      trackFingerprint?: string;
      debug?: LyricsDebugInfo;
    }
  | {
      status: "synced";
      result: LyricsResult;
      trackFingerprint: string;
      debug?: LyricsDebugInfo;
    }
  | {
      status: "plain";
      result: LyricsResult;
      trackFingerprint: string;
      debug?: LyricsDebugInfo;
    };

export type LyricsSyncState = {
  trackFingerprint?: string;
  progressMs: number;
  playing: boolean;
  adPlaying: boolean;
};

export interface LyricsProvider {
  search(track: TrackInfo, preferSynced: boolean, signal?: AbortSignal): Promise<LyricsResult>;
}

export function normalizeText(value: string | null | undefined): string {
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

export function createTrackFingerprint(track: TrackInfo) {
  if (track.videoId) {
    return `ytid:${track.videoId}`;
  }

  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const duration = typeof track.durationSeconds === "number" ? String(Math.round(track.durationSeconds)) : "";
  return `${artist}|${title}|${duration}`;
}
