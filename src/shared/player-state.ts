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

export type AdDetails = {
  title: string | null;
  advertiser: string | null;
  badge: string | null;
  durationSeconds: number;
  progressSeconds: number;
  isPlaying: boolean;
  canSkip: boolean;
  skipHint: string | null;
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
  adDetails: AdDetails | null;
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
  | "startMix"
  | "skipAd";

export type MiniPlayerStatus = "idle" | "loading" | "paused" | "playing" | "needs-main-app";

export type MiniPlayerLikeStatus = "like" | "dislike" | "indifferent";
export type MiniPlayerRepeatMode = "none" | "all" | "one";

export type MiniPlayerAd = {
  title: string;
  advertiser: string | null;
  artworkUrl: string | null;
  durationSeconds: number;
  skipHint: string | null;
};

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
  canLike: boolean;
  canSkipAd: boolean;
  likeStatus: MiniPlayerLikeStatus;
  repeatMode: MiniPlayerRepeatMode;
  volume: number;
  muted: boolean;
  adPlaying: boolean;
  ad: MiniPlayerAd | null;
  message: string | null;
};

export type MiniPlayerSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: string | null;
  artworkUrl: string | null;
  playlistId: string | null;
  kind: "music" | "video" | "artist" | "album" | "unknown";
  albumId?: string;
  canPlayNext?: boolean;
  canStartMix?: boolean;
  playCount?: number | null;
  // UC… browseId for artist results; their `id` is a radio videoId when YTM offers one, else a
  // display-only "artist:<browseId>" key that must never be sent to PlayResult.
  artistId: string | null;
};

export type MiniPlayerSearchMode = "music" | "video";

export type MiniPlayerSearchStatus = "idle" | "loading" | "ready" | "error";

export type MiniPlayerArtistSection = "" | "songs" | "videos";

export type MiniPlayerArtistBrowseRequest = {
  artistId: string;
  section: MiniPlayerArtistSection;
  // null for the artist page itself; "browse:<id>[:<params>]" for the first page of a section's
  // full list; "token:<continuation>" for the pages after it.
  continuation: string | null;
};

// One page of an artist. The artist page fills everything; a section page fills only that
// section's list and its next-page pointer.
export type MiniPlayerArtistBrowsePage = {
  section: MiniPlayerArtistSection;
  name: string | null;
  artworkUrl: string | null;
  songs: MiniPlayerSearchResult[];
  videos: MiniPlayerSearchResult[];
  songsNext: string | null;
  videosNext: string | null;
};

export type MiniPlayerArtistBrowseSnapshot = MiniPlayerArtistBrowsePage & {
  version: 1;
  artistId: string;
  status: "loading" | "ready" | "error";
  message: string | null;
};

export type MiniPlayerSearchSnapshot = {
  version: 1;
  mode: MiniPlayerSearchMode;
  query: string;
  status: MiniPlayerSearchStatus;
  results: MiniPlayerSearchResult[];
  message: string | null;
};

export type MiniPlayerAlbumPage = {
  albumId: string;
  name: string | null;
  artworkUrl: string | null;
  items: MiniPlayerSearchResult[];
  continuation: string | null;
};
export type MiniPlayerQueueResult = { videoId: string; title: string };

export type MiniPlayerMusicCategory = "all" | "songs" | "artists" | "albums";
export type MiniPlayerMusicRequest = {query: string; category: MiniPlayerMusicCategory; continuation: string | null};
export type MiniPlayerMusicPage = {results: MiniPlayerSearchResult[]; sectionOrder: string[]; artistsNext: string | null};
