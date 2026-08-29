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
  counterparts: PlayerQueueItem[] | null;
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
  videoDetails: VideoDetails | null;
  playlistId: string | null;
  trackState: VideoState;
  queue: PlayerQueue | null;
  videoProgress: number;
  volume: number;
  muted: boolean;
  adPlaying: boolean;
  hasFullMetadata: boolean;
};

export type MiniPlayerCommand =
  | "previous"
  | "playPause"
  | "next"
  | "seekTo"
  | "toggleLike"
  | "toggleDislike"
  | "repeatMode"
  | "shuffle"
  | "setVolume"
  | "mute"
  | "startMix";

export type MiniPlayerStatus = "idle" | "loading" | "paused" | "playing" | "needs-main-app";

export type MiniPlayerLikeStatus = "like" | "dislike" | "indifferent";
export type MiniPlayerRepeatMode = "none" | "all" | "one";

export type MiniPlayerTrack = {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  artworkUrl: string | null;
  likeStatus: MiniPlayerLikeStatus;
};

export type MiniPlayerSnapshot = {
  version: 1;
  authenticated: boolean;
  status: MiniPlayerStatus;
  track: MiniPlayerTrack | null;
  progressSeconds: number;
  canPlay: boolean;
  canPrevious: boolean;
  canNext: boolean;
  likeStatus: MiniPlayerLikeStatus;
  repeatMode: MiniPlayerRepeatMode;
  volume: number;
  muted: boolean;
  message: string | null;
};

export type MiniPlayerSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: string | null;
  artworkUrl: string | null;
  playlistId: string | null;
};

export type MiniPlayerSearchStatus = "idle" | "loading" | "ready" | "error";

export type MiniPlayerSearchSnapshot = {
  version: 1;
  query: string;
  status: MiniPlayerSearchStatus;
  results: MiniPlayerSearchResult[];
  message: string | null;
};

export type MiniPlayerPlayResultAction = "now" | "next";
