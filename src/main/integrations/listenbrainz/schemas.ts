export type ListenBrainzTrackMetadata = {
  artist_name: string;
  track_name: string;
  release_name?: string;
  additional_info?: {
    media_player?: string;
    media_player_version?: string;
    submission_client?: string;
    submission_client_version?: string;
    music_service?: string;
    origin_url?: string;
    duration?: number;
  };
};

export type ListenBrainzListen = {
  listened_at?: number;
  track_metadata: ListenBrainzTrackMetadata;
};

export type ListenBrainzSubmissionType = "single" | "playing_now";

export type ListenBrainzSubmission = {
  listen_type: ListenBrainzSubmissionType;
  payload: ListenBrainzListen[];
};

export type ListenBrainzResponse = {
  status: number;
  message?: string;
};
