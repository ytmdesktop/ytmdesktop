import type {
  InviteEnvelope,
  PlaybackAnchor,
  QueueTrack,
  QueueTrackMeta,
  Role,
  RoomMember,
  RoomSettings,
} from "./protocol";

export const LISTEN_TOGETHER_IPC = {
  getState: "listenTogether:getState",
  stateChanged: "listenTogether:stateChanged",
  action: "listenTogether:action",
  togglePanel: "listenTogether:togglePanel",
  closePanel: "listenTogether:closePanel",
} as const;

export type ListenTogetherView =
  | "lobby"
  | "invite-confirm"
  | "connecting"
  | "active"
  | "ended";

export type ListenTogetherSyncStatus =
  | "synced"
  | "starting"
  | "syncing"
  | "paused-for-ad"
  | "reconnecting"
  | "host-disconnected";

export type ListenTogetherLanRoomUI = {
  lookupId: string;
  label: string;
  port: number;
  ip: string;
};

export type ListenTogetherPendingInviteUI = {
  rawUrl: string;
  envelope: InviteEnvelope;
  relayHost: string | null;
  relayTrusted: boolean;
};

export type FriendStatus = "unknown" | "checking" | "online" | "offline";

export type FriendEntry = {
  pubKeyB64: string;
  displayName: string;
  tcAddress: string | null;
  tcPort: number | null;
  addedAtMs: number;
  status?: FriendStatus;
  roomName?: string | null;
  memberCount?: number;
  trackTitle?: string | null;
  positionSec?: number;
  durationSec?: number;
};

export type FriendRequestUI = {
  id: string;
  fromPubKeyB64: string;
  fromDisplayName: string;
  fromTcAddress: string | null;
  fromTcPort: number | null;
  receivedAtMs: number;
};

export type FavoriteRoomEntry = {
  id: string;
  label: string;
  ownerName?: string | null;
  hostPubKeyB64: string;
  hostClientSlug?: string | null;
  inviteUrl?: string | null;
  passcode?: string | null;
  shortCode?: string | null;
  signalingUrl?: string | null;
  autoJoin: boolean;
  lastJoinedAtMs: number;
};

export type ListenTogetherActiveRoomUIState = {
  roomId: string;
  roomName: string;
  passcode: string | null;
  shortCode: string | null;
  shortInviteUrl: string | null;
  inviteUrl: string | null;
  isFavorite: boolean;
  persistentRoomEnabled: boolean;
  lanDiscoveryEnabled: boolean;
  role: Role;
  isHost: boolean;
  selfPeerId: string;
  connectionKind: "direct" | "tailcat" | "relay";
  settings: RoomSettings;
  members: RoomMember[];
  currentTrack: QueueTrack | null;
  anchor: PlaybackAnchor | null;
  queue: QueueTrack[];
  history: QueueTrack[];
  autoplayNext: QueueTrack | null;
  skipVotes: string[];
  skipVotesRequired: number;
  syncStatus: ListenTogetherSyncStatus;
  degradedSync: boolean;
  audioBlocked: boolean;
  minorityUnavailable: boolean;
  hostGraceRemainingMs: number | null;
  clickedCandidate: QueueTrackMeta | null;
  noticeBanner: string | null;
  rateLimitRemainingSec: number;
  rateLimitReason: string | null;
  isLocalNetworkOnly: boolean;
  listeningMode: "room" | "local";
  pendingFriendRequests: FriendRequestUI[];
  sentFriendRequestPeerIds: string[];
  friendPubKeys: string[];
  remotePositionSec: number;
  remotePositionCapturedAtMs: number;
  remotePositionAdvancing: boolean;
  localTrack: QueueTrackMeta | null;
  localPlaylist: {
    playlistId: string;
    title: string;
    trackCount?: number;
  } | null;
};

export type ListenTogetherEndedUIState = {
  reason: "host-left" | "kicked" | "timeout";
  hostName: string | null;
  queueSnapshot: QueueTrack[];
};

export type ListenTogetherUIState = {
  view: ListenTogetherView;
  panelOpen: boolean;
  clientSlug: string;
  displayName: string;
  persistentRoomEnabled: boolean;
  persistentRoomName: string;
  favoriteRooms: FavoriteRoomEntry[];
  recentRooms: FavoriteRoomEntry[];
  friends: FriendEntry[];
  pendingFriendRequests: FriendRequestUI[];
  signalingUrl: string | null;
  trustedSignalingHosts: string[];
  lanDiscoveryEnabled: boolean;
  tailcatAvailable: boolean;
  tailcatDerpMapUrl: string | null;
  logFilePath: string | null;
  lanRooms: ListenTogetherLanRoomUI[];
  pendingInvite: ListenTogetherPendingInviteUI | null;
  connectingStage: string | null;
  errorBanner: string | null;
  errorDetail: string | null;
  room: ListenTogetherActiveRoomUIState | null;
  ended: ListenTogetherEndedUIState | null;
};

export type ListenTogetherCommand =
  | { type: "setDisplayName"; displayName: string }
  | { type: "setPersistentRoom"; enabled: boolean; roomName?: string }
  | { type: "saveFavoriteRoom"; label?: string; autoJoin?: boolean }
  | { type: "removeFavoriteRoom"; id: string }
  | { type: "toggleFavoriteAutoJoin"; id: string; autoJoin: boolean }
  | { type: "joinFavoriteRoom"; id: string }
  | { type: "openAddToPlaylist"; videoId: string }
  | { type: "dismissAutoplayNext" }
  | { type: "setSignalingUrl"; signalingUrl: string | null }
  | { type: "setLanDiscovery"; enabled: boolean }
  | { type: "setTailcatDerpMapUrl"; url: string | null }
  | { type: "createRoom"; displayName?: string; initialQueue?: QueueTrack[] }
  | {
      type: "joinByUrl";
      rawUrl: string;
      displayName?: string;
      trustRelayHost?: boolean;
    }
  | {
      type: "joinByPasscode";
      code: string;
      displayName?: string;
      lanEndpoint?: string;
    }
  | {
      type: "confirmPendingInvite";
      displayName?: string;
      trustRelayHost?: boolean;
    }
  | { type: "cancelPendingInvite" }
  | { type: "cancelConnecting" }
  | { type: "retryConnect" }
  | { type: "dismissError" }
  | { type: "leaveRoom"; endForAll?: boolean }
  | { type: "addSongByUrlOrId"; input: string }
  | { type: "acceptClickedCandidate" }
  | { type: "dismissClickedCandidate" }
  | { type: "removeTrack"; entryId: string }
  | { type: "pinTrackNext"; entryId: string }
  | { type: "unpinTrack"; entryId: string }
  | { type: "reorderQueue"; entryId: string; targetIndex: number }
  | { type: "jumpToTrack"; target: "queue" | "history"; entryId: string }
  | { type: "voteSkip" }
  | { type: "tuneBackIn" }
  | { type: "tuneOut" }
  | { type: "addLocalTrackToQueue" }
  | { type: "addLocalPlaylistToQueue" }
  | {
      type: "hostTransport";
      action: "play" | "pause" | "skip" | "seek";
      seekPosSec?: number;
    }
  | { type: "forceResumeFromAd" }
  | {
      type: "moderateMember";
      targetPeerId: string;
      action:
        | "make-dj"
        | "make-listener"
        | "demote-clear"
        | "kick"
        | "promote-host";
    }
  | { type: "updateRoomSettings"; settings: Partial<RoomSettings> }
  | { type: "resetInviteLinkAndCode" }
  | { type: "enableAudio" }
  | { type: "reconnectNow" }
  | { type: "dismissNotice" }
  | { type: "hostNewRoomWithQueue" }
  | { type: "returnToLobby" }
  | { type: "openLogFile" }
  | { type: "sendFriendRequest"; targetPeerId: string }
  | { type: "respondFriendRequest"; requestId: string; accept: boolean }
  | { type: "removeFriend"; pubKeyB64: string }
  | { type: "joinFriend"; pubKeyB64: string }
  | { type: "refreshFriends" };

export type ListenTogetherActionResult =
  | { ok: true }
  | { ok: false; error: string };
