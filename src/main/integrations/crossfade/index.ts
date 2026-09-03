import { BrowserView } from "electron";
import log from "electron-log";
import playerStateStore, { PlayerState, VideoState } from "../../player-state-store";
import IIntegration from "../integration";

const FADE_INTERVAL_MS = 100;

export default class Crossfade implements IIntegration {
  private ytmView: BrowserView;
  private isEnabled = false;
  private fadeDurationSeconds = 6;

  private playerStateListener: (state: PlayerState) => void;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private currentTrackId: string | null = null;
  private userVolume: number | null = null;
  private isFadingOut = false;
  private isFadingIn = false;
  private fadedOut = false;

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  public enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;

    this.playerStateListener = (state: PlayerState) => this.onPlayerStateChanged(state);
    playerStateStore.addEventListener(this.playerStateListener);
    log.info("Crossfade: enabled");
  }

  public disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;

    this.stopFade();
    playerStateStore.removeEventListener(this.playerStateListener);

    if (this.userVolume !== null) {
      this.setVolume(this.userVolume);
      this.userVolume = null;
    }

    this.currentTrackId = null;
    this.fadedOut = false;
    log.info("Crossfade: disabled");
  }

  public setFadeDuration(seconds: number): void {
    this.fadeDurationSeconds = Math.max(1, Math.min(12, seconds));
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private onPlayerStateChanged(state: PlayerState): void {
    if (!this.isEnabled || !state.videoDetails) return;

    // Detect track change
    const trackId = state.videoDetails.id;
    if (trackId !== this.currentTrackId) {
      this.onTrackChanged(state);
      this.currentTrackId = trackId;
      return;
    }

    // Only process fade-out logic while playing
    if (state.trackState !== VideoState.Playing) return;

    // Capture the user's volume when not fading (so we can restore it later)
    if (!this.isFadingOut && !this.isFadingIn) {
      this.userVolume = state.volume;
    }

    const duration = state.videoDetails.durationSeconds;
    const progress = state.videoProgress;
    if (duration <= 0 || progress <= 0) return;

    // Don't crossfade on very short tracks or live streams
    if (state.videoDetails.isLive || duration < this.fadeDurationSeconds * 2) return;

    const timeRemaining = duration - progress;

    // Start fade-out when we're within the fade duration of the end
    if (timeRemaining <= this.fadeDurationSeconds && !this.isFadingOut && !this.isFadingIn) {
      this.startFadeOut();
    }
  }

  private onTrackChanged(state: PlayerState): void {
    // If we were fading out or completed a fade-out, start fading in.
    if (this.isFadingOut || this.fadedOut) {
      this.stopFade();
      this.fadedOut = false;
      this.startFadeIn();
    } else if (this.userVolume !== null && this.isFadingIn) {
      // Already fading in from a previous track change, let it continue
    } else {
      // Track changed without crossfade (e.g., user skipped). Reset state.
      this.userVolume = state.volume;
    }
  }

  private startFadeOut(): void {
    if (this.userVolume === null || this.userVolume <= 0) return;

    this.isFadingOut = true;
    this.isFadingIn = false;
    this.stopFade();

    const totalSteps = Math.floor((this.fadeDurationSeconds * 1000) / FADE_INTERVAL_MS);
    const volumeDecrement = this.userVolume / totalSteps;
    let currentVolume = this.userVolume;
    let step = 0;

    log.info(`Crossfade: fading out over ${this.fadeDurationSeconds}s from volume ${this.userVolume}`);

    this.fadeTimer = setInterval(() => {
      step++;
      currentVolume = Math.max(0, this.userVolume - volumeDecrement * step);

      if (step >= totalSteps) {
        currentVolume = 0;
        this.stopFade();
        this.isFadingOut = false;
        this.fadedOut = true;
      }

      this.setVolume(Math.round(currentVolume));
    }, FADE_INTERVAL_MS);
  }

  private startFadeIn(): void {
    if (this.userVolume === null || this.userVolume <= 0) {
      this.isFadingIn = false;
      return;
    }

    this.isFadingIn = true;
    this.isFadingOut = false;
    this.stopFade();

    const totalSteps = Math.floor((this.fadeDurationSeconds * 1000) / FADE_INTERVAL_MS);
    const volumeIncrement = this.userVolume / totalSteps;
    let step = 0;

    log.info(`Crossfade: fading in over ${this.fadeDurationSeconds}s to volume ${this.userVolume}`);

    // Start from 0
    this.setVolume(0);

    this.fadeTimer = setInterval(() => {
      step++;
      const currentVolume = Math.min(this.userVolume, volumeIncrement * step);

      if (step >= totalSteps) {
        this.setVolume(this.userVolume);
        this.stopFade();
        this.isFadingIn = false;
        log.info("Crossfade: fade-in complete");
        return;
      }

      this.setVolume(Math.round(currentVolume));
    }, FADE_INTERVAL_MS);
  }

  private stopFade(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private setVolume(volume: number): void {
    if (!this.ytmView || this.ytmView.webContents.isDestroyed()) return;
    this.ytmView.webContents.send("remoteControl:execute", "setVolume", volume);
  }
}
