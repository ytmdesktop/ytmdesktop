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

export enum VideoType {
  Unknown = -1,
  MusicAudio = 0,
  MusicVideo = 1,
  MusicUploaded = 2,
  PodcastEpisode = 3
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
  videoType: VideoType;
  isLive: boolean;
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
  muted: boolean;
  adPlaying: boolean;
  hasFullMetadata: boolean;
};

enum YTMVideoState {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  VideoCued = 5
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
  isLive: boolean;
  musicVideoType: string;
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

function transformVideoType(videoType: string) {
  switch (videoType) {
    case "MUSIC_VIDEO_TYPE_ATV": {
      return VideoType.MusicAudio;
    }

    case "MUSIC_VIDEO_TYPE_OMV":
    case "MUSIC_VIDEO_TYPE_UGC": {
      return VideoType.MusicVideo;
    }

    case "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK": {
      return VideoType.MusicUploaded;
    }

    case "MUSIC_VIDEO_TYPE_PODCAST_EPISODE": {
      return VideoType.PodcastEpisode;
    }

    default: {
      return VideoType.Unknown;
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
  private muted: boolean = false;
  private adPlaying: boolean = false;
  private hasFullMetadata: boolean = false;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.eventEmitter.on("error", error => {
      console.error("PlayerStateStore EventEmitter threw an error", error);
    });
  }

  public getState(): PlayerState {
    return {
      videoDetails: this.videoDetails,
      playlistId: this.playlistId,
      trackState: this.state,
      queue: this.queue,
      videoProgress: this.videoProgress,
      volume: this.volume,
      muted: this.muted,
      adPlaying: this.adPlaying,
      hasFullMetadata: this.hasFullMetadata
    };
  }

  public getQueue() {
    return this.queue;
  }

  public getPlaylistId() {
    return this.playlistId;
  }

  public updateVideoProgress(progress: number) {
    try {
      if (typeof progress === "number" && !isNaN(progress)) {
        this.videoProgress = progress;
        this.eventEmitter.emit("stateChanged", this.getState());
      }
    } catch (error) {
      console.error("Error in updateVideoProgress:", error);
    }
  }

  public updateVideoState(state: YTMVideoState) {
    try {
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
    } catch (error) {
      console.error("Error in updateVideoState:", error);
    }
  }

  public updateVideoDetails(
    videoDetails: YTMVideoDetails,
    playlistId: string,
    album: { id: string; text: string } | null,
    likeStatus: YTMLikeStatus,
    hasFullMetadata: boolean
  ) {
    try {
      if (!videoDetails) {
        console.warn("updateVideoDetails received null videoDetails");
        return;
      }

      this.videoDetails = {
        author: videoDetails.author || "",
        channelId: videoDetails.channelId || "",
        title: videoDetails.title || "",
        album: album?.text ?? null,
        albumId: album?.id ?? null,
        likeStatus: transformLikeStatus(likeStatus),
        thumbnails: videoDetails.thumbnail?.thumbnails?.map(mapYTMThumbnails) || [],
        durationSeconds: parseInt(videoDetails.lengthSeconds || "0") || 0,
        id: videoDetails.videoId || "",
        videoType: transformVideoType(videoDetails.musicVideoType || ""),
        isLive: !!videoDetails.isLive
      };
      this.playlistId = playlistId || null;
      this.hasFullMetadata = !!hasFullMetadata;
      this.eventEmitter.emit("stateChanged", this.getState());
    } catch (error) {
      console.error("Error in updateVideoDetails:", error);
    }
  }

  public updateFromStore(
    queueState: YTMPlayerQueue | null,
    likeStatus: YTMLikeStatus | null,
    volume: number | null,
    muted: boolean | null,
    adPlaying: boolean | null
  ) {
    try {
      // Safely handle queue mapping with error handling
      let queueItems: PlayerQueueItem[] = [];
      let automixItems: PlayerQueueItem[] = [];

      if (queueState?.items) {
        queueItems = queueState.items
          .map(item => {
            try {
              return mapYTMQueueItems(item);
            } catch (err) {
              console.error("Error mapping queue item:", err);
              return null;
            }
          })
          .filter(Boolean);
      }

      if (queueState?.automixItems) {
        automixItems = queueState.automixItems
          .map(item => {
            try {
              return mapYTMQueueItems(item);
            } catch (err) {
              console.error("Error mapping automix item:", err);
              return null;
            }
          })
          .filter(Boolean);
      }

      this.queue = queueState
        ? {
            automixItems: automixItems,
            autoplay: !!queueState.autoplay,
            isGenerating: !!queueState.isGenerating,
            isInfinite: !!queueState.isInfinite,
            items: queueItems,
            repeatMode: transformRepeatMode(queueState.repeatMode),
            selectedItemIndex: queueItems.findIndex(item => item?.selected) || 0
          }
        : null;

      if (this.videoDetails && likeStatus) {
        this.videoDetails.likeStatus = transformLikeStatus(likeStatus);
      }

      this.adPlaying = adPlaying === true;
      this.muted = muted === true;
      if (typeof volume === "number" && volume >= 0 && !isNaN(volume)) {
        this.volume = volume;
      }

      this.eventEmitter.emit("stateChanged", this.getState());
    } catch (error) {
      console.error("Error in updateFromStore:", error);
    }
  }

  public addEventListener(listener: (state: PlayerState) => void) {
    if (typeof listener === "function") {
      try {
        // Wrap the listener in a try-catch to prevent errors from propagating
        const safeListener = (state: PlayerState) => {
          try {
            listener(state);
          } catch (error) {
            console.error("Error in player state listener:", error);
          }
        };
        this.eventEmitter.addListener("stateChanged", safeListener);
      } catch (error) {
        console.error("Error adding event listener:", error);
      }
    } else {
      console.error("Invalid listener provided to addEventListener");
    }
  }

  public removeEventListener(listener: (state: PlayerState) => void) {
    try {
      this.eventEmitter.removeListener("stateChanged", listener);
    } catch (error) {
      console.error("Error removing event listener:", error);
    }
  }
}

export default new PlayerStateStore();
