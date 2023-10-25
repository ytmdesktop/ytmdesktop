import { EventEmitter } from "events";

export enum VideoState {
  Unknown = -1,
  Paused = 0,
  Playing = 1,
  Buffering = 2
}

export enum RepeatMode {
  Unknown = -1,
  None = 0,
  All = 1,
  One = 2
}

export enum LikeStatus {
  Unknown = -1,
  Dislike = 0,
  Indifferent = 1,
  Like = 2
}

export type Thumbnail = {
  height: number;
  url: string;
  width: number;
};

export type VideoDetails = {
  album: string;
  albumId: string;
  author: string;
  channelId: string;
  durationSeconds: number;
  thumbnails: Thumbnail[];
  title: string;
  id: string;
  likeStatus: LikeStatus;
};

export type PlayerQueueItem = {
  thumbnails: Thumbnail[];
  title: string;
  author: string;
  duration: string;
  selected: boolean;
  videoId: string;
  counterparts: PlayerQueueItem[];
};

export type PlayerQueue = {
  automixItems: PlayerQueueItem[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  items: PlayerQueueItem[];
  repeatMode: RepeatMode;
  selectedItemIndex: number;
};

export type PlayerState = {
  videoDetails: VideoDetails;
  playlistId: string;
  trackState: VideoState;
  queue: PlayerQueue;
  videoProgress: number;
  volume: number;
};

enum YTMVideoState {
  UnknownNegativeOne = -1,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  UnknownFive = 5
}

type YTMThumbnail = {
  height: number;
  url: string;
  width: number;
};

type YTMTextRun = {
  text: string;
};

type YTMText = {
  runs: YTMTextRun[];
};

type YTMPlayerQueueItemVideoRenderer = {
  lengthText: YTMText;
  selected: boolean;
  shortBylineText: YTMText;
  thumbnail: {
    thumbnails: YTMThumbnail[];
  };
  title: YTMText;
  videoId: string;
};

type YTMPlayerQueueItemCounterpart = {
  counterpartRenderer: {
    playlistPanelVideoRenderer: YTMPlayerQueueItemVideoRenderer;
  };
};

type YTMPlayerQueueItem = {
  playlistPanelVideoRenderer: YTMPlayerQueueItemVideoRenderer | null;
  playlistPanelVideoWrapperRenderer: {
    primaryRenderer: {
      playlistPanelVideoRenderer: YTMPlayerQueueItemVideoRenderer;
    };
    counterpart: YTMPlayerQueueItemCounterpart[];
  } | null;
};

type YTMRepeatMode = "NONE" | "ALL" | "ONE";

type YTMLikeStatus = "INDIFFERENT" | "DISLIKE" | "LIKE";

type YTMPlayerQueue = {
  automixItems: YTMPlayerQueueItem[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  items: YTMPlayerQueueItem[];
  repeatMode: YTMRepeatMode;
};

type YTMVideoDetails = {
  album: string;
  author: string;
  channelId: string;
  lengthSeconds: string;
  thumbnail: {
    thumbnails: YTMThumbnail[];
  };
  title: string;
  videoId: string;
};

function getYTMTextRun(runs: YTMTextRun[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

function mapYTMThumbnails(thumbnail: YTMThumbnail) {
  // Explicit mapping to keep a consistent API
  // If YouTube Music changes how this is presented internally then it's easier to update without breaking the API
  return {
    url: thumbnail.url,
    width: thumbnail.width,
    height: thumbnail.height
  };
}

function mapCounterpart(counterpart: YTMPlayerQueueItemCounterpart) {
  // Explicit mapping to keep a consistent API
  // If YouTube Music changes how this is presented internally then it's easier to update without breaking the API
  return transformPlaylistPanelVideoRenderer(counterpart.counterpartRenderer.playlistPanelVideoRenderer);
}

function transformPlaylistPanelVideoRenderer(
  playlistPanelVideoRenderer: YTMPlayerQueueItemVideoRenderer,
  counterpart?: YTMPlayerQueueItemCounterpart[]
): PlayerQueueItem {
  return {
    thumbnails: playlistPanelVideoRenderer.thumbnail.thumbnails.map(mapYTMThumbnails),
    title: getYTMTextRun(playlistPanelVideoRenderer.title?.runs ?? [{ text: "" }]),
    author: getYTMTextRun(playlistPanelVideoRenderer.shortBylineText?.runs ?? [{ text: "" }]),
    duration: getYTMTextRun(playlistPanelVideoRenderer.lengthText?.runs ?? [{ text: "" }]),
    selected: playlistPanelVideoRenderer.selected,
    videoId: playlistPanelVideoRenderer.videoId,
    counterparts: counterpart ? counterpart.map(mapCounterpart) : null
  };
}

function mapYTMQueueItems(item: YTMPlayerQueueItem): PlayerQueueItem {
  let playlistPanelVideoRenderer;
  let counterpart;
  if (item.playlistPanelVideoRenderer) {
    playlistPanelVideoRenderer = item.playlistPanelVideoRenderer;
  } else if (item.playlistPanelVideoWrapperRenderer) {
    playlistPanelVideoRenderer = item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
    counterpart = item.playlistPanelVideoWrapperRenderer.counterpart;
  }

  // This probably shouldn't happen but in the off chance it does we need to return nothing
  if (!playlistPanelVideoRenderer) return null;

  return transformPlaylistPanelVideoRenderer(playlistPanelVideoRenderer, counterpart);
}

// This may seem redundant but we do this in case YTM changes its own data to accomodate and prevent severe breaking of things
function transformRepeatMode(repeatMode: YTMRepeatMode) {
  switch (repeatMode) {
    case "NONE": {
      return RepeatMode.None;
    }

    case "ALL": {
      return RepeatMode.All;
    }

    case "ONE": {
      return RepeatMode.One;
    }

    default: {
      return RepeatMode.Unknown;
    }
  }
}

function transformLikeStatus(likeStatus: YTMLikeStatus) {
  switch (likeStatus) {
    case "DISLIKE": {
      return LikeStatus.Dislike;
    }

    case "INDIFFERENT": {
      return LikeStatus.Indifferent;
    }

    case "LIKE": {
      return LikeStatus.Like;
    }

    default: {
      return LikeStatus.Unknown;
    }
  }
}

class PlayerStateStore {
  private videoProgress = 0;
  private state: VideoState = -1;
  private videoDetails: VideoDetails | null = null;
  private playlistId: string | null = null;
  private queue: PlayerQueue | null = null;
  private volume: number = 0;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.eventEmitter.on("error", error => {
      console.log("PlayerStateStore EventEmitter threw an error", error);
    });
  }

  public getState(): PlayerState {
    return {
      videoDetails: this.videoDetails,
      playlistId: this.playlistId,
      trackState: this.state,
      queue: this.queue,
      videoProgress: this.videoProgress,
      volume: this.volume
    };
  }

  public getQueue() {
    return this.queue;
  }

  public getPlaylistId() {
    return this.playlistId;
  }

  public updateVideoProgress(progress: number) {
    this.videoProgress = progress;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoState(state: YTMVideoState) {
    switch (state) {
      case YTMVideoState.Paused: {
        this.state = VideoState.Paused;
        break;
      }

      case YTMVideoState.Playing: {
        this.state = VideoState.Playing;
        break;
      }

      case YTMVideoState.Buffering: {
        this.state = VideoState.Buffering;
        break;
      }

      default: {
        this.state = VideoState.Unknown;
        break;
      }
    }
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoDetails(videoDetails: YTMVideoDetails, playlistId: string) {
    this.videoDetails = {
      author: videoDetails.author,
      channelId: videoDetails.channelId,
      title: videoDetails.title,
      album: null,
      albumId: null,
      likeStatus: LikeStatus.Unknown,
      thumbnails: videoDetails.thumbnail.thumbnails.map(mapYTMThumbnails),
      durationSeconds: parseInt(videoDetails.lengthSeconds),
      id: videoDetails.videoId
    };
    this.playlistId = playlistId;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateFromStore(
    queueState: YTMPlayerQueue | null,
    album: { id: string; text: YTMText } | null,
    likeStatus: YTMLikeStatus | null,
    volume: number | null
  ) {
    const queueItems = queueState ? queueState.items.map(mapYTMQueueItems) : [];
    this.queue = queueState
      ? {
          // automixItems comes from an autoplay queue that isn't pushed yet to the main queue. A radio will never have automixItems (weird YTM distinction from autoplay vs radio)
          automixItems: queueState.automixItems.map(mapYTMQueueItems),
          autoplay: queueState.autoplay,
          isGenerating: queueState.isGenerating,
          // Observed state seems to be a radio having infinite true while an autoplay queue has infinite false
          isInfinite: queueState.isInfinite,
          items: queueItems,
          repeatMode: transformRepeatMode(queueState.repeatMode),
          // YTM has a native selectedItemIndex property but that isn't updated correctly so we calculate it ourselves
          selectedItemIndex: queueItems.findIndex(item => {
            return item.selected;
          })
        }
      : null;
    if (this.videoDetails) {
      this.videoDetails.album = album?.text ? getYTMTextRun(album.text.runs) : null;
      this.videoDetails.albumId = album?.id;
      this.videoDetails.likeStatus = transformLikeStatus(likeStatus);
    }
    if (volume) {
      this.volume = volume;
    }
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public addEventListener(listener: (state: PlayerState) => void) {
    this.eventEmitter.addListener("stateChanged", listener);
  }

  public removeEventListener(listener: (state: PlayerState) => void) {
    this.eventEmitter.removeListener("stateChanged", listener);
  }
}

export default new PlayerStateStore();
