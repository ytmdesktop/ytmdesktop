import { app } from "electron";
import crypto from "node:crypto";
import log from "electron-log";

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

export enum LastFMErrorCode {
  Unknown1 = 1,
  InvalidService = 2,
  InvalidMethod = 3,
  AuthenticationFailed = 4,
  InvalidFormat = 5,
  InvalidParameters = 6,
  InvalidResourceSpecified = 7,
  OperationFailed = 8,
  InvalidSessionKey = 9,
  InvalidAPIKey = 10,
  ServiceOffline = 11,
  SubscribersOnly = 12,
  InvalidMethodSignature = 13,
  UnauthorizedToken = 14,
  NotAvailableForStreaming = 15,
  ServiceTemporarilyUnvailable = 16,
  RequiresLogin = 17,
  TrialExpired = 18,
  Unknown19 = 19,
  NotEnoughContent = 20,
  NotEnoughMembers = 21,
  NotEnoughFans = 22,
  NotEnoughNeighbors = 23,
  NoPeakRadio = 24,
  RadioNotFound = 25,
  APIKeySuspended = 26,
  Deprecated = 27,
  RateLimitExceeded = 29
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class LastFMClient {
  private apiKey: string;
  private apiSecret: string;
  private sessionKey?: string;

  private apiKeySuspended = false;

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

  private modifyClientForLastFMError(error: any) {
    if (error === LastFMErrorCode.InvalidSessionKey) {
      this.sessionKey = undefined;
    }

    if (error === LastFMErrorCode.APIKeySuspended) {
      log.warn("lastfm: api key suspended forbidding any future requests to lastfm");
      this.apiKeySuspended = true;
    }
  }

  private getRetryDelay(response: Response, attempt: number) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
      }

      const retryDate = Date.parse(retryAfter);
      if (Number.isFinite(retryDate)) {
        return Math.max(0, retryDate - Date.now());
      }
    }

    // Fallthrough to backoff retries
    const base = Math.min(1000 * 2 ** attempt, 60000);
    return base + Math.random() * Math.min(base * 0.2, 1000);
  }

  private async call(method: string, params = {}, authenticated = true) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.apiKeySuspended) {
        const error = new Error("LastFM API key suspended");
        error.cause = LastFMErrorCode.APIKeySuspended;
        throw error;
      }

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
        headers: {
          "User-Agent": `YTMDesktop/${app.getVersion()} (https://github.com/ytmdesktop/ytmdesktop)`
        }
      });

      const data = await response.json();
      if (data.error) {
        this.modifyClientForLastFMError(data.error);

        const rateLimited = response.status === 429 || data.error == LastFMErrorCode.RateLimitExceeded;
        const transientFailure = (response.status >= 500 && response.status <= 599) || [LastFMErrorCode.OperationFailed, LastFMErrorCode.ServiceOffline, LastFMErrorCode.ServiceTemporarilyUnvailable].includes(data.error);
        
        if (rateLimited || transientFailure) {
          await sleep(this.getRetryDelay(response, attempt));
          continue;
        }

        const error = new Error(data.message || "LastFM returned an error");
        error.cause = data.error;
        throw error;
      }

      return data;
    }

    throw new Error("LastFM request failed after 5 retries");
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
