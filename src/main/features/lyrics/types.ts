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
  source: "lrclib" | "musixmatch";
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
