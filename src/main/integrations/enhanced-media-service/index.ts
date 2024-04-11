import { BrowserView } from "electron";
import playerStateStore, { PlayerState, Thumbnail, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import { MediaPlayer, MediaPlayerMediaType, MediaPlayerPlaybackStatus, MediaPlayerThumbnail, MediaPlayerThumbnailType } from "xosms";

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

export default class EnhancedMediaService implements IIntegration {
  private enabled = false;
  private stateCallback: (event: PlayerState) => void = null;
  private mediaPlayer: MediaPlayer = new MediaPlayer("ytmdesktop", "YouTube Music Desktop App");
  private ytmView: BrowserView | null = null;

  private lastVideoDetailsTitle: string | null = null;
  private lastVideoDetailsAlbum: string | null = null;
  private lastVideoDetailsAuthor: string | null = null;
  private lastVideoDetailsId: string | null = null;
  private lastTrackState: VideoState | null = null;
  private lastThumbnail: string | null = null;
  private lastDurationSeconds: number | null = null;
  private lastVideoProgress: number | null = null;

  constructor() {
    this.mediaPlayer.on("buttonpressed", (_error: unknown, button: string) => {
      switch (button) {
        case "playpause":
          this.ytmView.webContents.send("remoteControl:execute", "playPause");
          break;
        case "play":
          this.ytmView.webContents.send("remoteControl:execute", "play");
          break;
        case "pause":
          this.ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        case "stop":
          this.ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        case "next":
          this.ytmView.webContents.send("remoteControl:execute", "next");
          break;
        case "previous":
          this.ytmView.webContents.send("remoteControl:execute", "previous");
          break;
      }
    });
    this.mediaPlayer.on("positionchanged", (_error: unknown, position: number) => {
      if (this.ytmView !== null) {
        if (position >= 0 && position <= playerStateStore.getState().videoDetails.durationSeconds)
          this.ytmView.webContents.send("remoteControl:execute", "seekTo", position);
      }
    });
    this.mediaPlayer.on("positionseeked", (_error: unknown, seek: number) => {
      if (this.ytmView !== null) {
        let newProgress = this.lastVideoProgress + seek;
        if (newProgress <= 0) newProgress = 0;

        // Behavior aligns with MPRIS documentation
        if (newProgress > this.lastDurationSeconds) {
          this.ytmView.webContents.send("remoteControl:execute", "next");
        } else {
          this.ytmView.webContents.send("remoteControl:execute", "seekTo", newProgress);
        }
      }
    });

    this.mediaPlayer.nextButtonEnabled = true;
    this.mediaPlayer.pauseButtonEnabled = true;
    this.mediaPlayer.playButtonEnabled = true;
    this.mediaPlayer.previousButtonEnabled = true;
    this.mediaPlayer.seekEnabled = true;
  }

  private async playerStateChanged(state: PlayerState) {
    if (this.enabled && state.videoDetails) {
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
        if (state.trackState === VideoState.Buffering) this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Stopped;
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
        this.lastVideoProgress == state.videoProgress;
        this.mediaPlayer.setTimeline(state.videoDetails.durationSeconds, Math.max(0, Math.min(state.videoProgress, state.videoDetails.durationSeconds)));
      }

      if (needUpdate) {
        this.mediaPlayer.update();
      }
    } else if (this.enabled && !state.videoDetails) {
      this.mediaPlayer.playbackStatus = MediaPlayerPlaybackStatus.Stopped;
    }
  }

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  public enable(): void {
    this.mediaPlayer.activate();
    this.mediaPlayer.mediaType = MediaPlayerMediaType.Music;
    this.enabled = true;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };
    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    this.mediaPlayer.deactivate();
    this.enabled = false;
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
