import { BrowserView } from "electron";
import playerStateStore, { PlayerState, Thumbnail, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import { MediaServiceProvider, MediaType, PlaybackStatus, ThumbnailType } from "xosms/dist/binding";

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
  private mediaServiceProvider: MediaServiceProvider = new MediaServiceProvider("ytmd", "YouTube Music Desktop App");
  private ytmView: BrowserView | null = null;

  constructor() {
    this.mediaServiceProvider.buttonPressed = (button: unknown) => {
      if (this.ytmView !== null) {
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
          default:
            break;
        }
      }
    };
    this.mediaServiceProvider.isEnabled = true;
    this.mediaServiceProvider.nextButtonEnabled = true;
    this.mediaServiceProvider.pauseButtonEnabled = true;
    this.mediaServiceProvider.playButtonEnabled = true;
    this.mediaServiceProvider.previousButtonEnabled = true;
    this.mediaServiceProvider.trackId = "'/org/mpris/MediaPlayer2/ytmdesktop'";
  }

  private playerStateChanged(state: PlayerState) {
    if (this.enabled && state.videoDetails) {
      this.mediaServiceProvider.mediaType = MediaType.Music;
      if (state.videoDetails.album !== null && state.videoDetails.album !== undefined) this.mediaServiceProvider.albumTitle = state.videoDetails.album;
      this.mediaServiceProvider.artist = state.videoDetails.author;
      this.mediaServiceProvider.title = state.videoDetails.title;
      this.mediaServiceProvider.trackId = state.videoDetails.id;
      this.mediaServiceProvider.setThumbnail(ThumbnailType.Uri, getHighestResThumbnail(state.videoDetails.thumbnails));

      if (state.trackState === VideoState.Playing) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Playing;
      if (state.trackState === VideoState.Paused) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Paused;
      if (state.trackState === VideoState.Buffering) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Changing;
      if (state.trackState === VideoState.Unknown) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Closed;
    } else if (this.enabled && !state.videoDetails) {
      this.mediaServiceProvider.playbackStatus = PlaybackStatus.Closed;
    }
  }

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  public enable(): void {
    this.mediaServiceProvider.isEnabled = true;
    this.enabled = true;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };
    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    this.mediaServiceProvider.isEnabled = false;
    this.enabled = false;
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
