import { app } from "electron";
import PlayerStateStore from "../../services/playerstatestore";
import { MediaPlayer, MediaPlayerThumbnail } from "xosms";
import Integration from "../integration";
import ConfigStore from "../../services/configstore";
import { PlayerState, RepeatMode, Thumbnail, VideoState } from "~shared/playerstatestore/types";
import ProtectedAPIManager from "../../services/protectedapimanager";
import os from "node:os";

function getHighestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 0;
  let currentHeight = 0;
  let url = null;
  for (const thumbnail of thumbnails) {
    if (thumbnail.width > currentWidth && thumbnail.height > currentHeight) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

export default class EnhancedMediaService extends Integration {
  public name = "EnhancedMediaService";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.enhancedMediaServiceEnabled";
  public override disableFlags = ["disable_enhanced_media_service"];

  private stateCallback: ((event: PlayerState) => void) | null = null;
  private mediaPlayer: MediaPlayer = new MediaPlayer("ytmdesktop", "YTMDesktop");

  private lastVideoDetailsTitle: string | null = null;
  private lastVideoDetailsAlbum: string | null = null;
  private lastVideoDetailsAuthor: string | null = null;
  private lastVideoDetailsId: string | null = null;
  private lastTrackState: VideoState | null = null;
  private lastThumbnail: string | null = null;
  private lastDurationSeconds: number | null = null;
  private lastVideoProgress: number | null = null;
  private lastVolume: number | null = null;
  private lastShuffleEnabled: boolean | null = null;
  private lastRepeatMode: RepeatMode | null = null;

  constructor() {
    super();

    this.mediaPlayer.setButtonPressedCallback(button => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      switch (button) {
        case "playpause":
          remoteControlApi.postMessage("execute", "playPause");
          break;
        case "play":
          remoteControlApi.postMessage("execute", "play");
          break;
        case "pause":
          remoteControlApi.postMessage("execute", "pause");
          break;
        case "stop":
          remoteControlApi.postMessage("execute", "pause");
          break;
        case "next":
          remoteControlApi.postMessage("execute", "next");
          break;
        case "previous":
          remoteControlApi.postMessage("execute", "previous");
          break;
      }
    });
    this.mediaPlayer.setPositionChangedCallback(position => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      const playerStateStore = this.getService(PlayerStateStore);
      if (position >= 0 && position <= playerStateStore.getState().videoDetails.durationSeconds) remoteControlApi.postMessage("execute", "seekTo", position);
    });
    this.mediaPlayer.setPositionSeekedCallback(seek => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      const playerStateStore = this.getService(PlayerStateStore);
      let newProgress = playerStateStore.getState().videoProgress + seek;
      if (newProgress <= 0) newProgress = 0;

      // Behavior aligns with MPRIS documentation
      if (newProgress > playerStateStore.getState().videoDetails.durationSeconds) {
        remoteControlApi.postMessage("execute", "next");
      } else {
        remoteControlApi.postMessage("execute", "seekTo", newProgress);
      }
    });
    this.mediaPlayer.setLoopChangedCallback(loop => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      switch (loop) {
        case "none":
          remoteControlApi.postMessage("execute", "repeatMode", "NONE");
          break;
        case "playlist":
          remoteControlApi.postMessage("execute", "repeatMode", "ALL");
          break;
        case "track":
          remoteControlApi.postMessage("execute", "repeatMode", "ONE");
          break;
      }
    });
    this.mediaPlayer.setShuffleChangedCallback(() => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      remoteControlApi.postMessage("execute", "shuffle");
    });
    this.mediaPlayer.setVolumeChangedCallback(volume => {
      const remoteControlApi = this.getService(ProtectedAPIManager).createOrGetAPI("RemoteControl");
      let newVolume = volume;
      if (os.platform() === "linux") {
        newVolume = newVolume * 100;
      }
      remoteControlApi.postMessage("execute", "setVolume", newVolume);
    });

    this.mediaPlayer.nextButtonEnabled = true;
    this.mediaPlayer.pauseButtonEnabled = true;
    this.mediaPlayer.playButtonEnabled = true;
    this.mediaPlayer.previousButtonEnabled = true;
    this.mediaPlayer.seekEnabled = true;
  }

  private async playerStateChanged(state: PlayerState) {
    if (this.isEnabled && state.videoDetails && state.hasFullMetadata) {
      let needUpdate = false;
      if (state.videoDetails.title !== this.lastVideoDetailsTitle) {
        this.lastVideoDetailsTitle = state.videoDetails.title;
        this.mediaPlayer.title = state.videoDetails.title;

        needUpdate = true;
      }

      if (state.videoDetails.author !== this.lastVideoDetailsAuthor) {
        this.lastVideoDetailsAuthor = state.videoDetails.author;
        this.mediaPlayer.artist = [state.videoDetails.author];

        needUpdate = true;
      }

      if (state.videoDetails.id !== this.lastVideoDetailsId) {
        this.lastVideoDetailsId = state.videoDetails.id;
        this.mediaPlayer.trackId = state.videoDetails.id;
      }

      if (state.trackState !== this.lastTrackState) {
        this.lastTrackState = state.trackState;

        if (state.trackState === VideoState.Playing) this.mediaPlayer.playbackStatus = "playing";
        if (state.trackState === VideoState.Paused) this.mediaPlayer.playbackStatus = "paused";
        // No buffering indicator for the media service so we'll indicate it's paused which will keep some controllers happy as well and allow certain functionality to work
        if (state.trackState === VideoState.Buffering) this.mediaPlayer.playbackStatus = "paused";
        if (state.trackState === VideoState.Unknown) this.mediaPlayer.playbackStatus = "stopped";

        needUpdate = true;
      }

      const thumbnail = getHighestResThumbnail(state.videoDetails.thumbnails);
      if (thumbnail !== null && thumbnail !== this.lastThumbnail) {
        this.lastThumbnail = thumbnail;
        this.mediaPlayer.thumbnail = await MediaPlayerThumbnail.create("uri", thumbnail);

        needUpdate = true;
      }

      if (state.videoDetails.album !== this.lastVideoDetailsAlbum) {
        this.lastVideoDetailsAlbum = state.videoDetails.album;
        if (state.videoDetails.album !== null && state.videoDetails.album !== undefined) {
          this.mediaPlayer.albumTitle = state.videoDetails.album;

          needUpdate = true;
        }
      }

      if (state.videoDetails.durationSeconds !== this.lastDurationSeconds || state.videoProgress !== this.lastVideoProgress) {
        this.lastVideoProgress = state.videoProgress;
        this.lastDurationSeconds = state.videoDetails.durationSeconds;
        this.mediaPlayer.setTimeline(state.videoDetails.durationSeconds, Math.max(0, Math.min(state.videoProgress, state.videoDetails.durationSeconds)));
      }

      if (state.volume !== this.lastVolume) {
        this.lastVolume = state.volume;
        let volume = state.volume;
        if (os.platform() === "linux") {
          volume = volume / 100;
        }
        this.mediaPlayer.volume = volume;

        needUpdate = true;
      }

      if (state.queue.shuffleEnabled !== this.lastShuffleEnabled) {
        this.lastShuffleEnabled = state.queue.shuffleEnabled;
        this.mediaPlayer.shuffle = state.queue.shuffleEnabled;

        needUpdate = true;
      }

      if (state.queue.repeatMode !== this.lastRepeatMode) {
        this.lastRepeatMode = state.queue.repeatMode;
        switch (state.queue.repeatMode) {
          case RepeatMode.None:
            this.mediaPlayer.loop = "none";
            break;
          case RepeatMode.All:
            this.mediaPlayer.loop = "playlist";
            break;
          case RepeatMode.One:
            this.mediaPlayer.loop = "track";
            break;
          default:
            this.mediaPlayer.loop = "none";
            break;
        }

        needUpdate = true;
      }

      if (needUpdate) {
        this.mediaPlayer.update();
      }
    } else if (this.isEnabled && !state.videoDetails) {
      this.mediaPlayer.playbackStatus = "stopped";
    }
  }

  public onSetup() {
    if (this.getService(ConfigStore).get("integrations.enhancedMediaServiceEnabled")) {
      app.commandLine.appendSwitch("disable-features", "MediaSessionService");
    }
  }

  public onEnabled(): void {
    this.mediaPlayer.activate();
    //this.mediaPlayer.mediaType = MediaPlayerMediaType.Music;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };

    const playerStateStore = this.getService(PlayerStateStore);
    playerStateStore.on("state-changed", this.stateCallback);
  }

  public onDisabled(): void {
    this.mediaPlayer.deactivate();
    if (this.stateCallback) {
      const playerStateStore = this.getService(PlayerStateStore);
      playerStateStore.off("state-changed", this.stateCallback);
    }
  }
}
