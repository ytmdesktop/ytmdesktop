import { EventEmitter } from "events";

class PlayerStateStore {
  private videoProgress = 0;
  private state = -1;
  private videoDetails: any | null = null;
  private playlistId: string | null = null;
  private queue: any | null = null;
  private eventEmitter = new EventEmitter();

  public getState() {
    return {
      videoDetails: this.videoDetails,
      playlistId: this.playlistId,
      trackState: this.state,
      queue: this.queue,
      videoProgress: this.videoProgress
    };
  }

  public getQueue() {
    return this.queue;
  }

  public getPlaylistId() {
    return this.playlistId;
  }

  public updateVideoProgress(progress: any) {
    this.videoProgress = progress;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoState(state: any) {
    this.state = state;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoDetails(videoDetails: any, playlistId: string) {
    this.videoDetails = videoDetails;
    this.playlistId = playlistId;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateQueue(queueState: any) {
    this.queue = queueState;
  }

  public addEventListener(listener: (...args: any[]) => void) {
    this.eventEmitter.addListener("stateChanged", listener);
  }

  public removeEventListener(listener: (...args: any[]) => void) {
    this.eventEmitter.removeListener("stateChanged", listener);
  }
}

export default new PlayerStateStore();
