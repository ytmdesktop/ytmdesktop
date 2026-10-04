import { LikeStatus, PlayerQueue, PlayerQueueItem, PlayerState, RepeatMode, VideoDetails, VideoState, VideoType } from "~shared/playerstatestore/types";
import Service, { EventEmitterService } from "../service";
import log from "electron-log";
import { DependencyConstructor } from "~shared/types";
import ProtectedAPIManager, { ProtectedAPI } from "../protectedapimanager";
import AppWindowManager from "../windowmanager";
import StateManager from "../statemanager";

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
  shuffleEnabled: boolean;
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

export type PlayerStateStoreEventMap = {
  "state-changed": [PlayerState];
  "playlist-created": [{ title: string; id: string }];
  "playlist-deleted": [string];
};

export default class PlayerStateStore extends EventEmitterService<PlayerStateStoreEventMap> {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [AppWindowManager, ProtectedAPIManager, StateManager];

  private videoProgress = 0;
  private state: VideoState = -1;
  private videoDetails: VideoDetails | null = null;
  private playlistId: string | null = null;
  private queue: PlayerQueue | null = null;
  private volume: number = 0;
  private muted: boolean = false;
  private adPlaying: boolean = false;
  private hasFullMetadata: boolean = false;

  private stateApi: ProtectedAPI;

  public override onPreInitialized(): void {}
  public override onInitialized(): void {
    this.stateApi = this.getDependency(ProtectedAPIManager).createOrGetAPI("PlayerState");
    this.stateApi.on("updateVideoProgress", this.updateVideoProgress.bind(this));
    this.stateApi.on("updateVideoState", this.updateVideoState.bind(this));
    this.stateApi.on("updateVideoDetails", this.updateVideoDetails.bind(this));
    this.stateApi.on("updateFromStore", this.updateFromStore.bind(this));

    this.stateApi.on("playlistCreated", playlist => this.emit("playlist-created", playlist));
    this.stateApi.on("playlistDeleted", playlistId => this.emit("playlist-deleted", playlistId));

    log.info("PlayerStateStore initialized");
  }
  public override onPostInitialized(): void {}
  public override onTerminated(): void {}

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
    this.videoProgress = progress;
    this.stateChanged();
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

    this.stateChanged();
  }

  public updateVideoDetails(
    videoDetails: YTMVideoDetails,
    playlistId: string,
    album: { id: string; text: string } | null,
    likeStatus: YTMLikeStatus,
    hasFullMetadata: boolean
  ) {
    this.videoDetails = {
      author: videoDetails.author,
      channelId: videoDetails.channelId,
      title: videoDetails.title,
      album: album?.text ?? null,
      albumId: album?.id ?? null,
      likeStatus: transformLikeStatus(likeStatus),
      thumbnails: videoDetails.thumbnail ? videoDetails.thumbnail.thumbnails.map(mapYTMThumbnails) : [], // There are cases where the thumbnails simply don't exist on the videoDetails but can be found via other means. Podcasts notably can do this
      durationSeconds: parseInt(videoDetails.lengthSeconds),
      id: videoDetails.videoId,
      videoType: transformVideoType(videoDetails.musicVideoType),
      isLive: !!videoDetails.isLive
    };
    this.playlistId = playlistId;
    this.hasFullMetadata = hasFullMetadata;

    this.stateChanged();
  }

  public updateFromStore(
    queueState: YTMPlayerQueue | null,
    likeStatus: YTMLikeStatus | null,
    volume: number | null,
    muted: boolean | null,
    adPlaying: boolean | null
  ) {
    const queueItems = queueState ? queueState.items?.map(mapYTMQueueItems) : [];
    const automixItems = queueState ? queueState.automixItems?.map(mapYTMQueueItems) : [];
    this.queue = queueState
      ? {
          // automixItems comes from an autoplay queue that isn't pushed yet to the main queue. A radio will never have automixItems (weird YTM distinction from autoplay vs radio)
          automixItems: automixItems,
          autoplay: queueState.autoplay,
          isGenerating: queueState.isGenerating,
          // Observed state seems to be a radio having infinite true while an autoplay queue has infinite false
          isInfinite: queueState.isInfinite,
          items: queueItems,
          repeatMode: transformRepeatMode(queueState.repeatMode),
          // YTM has a native selectedItemIndex property but that isn't updated correctly so we calculate it ourselves
          selectedItemIndex: queueItems.findIndex(item => {
            return item.selected;
          }),
          shuffleEnabled: queueState.shuffleEnabled
        }
      : null;
    if (this.videoDetails) {
      this.videoDetails.likeStatus = transformLikeStatus(likeStatus);
    }
    this.adPlaying = adPlaying === true;
    this.muted = muted === true;
    if (typeof volume === "number" && volume >= 0) this.volume = volume;

    this.stateChanged();
  }

  private stateChanged() {
    const state = this.getState();

    const windowManager = this.getDependency(AppWindowManager);
    if (windowManager.hasWindow("Miniplayer")) {
      windowManager.getWindow("Miniplayer").ipcBroadcast("playerStateStore:stateChanged", state);
    }

    if (state.hasFullMetadata) {
      if (windowManager.hasWindow("Main"))
        windowManager.getWindow("Main").setTitle(`${state.videoDetails.title} - ${state.videoDetails.author} | YTMDesktop`);
      if (windowManager.hasWindow("Miniplayer"))
        windowManager.getWindow("Miniplayer").setTitle(`${state.videoDetails.title} - ${state.videoDetails.author} | YTMDesktop - Miniplayer`);
    } else {
      if (windowManager.hasWindow("Main")) windowManager.getWindow("Main").setTitle(`YTMDesktop`);
      if (windowManager.hasWindow("Miniplayer")) windowManager.getWindow("Miniplayer").setTitle("YTMDesktop - Miniplayer");
    }

    const stateManager = this.getDependency(StateManager);
    stateManager.updateState({
      lastVideoId: state.videoDetails?.id ?? "",
      lastPlaylistId: state.playlistId ?? ""
    });

    this.emit("state-changed", this.getState());
  }
}
