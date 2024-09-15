export type Thumbnail = {
  height: number;
  url: string;
  width: number;
};

export enum VideoState {
  Unknown = -1,
  Paused = 0,
  Playing = 1,
  Buffering = 2
}

export enum LikeStatus {
  Unknown = -1,
  Dislike = 0,
  Indifferent = 1,
  Like = 2
}

export enum RepeatMode {
  Unknown = -1,
  None = 0,
  All = 1,
  One = 2
}

export enum VideoType {
  Unknown = -1,
  MusicAudio = 0,
  MusicVideo = 1,
  MusicUploaded = 2,
  PodcastEpisode = 3
}

export type CommandData = {
  command: string;
  data?: number | string;
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

export type PlayerQueue = {
  automixItems: PlayerQueueItem[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  items: PlayerQueueItem[];
  repeatMode: RepeatMode;
  selectedItemIndex: number;
};

type PlayerState = {
  trackState: VideoState;
  videoProgress: number;
  volume: number;
  muted: boolean;
  adPlaying: boolean;
  queue: PlayerQueue;
};

export type ApplicationState = {
  player: PlayerState;
  video: VideoDetails;
  playlistId: string;
};

export type ErrorData = {
  code?: string;
  message?: string;
  error?: string;
};
