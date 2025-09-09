import { app } from "electron";
import playerStateStore from "../../player-state-store";
import { MediaPlayer, MediaPlayerMediaType, MediaPlayerPlaybackStatus, MediaPlayerThumbnail, MediaPlayerThumbnailType } from "xosms";
import Integration from "../integration";
import ConfigStore from "../../services/configstore";
import YTMViewManager from "../../services/ytmviewmanager";
import { PlayerState, Thumbnail, VideoState } from "~shared/playerstatestore/types";

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

  private stateCallback: (event: PlayerState) => void = null;
  private mediaPlayer: MediaPlayer = new MediaPlayer("ytmdesktop", "YouTube Music Desktop App");

  private lastVideoDetailsTitle: string | null = null;
  private lastVideoDetailsAlbum: string | null = null;
  private lastVideoDetailsAuthor: string | null = null;
  private lastVideoDetailsId: string | null = null;
  private lastTrackState: VideoState | null = null;
  private lastThumbnail: string | null = null;
  private lastDurationSeconds: number | null = null;
  private lastVideoProgress: number | null = null;

  constructor() {
    super();

    this.mediaPlayer.on("buttonpressed", (_error: unknown, button: string) => {
      const ytmView = this.getService(YTMViewManager).getView();
      switch (button) {
        case "playpause":
          ytmView.webContents.send("remoteControl:execute", "playPause");
          break;
        case "play":
          ytmView.webContents.send("remoteControl:execute", "play");
          break;
        case "pause":
          ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        case "stop":
          ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        case "next":
          ytmView.webContents.send("remoteControl:execute", "next");
          break;
        case "previous":
          ytmView.webContents.send("remoteControl:execute", "previous");
          break;
      }
    });
    this.mediaPlayer.on("positionchanged", (_error: unknown, position: number) => {
      const ytmView = this.getService(YTMViewManager).getView();
      if (position >= 0 && position <= playerStateStore.getState().videoDetails.durationSeconds)
        ytmView.webContents.send("remoteControl:execute", "seekTo", position);
    });
    this.mediaPlayer.on("positionseeked", (_error: unknown, seek: number) => {
      const ytmView = this.getService(YTMViewManager).getView();
      let newProgress = playerStateStore.getState().videoProgress + seek;
      if (newProgress <= 0) newProgress = 0;

      // Behavior aligns with MPRIS documentation
      if (newProgress > playerStateStore.getState().videoDetails.durationSeconds) {
        ytmView.webContents.send("remoteControl:execute", "next");
      } else {
        ytmView.webContents.send("remoteControl:execute", "seekTo", newProgress);
      }
    });

    this.mediaPlayer.nextButtonEnabled = true;
    this.mediaPlayer.pauseButtonEnabled = true;
    this.mediaPlayer.playButtonEnabled = true;
    this.mediaPlayer.previousButtonEnabled = true;
    this.mediaPlayer.seekEnabled = true;

    this.mediaPlayer.deactivate();
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
        this.mediaPlayer.artist = state.videoDetails.author;

        needUpdate = true;
      }

      if (state.videoDetails.id !== this.lastVideoDetailsId) {
        this.lastVideoDetailsId = state.videoDetails.id;
        this.mediaPlayer.trackId = state.videoDetails.id;
      }

      if (state.trackState !== this.lastTrackState) {
        this.lastTrackState = state.trackState;

        if (state.trackState === VideoState.Playing) this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Playing;
        if (state.trackState === VideoState.Paused) this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Paused;
        // No buffering indicator for the media service so we'll indicate it's paused which will keep some controllers happy as well and allow certain functionality to work
        if (state.trackState === VideoState.Buffering) this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Paused;
        if (state.trackState === VideoState.Unknown) this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Stopped;

        needUpdate = true;
      }

      const thumbnail = getHighestResThumbnail(state.videoDetails.thumbnails);
      if (thumbnail !== this.lastThumbnail) {
        this.lastThumbnail = thumbnail;
        this.mediaPlayer.setThumbnail(await MediaPlayerThumbnail.create(MediaPlayerThumbnailType.Uri, thumbnail));

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

      if (needUpdate) {
        this.mediaPlayer.update();
      }
    } else if (this.isEnabled && !state.videoDetails) {
      this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Stopped;
    }
  }

  public onSetup() {
    if (this.getService(ConfigStore).get("integrations.enhancedMediaServiceEnabled")) {
      app.commandLine.appendSwitch("disable-features", "MediaSessionService");
    }
  }

  public onEnabled(): void {
    this.mediaPlayer.activate();
    this.mediaPlayer.mediaType = MediaPlayerMediaType.Music;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };
    playerStateStore.addEventListener(this.stateCallback);
  }

  public onDisabled(): void {
    this.mediaPlayer.deactivate();
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }
}
