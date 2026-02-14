import { parseSyncedLyricsToLines } from "../lrc";
import { LyricsProvider, LyricsResult, TrackInfo } from "../types";
import { createTrackFingerprint } from "./lrclib";

type MusixmatchTokenResponse = {
  message?: {
    body?: {
      user_token?: string;
    };
  };
};

type MusixmatchMacroResponse = {
  message?: {
    body?: {
      macro_calls?: Record<string, { message?: { body?: Record<string, unknown> } }>;
    };
  };
};

function extractSubtitleBody(payload: MusixmatchMacroResponse): string | null {
  const calls = payload.message?.body?.macro_calls;
  if (!calls) {
    return null;
  }

  const candidates = [
    calls["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body,
    calls["track.subtitle.get"]?.message?.body?.subtitle?.subtitle_body,
    calls["matcher.subtitle.get"]?.message?.body?.subtitle?.subtitle_body
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function extractPlainLyrics(payload: MusixmatchMacroResponse): string | null {
  const calls = payload.message?.body?.macro_calls;
  if (!calls) {
    return null;
  }

  const lyricsBody = calls["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
  if (typeof lyricsBody === "string" && lyricsBody.trim()) {
    return lyricsBody.trim();
  }
  return null;
}

export default class MusixmatchProvider implements LyricsProvider {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private apiKey: string | null = null;

  public setApiKey(value: string | null | undefined) {
    const normalized = value?.trim();
    this.apiKey = normalized ? normalized : null;
  }

  private async fetchWithTimeout(url: string, timeoutMs = 8000, signal?: AbortSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async searchWithApiKey(track: TrackInfo, preferSynced: boolean, signal?: AbortSignal): Promise<LyricsResult | null> {
    if (!this.apiKey) {
      return null;
    }

    const trackFingerprint = createTrackFingerprint(track);

    const subtitleEndpoint = new URL("https://api.musixmatch.com/ws/1.1/matcher.subtitle.get");
    subtitleEndpoint.searchParams.set("format", "json");
    subtitleEndpoint.searchParams.set("subtitle_format", "lrc");
    subtitleEndpoint.searchParams.set("q_track", track.title);
    subtitleEndpoint.searchParams.set("q_artist", track.artist);
    if (track.album) {
      subtitleEndpoint.searchParams.set("q_album", track.album);
    }
    subtitleEndpoint.searchParams.set("apikey", this.apiKey);

    try {
      const subtitleResponse = await this.fetchWithTimeout(subtitleEndpoint.toString(), 8000, signal);
      if (subtitleResponse.ok) {
        const subtitlePayload = (await subtitleResponse.json()) as {
          message?: {
            body?: {
              subtitle?: {
                subtitle_body?: string;
              };
            };
          };
        };

        const subtitleBody = subtitlePayload.message?.body?.subtitle?.subtitle_body;
        if (typeof subtitleBody === "string" && subtitleBody.trim()) {
          const lines = parseSyncedLyricsToLines(subtitleBody);
          if (lines.length > 0) {
            return {
              type: "synced",
              lines,
              source: "musixmatch",
              trackFingerprint
            };
          }
        }
      }
    } catch {
      // ignored; fallback paths below
    }

    const plainEndpoint = new URL("https://api.musixmatch.com/ws/1.1/matcher.lyrics.get");
    plainEndpoint.searchParams.set("format", "json");
    plainEndpoint.searchParams.set("q_track", track.title);
    plainEndpoint.searchParams.set("q_artist", track.artist);
    plainEndpoint.searchParams.set("apikey", this.apiKey);

    try {
      const plainResponse = await this.fetchWithTimeout(plainEndpoint.toString(), 8000, signal);
      if (!plainResponse.ok) {
        return null;
      }

      const plainPayload = (await plainResponse.json()) as {
        message?: {
          body?: {
            lyrics?: {
              lyrics_body?: string;
            };
          };
        };
      };

      const plainLyrics = plainPayload.message?.body?.lyrics?.lyrics_body;
      if (typeof plainLyrics === "string" && plainLyrics.trim()) {
        return {
          type: preferSynced ? "plain" : "plain",
          plainText: plainLyrics.trim(),
          source: "musixmatch",
          trackFingerprint
        };
      }
    } catch {
      // ignored; fallback to public endpoint
    }

    return null;
  }

  private async getToken(signal?: AbortSignal) {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout("https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0", 8000, signal);
    } catch {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as MusixmatchTokenResponse;
    const token = payload.message?.body?.user_token;
    if (!token) {
      return null;
    }

    this.token = token;
    this.tokenExpiresAt = Date.now() + 1000 * 55;
    return token;
  }

  public async search(track: TrackInfo, preferSynced: boolean, signal?: AbortSignal): Promise<LyricsResult> {
    const trackFingerprint = createTrackFingerprint(track);

    const keyedResult = await this.searchWithApiKey(track, preferSynced, signal);
    if (keyedResult) {
      return keyedResult;
    }

    let token: string | null;
    try {
      token = await this.getToken(signal);
    } catch {
      token = null;
    }

    if (!token) {
      return {
        type: "none",
        source: "musixmatch",
        trackFingerprint
      };
    }

    const endpoint = new URL("https://www.musixmatch.com/ws/1.1/macro.subtitles.get");
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("namespace", "lyrics_richsynched");
    endpoint.searchParams.set("subtitle_format", "lrc");
    endpoint.searchParams.set("app_id", "web-desktop-app-v1.0");
    endpoint.searchParams.set("usertoken", token);
    endpoint.searchParams.set("q_track", track.title);
    endpoint.searchParams.set("q_artist", track.artist);
    if (track.album) {
      endpoint.searchParams.set("q_album", track.album);
    }
    if (typeof track.durationSeconds === "number") {
      endpoint.searchParams.set("q_duration", String(Math.round(track.durationSeconds)));
    }

    try {
      const response = await this.fetchWithTimeout(endpoint.toString(), 8000, signal);

      if (!response.ok) {
        return {
          type: "none",
          source: "musixmatch",
          trackFingerprint
        };
      }

      const payload = (await response.json()) as MusixmatchMacroResponse;
      const subtitleBody = extractSubtitleBody(payload);
      const plainLyrics = extractPlainLyrics(payload);

      if (subtitleBody) {
        const lines = parseSyncedLyricsToLines(subtitleBody);
        if (lines.length > 0) {
          return {
            type: "synced",
            lines,
            source: "musixmatch",
            trackFingerprint
          };
        }
      }

      if (plainLyrics) {
        return {
          type: preferSynced ? "plain" : "plain",
          plainText: plainLyrics,
          source: "musixmatch",
          trackFingerprint
        };
      }
    } catch {
      // noop
    }

    return {
      type: "none",
      source: "musixmatch",
      trackFingerprint
    };
  }
}
