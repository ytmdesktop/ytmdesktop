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
  muted: boolean;
  adPlaying: boolean;
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
  private muted: boolean = false;
  private adPlaying: boolean = false;
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
      volume: this.volume,
      muted: this.muted,
      adPlaying: this.adPlaying
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
  private previousTitle: string | null = null;
  private headers: {} = {
    headers: {
      "User-Agent": " YouTube Music Desktop ( user@ytmdesktop.app)" // replace with actual user-agent
    }
  }

  public async updateVideoDetails(videoDetails: YTMVideoDetails, playlistId: string, album: Partial<VideoDetails> | null, likeStatus: YTMLikeStatus) {
    const musicBrainzDetails = this?.previousTitle != videoDetails.title ? await this.requestFromMusicBrainz(videoDetails, album) : {};
    this.videoDetails = {
      author: musicBrainzDetails?.author ?? videoDetails.author,
      channelId: videoDetails.channelId,
      title: musicBrainzDetails?.title ?? videoDetails.title,
      album: musicBrainzDetails?.album ?? album?.album ?? null,
      albumId: album?.id ?? null,
      likeStatus: transformLikeStatus(likeStatus),
      thumbnails: musicBrainzDetails?.thumbnails ? musicBrainzDetails.thumbnails : videoDetails.thumbnail ? videoDetails.thumbnail.thumbnails.map(mapYTMThumbnails) : [], // Use thumbnails from MusicBrainz if available
      durationSeconds: parseInt(videoDetails.lengthSeconds),
      id: videoDetails.videoId,
    };

    this.previousTitle = videoDetails.title;

    this.playlistId = playlistId;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  private async requestFromMusicBrainz(videoDetails: YTMVideoDetails, album: Partial<VideoDetails> | null): Promise<Partial<VideoDetails>> {
    const query = [
      videoDetails.title ?? "",
      videoDetails.author ?? ""
    ].filter(part => part !== "").join(" ");

    return fetch(`https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(query)}&fmt=json`, this.headers).then((response) => {
      if (!response.ok) {
        return Promise.reject(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    }).then((async (data) => {
      const releases = data.releases || [];
      if (!releases && releases.length <= 0) {
        return null;
      }

      const bestMatch = releases[0]; // Replace with a better method that checks for the similarity between the title and the album author or something
      const coverArtThumbnail: YTMThumbnail = await this.requestFromCoverArtArchive(bestMatch['release-group'].id); // !!returns the OG cover art usually so there will be a difference from the ones provided by youtube
      const thumbnails: YTMThumbnail[] = [coverArtThumbnail] ?? null;

      return {
        author: bestMatch['artist-credit'][0].name,
        title: bestMatch.title,
        album: bestMatch['release-group']?.title ?? null,
        thumbnails: thumbnails
      } as Partial<VideoDetails>;
    })).catch((error) => {
      console.error(error);
      return null;
    });
  }

  private async requestFromCoverArtArchive(releaseId: string): Promise<YTMThumbnail | null> {
    if (!releaseId) return null;

    return fetch(`https://coverartarchive.org/release-group/${releaseId}`, this.headers).then((response) => {
      if (!response.ok) {
        return Promise.reject(`HTTP error! Status: ${response.status}`);
      }

      if (response.redirected) {
        const finalUrl = response.url;
        return fetch(finalUrl, this.headers);
      } else {
        return Promise.reject(`Unexpected response status: ${response.status}`);
      }
    })
    .then((response) => {
      if (!response.ok) {
        return Promise.reject(`Failed to fetch cover art from redirected URL! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const images = data.images || [];
      if (images.length === 0) return null;
      
      const frontCoverImage = images.find((image: any) => image.front);

      return frontCoverImage ? {
        url: frontCoverImage.thumbnails?.large || frontCoverImage.image, // .image might be 1200x1200
        height: 500,
        width: 500
      } as YTMThumbnail : null;
    })
    .catch((error) => {
      console.error('Error fetching:', error);
      return null;
    });
  }

  public updateFromStore(
    queueState: YTMPlayerQueue | null,
    likeStatus: YTMLikeStatus | null,
    volume: number | null,
    muted: boolean | null,
    adPlaying: boolean | null
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
      this.videoDetails.likeStatus = transformLikeStatus(likeStatus);
    }
    this.adPlaying = adPlaying === true;
    this.muted = muted === true;
    if (typeof volume === "number" && volume >= 0) this.volume = volume;

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
