import crypto from "node:crypto";

const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

export type LastFMUpdateNowPlayingParams = {
  artist: string;
  track: string;
  album?: string;
  trackNumber?: number;
  context?: string;
  mbid?: string;
  duration?: number;
  albumArtist?: string;
};

export type LastFMScrobbleParams = {
  artist: string;
  track: string;
  timestamp: number;
  album?: string;
  context?: string;
  streamId?: string;
  chosenByUser?: boolean;
  trackNumber?: number;
  mbid?: string;
  albumArtist?: string;
  duration?: number;
};

export default class LastFMClient {
  private apiKey: string;
  private apiSecret: string;
  private sessionKey?: string;

  constructor(apiKey: string, apiSecret: string, sessionKey?: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.sessionKey = sessionKey;
  }

  private sign(body) {
    const bodySignature = Object.keys(body)
      .sort()
      .map((key) => `${key}${body[key]}`)
      .join("");
    return crypto
      .createHash("md5")
      .update(bodySignature + this.apiSecret, "utf8")
      .digest("hex");
  }

  private async call(method: string, params = {}, authenticated = true) {
    const strippedParams = Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value != null && value != undefined),
    );
    const body = {
      ...strippedParams,
      method,
      api_key: this.apiKey,
    };
    if (authenticated) body.sk = this.sessionKey;
    body.api_sig = this.sign(body);
    body.format = "json";

    const response = await fetch(LASTFM_ENDPOINT, {
      method: "POST",
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(15 * 1000),
    });

    if (!response.ok) {
      throw new Error(
        `LastFM returned a non 200 range status code: ${response.status}`,
      );
    }

    const data = await response.json();
    if (data.error) {
      const error = new Error(data.message || "LastFM returned an error");
      error.cause = data.error;
      throw error;
    }

    return data;
  }

  public async getToken() {
    const data = await this.call("auth.getToken", {}, false);
    return data.token;
  }

  public async getSession(token: string): Promise<string> {
    const data = await this.call("auth.getSession", { token }, false);
    this.sessionKey = data.session.key;
    return this.sessionKey!;
  }

  public async updateNowPlaying(params: LastFMUpdateNowPlayingParams) {
    await this.call("track.updateNowPlaying", params);
  }

  public async scrobble(params: LastFMScrobbleParams) {
    await this.call("track.scrobble", params);
  }
}
