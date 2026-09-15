import log from "electron-log";
import { LyricsProvider, LyricsResult, TrackInfo, createTrackFingerprint } from "../types";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "com.google.android.apps.youtube.music/8.09.50 (Linux; U; Android 13; en_US)"
};

const CONTEXT_PAYLOAD = {
  context: {
    client: {
      clientName: "ANDROID_MUSIC",
      clientVersion: "8.09.50",
      androidSdkVersion: 33,
      osName: "Android",
      osVersion: "13"
    }
  }
};

export default class YouTubeProvider implements LyricsProvider {
  public async search(track: TrackInfo, preferSynced: boolean, signal?: AbortSignal): Promise<LyricsResult> {
    const fingerprint = createTrackFingerprint(track);

    if (!track.videoId) {
      return {
        type: "none" as const,
        source: "youtube" as const,
        trackFingerprint: fingerprint
      };
    }

    try {
      const nextUrl = "https://music.youtube.com/youtubei/v1/next?prettyPrint=false";
      const nextPayload = { ...CONTEXT_PAYLOAD, videoId: track.videoId };

      const nextRes = await fetch(nextUrl, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(nextPayload),
        signal
      });

      if (!nextRes.ok) throw new Error("YouTube next response not ok");
      const nextData = await nextRes.json();

      let lyricsBrowseId: string | null = null;
      try {
        const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
        if (tabs) {
          for (const tab of tabs) {
            if (tab.tabRenderer?.title === "Lyrics") {
              lyricsBrowseId = tab.tabRenderer.endpoint?.browseEndpoint?.browseId;
              break;
            }
          }
        }
      } catch (e) {
        log.warn("YouTubeProvider: Failed to parse tabs", e);
      }

      if (!lyricsBrowseId) {
        return {
          type: "none" as const,
          source: "youtube" as const,
          trackFingerprint: fingerprint
        };
      }

      const browseUrl = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";
      const browsePayload = { ...CONTEXT_PAYLOAD, browseId: lyricsBrowseId };

      const browseRes = await fetch(browseUrl, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(browsePayload),
        signal
      });

      if (!browseRes.ok) throw new Error("YouTube browse response not ok");
      const browseData = await browseRes.json();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timedLyrics: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchLyrics = (node: any) => {
        if (!node) return;
        if (typeof node === "object" && !Array.isArray(node)) {
          if (node.timedLyricsData) {
            timedLyrics.push(...node.timedLyricsData);
          } else {
            Object.values(node).forEach(searchLyrics);
          }
        } else if (Array.isArray(node)) {
          node.forEach(searchLyrics);
        }
      };

      searchLyrics(browseData);

      if (timedLyrics.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = timedLyrics.map((lineData: any) => {
          const lyric = lineData.lyricLine || "";
          const cue = lineData.cueRange || {};
          const startMs = parseInt(cue.startTimeMilliseconds || "0", 10);
          const endMs = parseInt(cue.endTimeMilliseconds || "0", 10);

          return {
            startMs,
            endMs,
            text: lyric
          };
        });

        // Some items may be just '♪', we can decide to keep them or not, but usually keeping is fine.
        return {
          type: "synced" as const,
          lines,
          source: "youtube" as const,
          trackFingerprint: fingerprint
        };
      } else {
        // Plain text extraction
        let textLyrics = "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const searchPlain = (node: any) => {
          if (!node) return;
          if (typeof node === "object" && !Array.isArray(node)) {
            if (node.text && typeof node.text === "string" && node.text.length > 20 && node.text.includes("\n")) {
              textLyrics = node.text;
            } else {
              Object.values(node).forEach(searchPlain);
            }
          } else if (Array.isArray(node)) {
            node.forEach(searchPlain);
          }
        };

        searchPlain(browseData);

        if (textLyrics) {
          return {
            type: "plain" as const,
            source: "youtube" as const,
            plainText: textLyrics,
            trackFingerprint: fingerprint
          };
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (signal?.aborted) throw err;
      log.warn("YouTubeProvider failed", err);
    }

    return {
      type: "none" as const,
      source: "youtube" as const,
      trackFingerprint: fingerprint
    };
  }
}
