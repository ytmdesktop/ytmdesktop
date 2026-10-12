export type ListenBrainzTrackMetadata = {
  artist_name: string;
  track_name: string;
  release_name?: string;
};

export type ListenBrainzPayloadItem = {
  listened_at?: number;
  track_metadata: ListenBrainzTrackMetadata;
};

export type ListenBrainzSubmitBody = {
  listen_type: "playing_now" | "single";
  payload: ListenBrainzPayloadItem[];
};

export type ListenBrainzValidateTokenResponse = {
  code: number;
  message: string;
  valid: boolean;
  user_name?: string;
};
