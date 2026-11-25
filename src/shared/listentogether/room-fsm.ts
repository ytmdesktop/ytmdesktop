import { noopLogger, type ListenTogetherLogger } from "./logger";
import {
  computeSkipVotesRequired,
  DEFAULT_ROOM_SETTINGS,
  type ActionRejectedReason,
  type DesiredPlaybackState,
  type PlaybackAnchor,
  type QueueTrack,
  type Role,
  type RoomMember,
  type RoomSettings,
} from "./protocol";
import {
  createSchedulerState,
  dequeueNextTrack,
  dismissAutoplayNext,
  enqueueDjTrack,
  jumpToQueuedTrack,
  materializeQueue,
  peekAutoplayNext,
  pinTrackNext,
  purgePeerTracks,
  recordHistoryVideoId,
  removeTrack,
  reorderTrack,
  setAutoplayCandidates,
  setSchedulerMode,
  shouldPreemptForDjAdd,
  unpinTrack,
  type SchedulerState,
} from "./scheduler";

export const LOADING_BARRIER_TIMEOUT_MS = 4_000;
export const PLAYBACK_START_LEAD_MS = 150;
export const AD_STUCK_TIMEOUT_MS = 90_000;
export const MAX_AD_TIMEOUTS_BEFORE_DEMOTE = 3;
export const MAX_ROOM_HISTORY = 30;

export type RoomState = {
  roomId: string;
  hostPeerId: string;
  epoch: number;
  seq: number;
  settings: RoomSettings;
  members: Record<string, RoomMember>;
  scheduler: SchedulerState;
  currentTrack: QueueTrack | null;
  history: QueueTrack[];
  desiredPlaybackState: DesiredPlaybackState;
  pausedForAd: boolean;
  anchorPosSec: number;
  anchorHostTimeMs: number;
  loadingBarrierStartedAtMs: number | null;
  loadingReadyPeers: string[];
  waitingOnAds: Record<string, number>;
  adWaitGrantedForSeq: Record<string, boolean>;
  adTimeoutCounts: Record<string, number>;
  sessionStayLivePeers: string[];
  endedVotes: string[];
  unavailableVotes: string[];
  skipVotes: string[];
  preemptionInFlight: boolean;
};

export type CreateRoomStateOptions = {
  roomId: string;
  hostPeerId: string;
  hostDisplayName: string;
  settings?: Partial<RoomSettings>;
  epoch?: number;
  initialQueue?: readonly QueueTrack[];
  nowMs?: number;
  logger?: ListenTogetherLogger;
};

export type RoomEvent =
  | {
      type: "PEER_JOINED";
      peerId: string;
      clientSlug?: string;
      displayName: string;
      transport: RoomMember["transport"];
      role?: Role;
    }
  | { type: "PEER_LEFT"; peerId: string }
  | { type: "QUEUE_ADD"; actorId: string; track: QueueTrack }
  | { type: "QUEUE_REMOVE"; actorId: string; entryId: string }
  | { type: "QUEUE_PIN_NEXT"; actorId: string; entryId: string }
  | { type: "QUEUE_UNPIN"; actorId: string; entryId: string }
  | {
      type: "QUEUE_REORDER";
      actorId: string;
      entryId: string;
      targetIndex: number;
    }
  | {
      type: "HOST_JUMP_TRACK";
      actorId: string;
      target: "queue" | "history";
      entryId: string;
    }
  | { type: "VOTE_SKIP"; peerId: string; seq: number }
  | { type: "AUTOPLAY_CANDIDATES"; actorId: string; candidates: QueueTrack[] }
  | { type: "AUTOPLAY_DISMISS"; actorId: string }
  | {
      type: "MEMBER_LISTENING_MODE";
      peerId: string;
      listeningMode: "room" | "local";
    }
  | { type: "TRACK_READY"; peerId: string; seq: number }
  | { type: "TRACK_ENDED"; peerId: string; seq: number }
  | {
      type: "TRACK_UNAVAILABLE";
      peerId: string;
      seq: number;
      errorCode: number | string;
    }
  | { type: "AD_STARTED"; peerId: string; seq: number }
  | { type: "AD_ENDED"; peerId: string; seq: number }
  | { type: "HOST_FORCE_RESUME_FROM_AD"; actorId: string; seq: number }
  | {
      type: "HOST_TRANSPORT";
      actorId: string;
      action: "play" | "pause" | "skip" | "seek";
      seekPosSec?: number;
    }
  | {
      type: "HOST_MODERATION";
      actorId: string;
      targetPeerId: string;
      action: "make-dj" | "make-listener" | "demote-clear" | "kick";
    }
  | {
      type: "HOST_UPDATE_SETTINGS";
      actorId: string;
      settings: Partial<RoomSettings>;
    }
  | { type: "TICK" };

export type RoomEffect =
  | { type: "BROADCAST_SYNC_ANCHOR"; epoch: number; anchor: PlaybackAnchor }
  | {
      type: "BROADCAST_QUEUE_UPDATED";
      epoch: number;
      currentTrack: QueueTrack | null;
      queue: QueueTrack[];
      autoplayNext: QueueTrack | null;
      history: QueueTrack[];
      skipVotes: string[];
    }
  | { type: "BROADCAST_MEMBERS_UPDATED"; epoch: number; members: RoomMember[] }
  | {
      type: "BROADCAST_SETTINGS_UPDATED";
      epoch: number;
      settings: RoomSettings;
    }
  | {
      type: "SEND_ROOM_SNAPSHOT";
      peerId: string;
      epoch: number;
      roomId: string;
      settings: RoomSettings;
      members: RoomMember[];
      currentTrack: QueueTrack | null;
      anchor: PlaybackAnchor;
      queue: QueueTrack[];
      autoplayNext: QueueTrack | null;
      history: QueueTrack[];
      skipVotes: string[];
    }
  | {
      type: "SEND_ACTION_REJECTED";
      peerId: string;
      reason: ActionRejectedReason;
      retryAfterMs?: number;
    }
  | { type: "DISCONNECT_PEER"; peerId: string; reason: "kicked" }
  | {
      type: "SCHEDULE_TIMER";
      timer: "LOADING_BARRIER" | "AD_STUCK";
      seq: number;
      delayMs: number;
      peerId?: string;
    }
  | {
      type: "CANCEL_TIMER";
      timer: "LOADING_BARRIER" | "AD_STUCK";
      peerId?: string;
    };

export function createRoomState(options: CreateRoomStateOptions): RoomState {
  const settings: RoomSettings = {
    ...DEFAULT_ROOM_SETTINGS,
    ...options.settings,
  };
  const nowMs = options.nowMs ?? 0;
  const logger = options.logger ?? noopLogger;

  let scheduler = createSchedulerState(settings.queueMode);
  if (options.initialQueue) {
    for (const track of options.initialQueue) {
      const res = enqueueDjTrack(
        scheduler,
        options.hostPeerId,
        track,
        "admin",
        settings.rateLimitPreset,
        nowMs,
        logger,
      );
      if (res.ok) {
        scheduler = res.state;
      }
    }
  }

  return {
    roomId: options.roomId,
    hostPeerId: options.hostPeerId,
    epoch: options.epoch ?? 1,
    seq: 0,
    settings,
    members: {
      [options.hostPeerId]: {
        peerId: options.hostPeerId,
        displayName: options.hostDisplayName,
        role: "admin",
        status: "synced",
        transport: "direct",
      },
    },
    scheduler,
    currentTrack: null,
    history: [],
    desiredPlaybackState: "IDLE",
    pausedForAd: false,
    anchorPosSec: 0,
    anchorHostTimeMs: nowMs,
    loadingBarrierStartedAtMs: null,
    loadingReadyPeers: [],
    waitingOnAds: {},
    adWaitGrantedForSeq: {},
    adTimeoutCounts: {},
    sessionStayLivePeers: [],
    endedVotes: [],
    unavailableVotes: [],
    skipVotes: [],
    preemptionInFlight: false,
  };
}

export function buildPlaybackAnchor(state: RoomState): PlaybackAnchor {
  const waitingOnAds = Object.keys(state.waitingOnAds).map((peerId) => ({
    peerId,
    displayName: state.members[peerId]?.displayName ?? peerId,
  }));
  return {
    seq: state.seq,
    videoId: state.currentTrack?.videoId ?? "",
    durationSec: state.currentTrack?.durationSec ?? 0,
    desiredState: state.desiredPlaybackState,
    pausedForAd: state.pausedForAd,
    waitingOnAds,
    anchorPosSec: state.anchorPosSec,
    anchorHostTimeMs: state.anchorHostTimeMs,
  };
}

export function projectLivePosSec(state: RoomState, nowMs: number): number {
  if (
    state.desiredPlaybackState === "PLAYING" &&
    !state.pausedForAd &&
    state.currentTrack !== null
  ) {
    if (nowMs < state.anchorHostTimeMs) {
      return state.anchorPosSec;
    }
    const elapsedSec = (nowMs - state.anchorHostTimeMs) / 1000;
    return Math.min(
      state.currentTrack.durationSec,
      Math.max(0, state.anchorPosSec + elapsedSec),
    );
  }
  return state.anchorPosSec;
}

function isAdmin(state: RoomState, actorId: string): boolean {
  return (
    actorId === state.hostPeerId || state.members[actorId]?.role === "admin"
  );
}

function membersArray(members: Record<string, RoomMember>): RoomMember[] {
  return Object.values(members);
}

function emitQueueUpdated(state: RoomState, effects: RoomEffect[]): void {
  effects.push({
    type: "BROADCAST_QUEUE_UPDATED",
    epoch: state.epoch,
    currentTrack: state.currentTrack,
    queue: materializeQueue(state.scheduler),
    autoplayNext: peekAutoplayNext(state.scheduler),
    history: state.history,
    skipVotes: state.skipVotes,
  });
}

function emitSyncAnchor(state: RoomState, effects: RoomEffect[]): void {
  effects.push({
    type: "BROADCAST_SYNC_ANCHOR",
    epoch: state.epoch,
    anchor: buildPlaybackAnchor(state),
  });
}

function emitMembersUpdated(state: RoomState, effects: RoomEffect[]): void {
  effects.push({
    type: "BROADCAST_MEMBERS_UPDATED",
    epoch: state.epoch,
    members: membersArray(state.members),
  });
}

function clearAdWaits(
  state: RoomState,
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
  trigger: string,
): RoomState {
  const waitingPeerIds = Object.keys(state.waitingOnAds);
  if (waitingPeerIds.length === 0 && !state.pausedForAd) {
    return state;
  }
  for (const peerId of waitingPeerIds) {
    effects.push({ type: "CANCEL_TIMER", timer: "AD_STUCK", peerId });
  }
  logger.info?.("Resumed from PAUSED_FOR_AD", {
    seq: state.seq,
    trigger,
    clearedPeerIds: waitingPeerIds,
    wasPausedForAd: state.pausedForAd,
    anchorPosSec: state.anchorPosSec,
  });
  return {
    ...state,
    waitingOnAds: {},
    pausedForAd: false,
    anchorHostTimeMs:
      state.desiredPlaybackState === "PLAYING"
        ? nowMs + PLAYBACK_START_LEAD_MS
        : nowMs,
  };
}

function resumeFromAdIfEmpty(
  state: RoomState,
  nextWaiting: Record<string, number>,
  nowMs: number,
  logger: ListenTogetherLogger,
  trigger: string,
  clearedPeerId: string,
): { state: RoomState; anchorChanged: boolean } {
  if (Object.keys(nextWaiting).length === 0 && state.pausedForAd) {
    logger.info?.("Resumed from PAUSED_FOR_AD", {
      seq: state.seq,
      trigger,
      clearedPeerId,
      anchorPosSec: state.anchorPosSec,
    });
    return {
      state: {
        ...state,
        waitingOnAds: nextWaiting,
        pausedForAd: false,
        anchorHostTimeMs:
          state.desiredPlaybackState === "PLAYING"
            ? nowMs + PLAYBACK_START_LEAD_MS
            : nowMs,
      },
      anchorChanged: true,
    };
  }
  logger.debug?.("Removed peer from waitingOnAds; still waiting on others", {
    seq: state.seq,
    trigger,
    clearedPeerId,
    remainingWaitingPeerIds: Object.keys(nextWaiting),
  });
  return {
    state: {
      ...state,
      waitingOnAds: nextWaiting,
    },
    anchorChanged: true,
  };
}

function removePeerFromAdWaits(
  state: RoomState,
  peerId: string,
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
  trigger: string,
): { state: RoomState; anchorChanged: boolean } {
  if (!(peerId in state.waitingOnAds)) {
    return { state, anchorChanged: false };
  }
  const nextWaiting = { ...state.waitingOnAds };
  delete nextWaiting[peerId];
  effects.push({ type: "CANCEL_TIMER", timer: "AD_STUCK", peerId });

  return resumeFromAdIfEmpty(
    state,
    nextWaiting,
    nowMs,
    logger,
    trigger,
    peerId,
  );
}

function removePeerAndReconcile(
  state: RoomState,
  peerId: string,
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
  trigger: string,
): { state: RoomState; anchorChanged: boolean } {
  const nextState: RoomState = {
    ...state,
    loadingReadyPeers: state.loadingReadyPeers.filter((id) => id !== peerId),
    endedVotes: state.endedVotes.filter((id) => id !== peerId),
    unavailableVotes: state.unavailableVotes.filter((id) => id !== peerId),
    skipVotes: state.skipVotes.filter((id) => id !== peerId),
  };
  return removePeerFromAdWaits(
    nextState,
    peerId,
    nowMs,
    effects,
    logger,
    trigger,
  );
}

function isBarrierEligible(member: RoomMember): boolean {
  return (
    member.status !== "in-ad" &&
    member.status !== "catching-up" &&
    member.status !== "unavailable"
  );
}

function maybeCompleteLoadingBarrier(
  state: RoomState,
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
): RoomState {
  if (state.desiredPlaybackState !== "LOADING_BARRIER") {
    return state;
  }
  const readySet = new Set(state.loadingReadyPeers);
  const eligibleMembers = Object.values(state.members).filter(
    isBarrierEligible,
  );
  const allReady = eligibleMembers.every((member) =>
    readySet.has(member.peerId),
  );
  if (!allReady) {
    return state;
  }

  const durationMs =
    state.loadingBarrierStartedAtMs !== null
      ? Math.max(0, nowMs - state.loadingBarrierStartedAtMs)
      : 0;
  const nextState: RoomState = {
    ...state,
    desiredPlaybackState: "PLAYING",
    anchorHostTimeMs: nowMs + PLAYBACK_START_LEAD_MS,
    loadingBarrierStartedAtMs: null,
  };
  effects.push({ type: "CANCEL_TIMER", timer: "LOADING_BARRIER" });
  logger.info?.("LOADING_BARRIER completed", {
    seq: nextState.seq,
    videoId: nextState.currentTrack?.videoId ?? "",
    readyPeers: nextState.loadingReadyPeers.length,
    eligiblePeers: eligibleMembers.length,
    durationMs,
  });
  emitSyncAnchor(nextState, effects);
  return nextState;
}

function appendRoomHistory(
  history: readonly QueueTrack[],
  track: QueueTrack | null,
): QueueTrack[] {
  if (!track) {
    return [...history];
  }
  const filtered = history.filter((item) => item.entryId !== track.entryId);
  filtered.push(track);
  if (filtered.length > MAX_ROOM_HISTORY) {
    return filtered.slice(filtered.length - MAX_ROOM_HISTORY);
  }
  return filtered;
}

function transitionToTrack(
  state: RoomState,
  nextTrack: QueueTrack | null,
  nextScheduler: SchedulerState,
  nextHistory: QueueTrack[],
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
): RoomState {
  if (state.desiredPlaybackState === "LOADING_BARRIER") {
    effects.push({ type: "CANCEL_TIMER", timer: "LOADING_BARRIER" });
  }
  for (const peerId of Object.keys(state.waitingOnAds)) {
    effects.push({ type: "CANCEL_TIMER", timer: "AD_STUCK", peerId });
  }

  const nextSeq = state.seq + 1;

  const nextMembers: Record<string, RoomMember> = {};
  for (const [peerId, member] of Object.entries(state.members)) {
    if (member.status === "in-ad" || member.status === "catching-up") {
      nextMembers[peerId] = member;
    } else {
      nextMembers[peerId] = {
        ...member,
        status: nextTrack ? "buffering" : "synced",
      };
    }
  }

  if (!nextTrack) {
    const idleState: RoomState = {
      ...state,
      seq: nextSeq,
      scheduler: nextScheduler,
      history: nextHistory,
      members: nextMembers,
      currentTrack: null,
      desiredPlaybackState: "IDLE",
      pausedForAd: false,
      anchorPosSec: 0,
      anchorHostTimeMs: nowMs,
      loadingBarrierStartedAtMs: null,
      loadingReadyPeers: [],
      waitingOnAds: {},
      endedVotes: [],
      unavailableVotes: [],
      skipVotes: [],
      preemptionInFlight: false,
    };
    logger.info?.("Room queue exhausted; transitioned to IDLE", {
      seq: nextSeq,
    });
    emitQueueUpdated(idleState, effects);
    emitSyncAnchor(idleState, effects);
    emitMembersUpdated(idleState, effects);
    return idleState;
  }

  const barrierState: RoomState = {
    ...state,
    seq: nextSeq,
    scheduler: nextScheduler,
    history: nextHistory,
    members: nextMembers,
    currentTrack: nextTrack,
    desiredPlaybackState: "LOADING_BARRIER",
    pausedForAd: false,
    anchorPosSec: 0,
    anchorHostTimeMs: nowMs,
    loadingBarrierStartedAtMs: nowMs,
    loadingReadyPeers: [],
    waitingOnAds: {},
    endedVotes: [],
    unavailableVotes: [],
    skipVotes: [],
    preemptionInFlight: false,
  };

  logger.debug?.("Advancing room track into LOADING_BARRIER", {
    seq: nextSeq,
    videoId: nextTrack.videoId,
    source: nextTrack.source,
  });

  emitQueueUpdated(barrierState, effects);
  emitSyncAnchor(barrierState, effects);
  emitMembersUpdated(barrierState, effects);
  effects.push({
    type: "SCHEDULE_TIMER",
    timer: "LOADING_BARRIER",
    seq: nextSeq,
    delayMs: LOADING_BARRIER_TIMEOUT_MS,
  });

  return maybeCompleteLoadingBarrier(barrierState, nowMs, effects, logger);
}

function advanceToNextTrack(
  state: RoomState,
  nowMs: number,
  effects: RoomEffect[],
  logger: ListenTogetherLogger,
): RoomState {
  const { track: nextTrack, state: nextScheduler } = dequeueNextTrack(
    state.scheduler,
    logger,
  );
  const nextHistory = appendRoomHistory(state.history, state.currentTrack);
  return transitionToTrack(
    state,
    nextTrack,
    nextScheduler,
    nextHistory,
    nowMs,
    effects,
    logger,
  );
}

export function reduceRoomEvent(
  state: RoomState,
  event: RoomEvent,
  nowMs: number,
  logger: ListenTogetherLogger = noopLogger,
): { state: RoomState; effects: RoomEffect[] } {
  const effects: RoomEffect[] = [];

  switch (event.type) {
    case "PEER_JOINED": {
      const isHost = event.peerId === state.hostPeerId;
      const role: Role = isHost
        ? "admin"
        : (event.role ?? state.settings.defaultJoinRole);
      const status =
        state.desiredPlaybackState === "IDLE" ? "synced" : "catching-up";

      const reconciled = removePeerAndReconcile(
        state,
        event.peerId,
        nowMs,
        effects,
        logger,
        "PEER_JOINED",
      );
      const nextState: RoomState = {
        ...reconciled.state,
        members: {
          ...reconciled.state.members,
          [event.peerId]: {
            peerId: event.peerId,
            ...(event.clientSlug ? { clientSlug: event.clientSlug } : {}),
            displayName: event.displayName,
            role,
            status,
            transport: event.transport,
          },
        },
      };

      logger.info?.("Peer joined room", {
        peerId: event.peerId,
        role,
        status,
        transport: event.transport,
        epoch: nextState.epoch,
        memberCount: Object.keys(nextState.members).length,
      });

      effects.push({
        type: "SEND_ROOM_SNAPSHOT",
        peerId: event.peerId,
        epoch: nextState.epoch,
        roomId: nextState.roomId,
        settings: nextState.settings,
        members: membersArray(nextState.members),
        currentTrack: nextState.currentTrack,
        anchor: buildPlaybackAnchor(nextState),
        queue: materializeQueue(nextState.scheduler),
        autoplayNext: peekAutoplayNext(nextState.scheduler),
        history: nextState.history,
        skipVotes: nextState.skipVotes,
      });
      if (reconciled.anchorChanged) {
        emitSyncAnchor(nextState, effects);
      }
      emitMembersUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "PEER_LEFT": {
      if (!state.members[event.peerId] || event.peerId === state.hostPeerId) {
        return { state, effects };
      }

      const nextMembers = { ...state.members };
      delete nextMembers[event.peerId];

      const reconciled = removePeerAndReconcile(
        { ...state, members: nextMembers },
        event.peerId,
        nowMs,
        effects,
        logger,
        "PEER_LEFT",
      );
      let nextState = reconciled.state;

      logger.info?.("Peer left room", {
        peerId: event.peerId,
        epoch: nextState.epoch,
        memberCount: Object.keys(nextState.members).length,
      });

      if (reconciled.anchorChanged) {
        emitSyncAnchor(nextState, effects);
      }

      emitMembersUpdated(nextState, effects);
      nextState = maybeCompleteLoadingBarrier(
        nextState,
        nowMs,
        effects,
        logger,
      );
      if (
        nextState.settings.voteSkipMode !== "off" &&
        nextState.currentTrack !== null
      ) {
        const required = computeSkipVotesRequired(
          nextState.settings.voteSkipMode,
          Object.keys(nextState.members).length,
        );
        if (nextState.skipVotes.length >= required) {
          logger.info?.("Advancing track on VOTE_SKIP quorum after peer left", {
            seq: nextState.seq,
            votes: nextState.skipVotes.length,
            required,
          });
          return {
            state: advanceToNextTrack(nextState, nowMs, effects, logger),
            effects,
          };
        }
      }
      if (nextState.skipVotes.length !== state.skipVotes.length) {
        emitQueueUpdated(nextState, effects);
      }
      return { state: nextState, effects };
    }

    case "QUEUE_ADD": {
      const member = state.members[event.actorId];
      if (!member) {
        logger.warn?.("Ignored QUEUE_ADD from unknown peer", {
          actorId: event.actorId,
        });
        return { state, effects };
      }

      const enqueueRes = enqueueDjTrack(
        state.scheduler,
        event.actorId,
        event.track,
        member.role,
        state.settings.rateLimitPreset,
        nowMs,
        logger,
      );
      if (!enqueueRes.ok) {
        effects.push({
          type: "SEND_ACTION_REJECTED",
          peerId: event.actorId,
          reason: enqueueRes.reason,
          retryAfterMs: enqueueRes.retryAfterMs,
        });
        return { state, effects };
      }

      const withQueue: RoomState = {
        ...state,
        scheduler: enqueueRes.state,
      };

      if (withQueue.desiredPlaybackState === "IDLE") {
        return {
          state: advanceToNextTrack(withQueue, nowMs, effects, logger),
          effects,
        };
      }

      if (
        shouldPreemptForDjAdd(
          withQueue.currentTrack,
          withQueue.preemptionInFlight,
          logger,
        )
      ) {
        const preempting: RoomState = {
          ...withQueue,
          preemptionInFlight: true,
        };
        return {
          state: advanceToNextTrack(preempting, nowMs, effects, logger),
          effects,
        };
      }

      emitQueueUpdated(withQueue, effects);
      return { state: withQueue, effects };
    }

    case "QUEUE_REMOVE": {
      const member = state.members[event.actorId];
      if (!member) {
        logger.warn?.("Ignored QUEUE_REMOVE from unknown peer", {
          actorId: event.actorId,
        });
        return { state, effects };
      }
      const res = removeTrack(
        state.scheduler,
        event.entryId,
        event.actorId,
        member.role === "admin",
        logger,
      );
      if (!res.ok) {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: res.state,
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "QUEUE_PIN_NEXT": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored QUEUE_PIN_NEXT from non-admin", {
          actorId: event.actorId,
          entryId: event.entryId,
        });
        return { state, effects };
      }
      const res = pinTrackNext(state.scheduler, event.entryId, logger);
      if (!res.ok) {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: res.state,
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "QUEUE_UNPIN": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored QUEUE_UNPIN from non-admin", {
          actorId: event.actorId,
          entryId: event.entryId,
        });
        return { state, effects };
      }
      const res = unpinTrack(state.scheduler, event.entryId, logger);
      if (!res.ok) {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: res.state,
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "QUEUE_REORDER": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored QUEUE_REORDER from non-admin", {
          actorId: event.actorId,
          entryId: event.entryId,
          targetIndex: event.targetIndex,
        });
        return { state, effects };
      }
      const res = reorderTrack(
        state.scheduler,
        event.entryId,
        event.targetIndex,
        logger,
      );
      if (!res.ok) {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: res.state,
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "HOST_JUMP_TRACK": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored HOST_JUMP_TRACK from non-admin", {
          actorId: event.actorId,
          target: event.target,
          entryId: event.entryId,
        });
        return { state, effects };
      }
      if (event.target === "queue") {
        const res = jumpToQueuedTrack(state.scheduler, event.entryId, logger);
        if (!res.track) {
          return { state, effects };
        }
        const nextHistory = appendRoomHistory(state.history, state.currentTrack);
        logger.info?.("Host jumped to queued track", {
          actorId: event.actorId,
          entryId: res.track.entryId,
          videoId: res.track.videoId,
          fromSeq: state.seq,
        });
        return {
          state: transitionToTrack(
            state,
            res.track,
            res.state,
            nextHistory,
            nowMs,
            effects,
            logger,
          ),
          effects,
        };
      }

      const historyIdx = state.history.findIndex(
        (t) => t.entryId === event.entryId,
      );
      if (historyIdx === -1) {
        return { state, effects };
      }
      const selectedTrack = state.history[historyIdx];
      const historyWithoutSelected = [
        ...state.history.slice(0, historyIdx),
        ...state.history.slice(historyIdx + 1),
      ];
      const nextHistory = appendRoomHistory(
        historyWithoutSelected,
        state.currentTrack,
      );
      const nextScheduler = recordHistoryVideoId(
        state.scheduler,
        selectedTrack.videoId,
      );
      logger.info?.("Host jumped to history track", {
        actorId: event.actorId,
        entryId: selectedTrack.entryId,
        videoId: selectedTrack.videoId,
        fromSeq: state.seq,
      });
      return {
        state: transitionToTrack(
          state,
          selectedTrack,
          nextScheduler,
          nextHistory,
          nowMs,
          effects,
          logger,
        ),
        effects,
      };
    }

    case "VOTE_SKIP": {
      const member = state.members[event.peerId];
      if (
        state.settings.voteSkipMode === "off" ||
        !member ||
        event.seq !== state.seq ||
        !state.currentTrack
      ) {
        return { state, effects };
      }
      const alreadyVoted = state.skipVotes.includes(event.peerId);
      const nextSkipVotes = alreadyVoted
        ? state.skipVotes.filter((id) => id !== event.peerId)
        : [...state.skipVotes, event.peerId];
      const required = computeSkipVotesRequired(
        state.settings.voteSkipMode,
        Object.keys(state.members).length,
      );

      if (nextSkipVotes.length >= required) {
        logger.info?.("Advancing track on VOTE_SKIP quorum", {
          seq: state.seq,
          videoId: state.currentTrack.videoId,
          peerId: event.peerId,
          votes: nextSkipVotes.length,
          required,
          mode: state.settings.voteSkipMode,
        });
        return {
          state: advanceToNextTrack(
            { ...state, skipVotes: nextSkipVotes },
            nowMs,
            effects,
            logger,
          ),
          effects,
        };
      }

      const nextState: RoomState = {
        ...state,
        skipVotes: nextSkipVotes,
      };
      logger.debug?.("Updated VOTE_SKIP tally", {
        seq: state.seq,
        peerId: event.peerId,
        voted: !alreadyVoted,
        votes: nextSkipVotes.length,
        required,
      });
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "AUTOPLAY_CANDIDATES": {
      const member = state.members[event.actorId];
      if (!member || member.role === "listener") {
        logger.warn?.("Rejected AUTOPLAY_CANDIDATES from non-DJ peer", {
          actorId: event.actorId,
          role: member?.role,
        });
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: setAutoplayCandidates(
          state.scheduler,
          event.candidates,
          logger,
        ),
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "AUTOPLAY_DISMISS": {
      const member = state.members[event.actorId];
      if (!member || member.role === "listener") {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        scheduler: dismissAutoplayNext(state.scheduler),
      };
      emitQueueUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "MEMBER_LISTENING_MODE": {
      const member = state.members[event.peerId];
      if (!member || member.listeningMode === event.listeningMode) {
        return { state, effects };
      }
      const nextState: RoomState = {
        ...state,
        members: {
          ...state.members,
          [event.peerId]: {
            ...member,
            listeningMode: event.listeningMode,
          },
        },
      };
      emitMembersUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "TRACK_READY": {
      const member = state.members[event.peerId];
      if (
        !member ||
        event.seq !== state.seq ||
        state.desiredPlaybackState === "IDLE"
      ) {
        return { state, effects };
      }

      const loadingReadyPeers = state.loadingReadyPeers.includes(event.peerId)
        ? state.loadingReadyPeers
        : [...state.loadingReadyPeers, event.peerId];

      let statusChanged = false;
      let nextMembers = state.members;
      if (
        member.status === "buffering" ||
        member.status === "catching-up" ||
        member.status === "unavailable"
      ) {
        statusChanged = true;
        nextMembers = {
          ...state.members,
          [event.peerId]: {
            ...member,
            status: "synced",
          },
        };
      }

      let nextState: RoomState = {
        ...state,
        loadingReadyPeers,
        members: nextMembers,
      };
      if (statusChanged) {
        emitMembersUpdated(nextState, effects);
      }
      nextState = maybeCompleteLoadingBarrier(
        nextState,
        nowMs,
        effects,
        logger,
      );
      return { state: nextState, effects };
    }

    case "AD_STARTED": {
      const member = state.members[event.peerId];
      if (
        !member ||
        event.seq !== state.seq ||
        state.desiredPlaybackState === "IDLE"
      ) {
        return { state, effects };
      }

      const previousStatus = member.status;
      const grantKey = `${event.peerId}:${event.seq}`;
      const canGrantAdWait =
        state.settings.adSyncMode === "pause-for-all" &&
        !state.sessionStayLivePeers.includes(event.peerId) &&
        previousStatus !== "catching-up" &&
        !state.adWaitGrantedForSeq[grantKey];

      let nextState: RoomState = {
        ...state,
        members: {
          ...state.members,
          [event.peerId]: {
            ...member,
            status: "in-ad",
          },
        },
      };

      if (canGrantAdWait) {
        const snapshotPos = nextState.pausedForAd
          ? nextState.anchorPosSec
          : projectLivePosSec(nextState, nowMs);
        nextState = {
          ...nextState,
          pausedForAd: true,
          anchorPosSec: snapshotPos,
          anchorHostTimeMs: nowMs,
          waitingOnAds: {
            ...nextState.waitingOnAds,
            [event.peerId]: nowMs,
          },
          adWaitGrantedForSeq: {
            ...nextState.adWaitGrantedForSeq,
            [grantKey]: true,
          },
        };
        logger.info?.("Entered PAUSED_FOR_AD for peer", {
          peerId: event.peerId,
          seq: event.seq,
          alreadyPausedForAd: state.pausedForAd,
          waitingPeerCount: Object.keys(nextState.waitingOnAds).length,
          anchorPosSec: snapshotPos,
        });
        effects.push({
          type: "SCHEDULE_TIMER",
          timer: "AD_STUCK",
          seq: event.seq,
          delayMs: AD_STUCK_TIMEOUT_MS,
          peerId: event.peerId,
        });
        emitSyncAnchor(nextState, effects);
        emitMembersUpdated(nextState, effects);
        return { state: nextState, effects };
      }

      logger.debug?.("AD_STARTED did not pause room", {
        peerId: event.peerId,
        seq: event.seq,
        adSyncMode: state.settings.adSyncMode,
        sessionStayLive: state.sessionStayLivePeers.includes(event.peerId),
        previousStatus,
        waitAlreadyGranted: Boolean(state.adWaitGrantedForSeq[grantKey]),
      });

      if (previousStatus !== "in-ad") {
        emitMembersUpdated(nextState, effects);
      }
      nextState = maybeCompleteLoadingBarrier(
        nextState,
        nowMs,
        effects,
        logger,
      );
      return { state: nextState, effects };
    }

    case "AD_ENDED": {
      const member = state.members[event.peerId];
      if (!member || event.seq !== state.seq) {
        return { state, effects };
      }

      const targetStatus =
        state.desiredPlaybackState === "LOADING_BARRIER" &&
        !state.loadingReadyPeers.includes(event.peerId)
          ? "buffering"
          : "synced";

      let nextState: RoomState = {
        ...state,
        members: {
          ...state.members,
          [event.peerId]: {
            ...member,
            status: targetStatus,
          },
        },
      };

      const adCleanup = removePeerFromAdWaits(
        nextState,
        event.peerId,
        nowMs,
        effects,
        logger,
        "AD_ENDED",
      );
      nextState = adCleanup.state;
      if (adCleanup.anchorChanged) {
        emitSyncAnchor(nextState, effects);
      }
      emitMembersUpdated(nextState, effects);
      return { state: nextState, effects };
    }

    case "HOST_FORCE_RESUME_FROM_AD": {
      if (!isAdmin(state, event.actorId) || event.seq !== state.seq) {
        logger.warn?.("Ignored HOST_FORCE_RESUME_FROM_AD", {
          actorId: event.actorId,
          eventSeq: event.seq,
          roomSeq: state.seq,
          isAdmin: isAdmin(state, event.actorId),
        });
        return { state, effects };
      }
      logger.info?.("Host forced resume from ad wait", {
        actorId: event.actorId,
        seq: state.seq,
        waitingPeerIds: Object.keys(state.waitingOnAds),
        wasPausedForAd: state.pausedForAd,
      });
      const nextState = clearAdWaits(
        state,
        nowMs,
        effects,
        logger,
        "HOST_FORCE_RESUME_FROM_AD",
      );
      if (nextState !== state) {
        emitSyncAnchor(nextState, effects);
      }
      return { state: nextState, effects };
    }

    case "TRACK_ENDED": {
      const member = state.members[event.peerId];
      if (!member || event.seq !== state.seq || !state.currentTrack) {
        return { state, effects };
      }

      const endedVotes = state.endedVotes.includes(event.peerId)
        ? state.endedVotes
        : [...state.endedVotes, event.peerId];

      const activeNonAd = Object.values(state.members).filter(
        (m) =>
          m.status !== "in-ad" &&
          m.status !== "catching-up" &&
          m.status !== "unavailable",
      );
      const activeIds = new Set(activeNonAd.map((m) => m.peerId));
      const relevantVotes =
        activeIds.size > 0
          ? endedVotes.filter((id) => activeIds.has(id)).length
          : endedVotes.length;
      const quorumThreshold = Math.max(1, activeIds.size) * 0.5;

      const nextState: RoomState = {
        ...state,
        endedVotes,
      };

      if (relevantVotes >= quorumThreshold) {
        logger.info?.("Advancing track on endedVotes quorum", {
          seq: state.seq,
          videoId: state.currentTrack.videoId,
          peerId: event.peerId,
          relevantVotes,
          quorumThreshold,
          activePeerCount: activeIds.size,
          endedVotes,
        });
        return {
          state: advanceToNextTrack(nextState, nowMs, effects, logger),
          effects,
        };
      }
      logger.debug?.("Recorded TRACK_ENDED vote below quorum", {
        seq: state.seq,
        peerId: event.peerId,
        relevantVotes,
        quorumThreshold,
        activePeerCount: activeIds.size,
      });
      return { state: nextState, effects };
    }

    case "TRACK_UNAVAILABLE": {
      const member = state.members[event.peerId];
      if (!member || event.seq !== state.seq || !state.currentTrack) {
        return { state, effects };
      }

      if (
        isAdmin(state, event.peerId) ||
        event.peerId === state.currentTrack.addedBy
      ) {
        logger.warn?.("Skipping unavailable track immediately", {
          seq: state.seq,
          videoId: state.currentTrack.videoId,
          peerId: event.peerId,
          isAdmin: isAdmin(state, event.peerId),
          isTrackAdder: event.peerId === state.currentTrack.addedBy,
          errorCode: event.errorCode,
        });
        return {
          state: advanceToNextTrack(state, nowMs, effects, logger),
          effects,
        };
      }

      const unavailableVotes = state.unavailableVotes.includes(event.peerId)
        ? state.unavailableVotes
        : [...state.unavailableVotes, event.peerId];
      const eligiblePeers = Object.values(state.members).filter(
        (m) => m.status !== "catching-up",
      );
      const threshold = Math.max(1, eligiblePeers.length) * 0.5;

      if (unavailableVotes.length >= threshold) {
        logger.warn?.("Skipping unavailable track on majority quorum", {
          seq: state.seq,
          videoId: state.currentTrack.videoId,
          peerId: event.peerId,
          errorCode: event.errorCode,
          unavailableVotes: unavailableVotes.length,
          threshold,
          eligiblePeerCount: eligiblePeers.length,
        });
        return {
          state: advanceToNextTrack(
            { ...state, unavailableVotes },
            nowMs,
            effects,
            logger,
          ),
          effects,
        };
      }

      logger.warn?.("Marked peer unavailable for current track (minority)", {
        seq: state.seq,
        videoId: state.currentTrack.videoId,
        peerId: event.peerId,
        errorCode: event.errorCode,
        unavailableVotes: unavailableVotes.length,
        threshold,
        eligiblePeerCount: eligiblePeers.length,
      });

      let nextState: RoomState = {
        ...state,
        unavailableVotes,
        members: {
          ...state.members,
          [event.peerId]: {
            ...member,
            status: "unavailable",
          },
        },
      };

      const adCleanup = removePeerFromAdWaits(
        nextState,
        event.peerId,
        nowMs,
        effects,
        logger,
        "TRACK_UNAVAILABLE",
      );
      nextState = adCleanup.state;
      if (adCleanup.anchorChanged) {
        emitSyncAnchor(nextState, effects);
      }
      emitMembersUpdated(nextState, effects);
      nextState = maybeCompleteLoadingBarrier(
        nextState,
        nowMs,
        effects,
        logger,
      );
      return { state: nextState, effects };
    }

    case "HOST_TRANSPORT": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored HOST_TRANSPORT from non-admin", {
          actorId: event.actorId,
          action: event.action,
        });
        return { state, effects };
      }

      switch (event.action) {
        case "play": {
          if (!state.currentTrack) {
            logger.info?.("Applied host transport play on empty currentTrack", {
              actorId: event.actorId,
              seq: state.seq,
            });
            return {
              state: advanceToNextTrack(state, nowMs, effects, logger),
              effects,
            };
          }
          if (state.desiredPlaybackState === "PAUSED_BY_USER") {
            const nextState: RoomState = {
              ...state,
              desiredPlaybackState: "PLAYING",
              anchorHostTimeMs: state.pausedForAd
                ? nowMs
                : nowMs + PLAYBACK_START_LEAD_MS,
            };
            logger.info?.("Applied host transport play", {
              actorId: event.actorId,
              seq: nextState.seq,
              anchorPosSec: nextState.anchorPosSec,
              pausedForAd: nextState.pausedForAd,
            });
            emitSyncAnchor(nextState, effects);
            return { state: nextState, effects };
          }
          return { state, effects };
        }

        case "pause": {
          if (state.currentTrack && state.desiredPlaybackState === "PLAYING") {
            const nextState: RoomState = {
              ...state,
              desiredPlaybackState: "PAUSED_BY_USER",
              anchorPosSec: projectLivePosSec(state, nowMs),
              anchorHostTimeMs: nowMs,
            };
            logger.info?.("Applied host transport pause", {
              actorId: event.actorId,
              seq: nextState.seq,
              anchorPosSec: nextState.anchorPosSec,
            });
            emitSyncAnchor(nextState, effects);
            return { state: nextState, effects };
          }
          if (
            state.currentTrack &&
            state.desiredPlaybackState === "LOADING_BARRIER"
          ) {
            effects.push({ type: "CANCEL_TIMER", timer: "LOADING_BARRIER" });
            const nextState: RoomState = {
              ...state,
              desiredPlaybackState: "PAUSED_BY_USER",
              anchorPosSec: 0,
              anchorHostTimeMs: nowMs,
              loadingBarrierStartedAtMs: null,
            };
            logger.info?.(
              "Applied host transport pause during LOADING_BARRIER",
              {
                actorId: event.actorId,
                seq: nextState.seq,
              },
            );
            emitSyncAnchor(nextState, effects);
            return { state: nextState, effects };
          }
          return { state, effects };
        }

        case "seek": {
          if (
            state.currentTrack &&
            event.seekPosSec !== undefined &&
            Number.isFinite(event.seekPosSec)
          ) {
            const clampedPos = Math.max(
              0,
              Math.min(state.currentTrack.durationSec, event.seekPosSec),
            );
            const nextState: RoomState = {
              ...state,
              anchorPosSec: clampedPos,
              anchorHostTimeMs:
                state.desiredPlaybackState === "PLAYING" && !state.pausedForAd
                  ? nowMs + PLAYBACK_START_LEAD_MS
                  : nowMs,
            };
            logger.info?.("Applied host transport seek", {
              actorId: event.actorId,
              seq: nextState.seq,
              seekPosSec: clampedPos,
            });
            emitSyncAnchor(nextState, effects);
            return { state: nextState, effects };
          }
          return { state, effects };
        }

        case "skip": {
          logger.info?.("Applied host transport skip", {
            actorId: event.actorId,
            seq: state.seq,
            skippedVideoId: state.currentTrack?.videoId ?? null,
          });
          return {
            state: advanceToNextTrack(state, nowMs, effects, logger),
            effects,
          };
        }
      }
    }

    case "HOST_MODERATION": {
      if (
        !isAdmin(state, event.actorId) ||
        event.targetPeerId === state.hostPeerId
      ) {
        logger.warn?.("Ignored HOST_MODERATION", {
          actorId: event.actorId,
          targetPeerId: event.targetPeerId,
          action: event.action,
        });
        return { state, effects };
      }
      const target = state.members[event.targetPeerId];
      if (!target) {
        logger.warn?.("Ignored HOST_MODERATION for unknown peer", {
          actorId: event.actorId,
          targetPeerId: event.targetPeerId,
          action: event.action,
        });
        return { state, effects };
      }

      switch (event.action) {
        case "make-dj": {
          const nextState: RoomState = {
            ...state,
            members: {
              ...state.members,
              [event.targetPeerId]: { ...target, role: "dj" },
            },
          };
          logger.info?.("Updated member role", {
            actorId: event.actorId,
            targetPeerId: event.targetPeerId,
            previousRole: target.role,
            nextRole: "dj",
          });
          emitMembersUpdated(nextState, effects);
          return { state: nextState, effects };
        }

        case "make-listener": {
          const nextState: RoomState = {
            ...state,
            members: {
              ...state.members,
              [event.targetPeerId]: { ...target, role: "listener" },
            },
          };
          logger.info?.("Updated member role", {
            actorId: event.actorId,
            targetPeerId: event.targetPeerId,
            previousRole: target.role,
            nextRole: "listener",
          });
          emitMembersUpdated(nextState, effects);
          return { state: nextState, effects };
        }

        case "demote-clear": {
          const nextState: RoomState = {
            ...state,
            members: {
              ...state.members,
              [event.targetPeerId]: { ...target, role: "listener" },
            },
            scheduler: purgePeerTracks(
              state.scheduler,
              event.targetPeerId,
              logger,
              "demote-clear",
            ),
          };
          logger.info?.("Demoted peer and cleared queued tracks", {
            actorId: event.actorId,
            targetPeerId: event.targetPeerId,
            previousRole: target.role,
          });
          emitMembersUpdated(nextState, effects);
          emitQueueUpdated(nextState, effects);
          return { state: nextState, effects };
        }

        case "kick": {
          const nextMembers = { ...state.members };
          delete nextMembers[event.targetPeerId];

          let nextState: RoomState = {
            ...state,
            members: nextMembers,
            scheduler: purgePeerTracks(
              state.scheduler,
              event.targetPeerId,
              logger,
              "kick",
            ),
            loadingReadyPeers: state.loadingReadyPeers.filter(
              (id) => id !== event.targetPeerId,
            ),
            endedVotes: state.endedVotes.filter(
              (id) => id !== event.targetPeerId,
            ),
            unavailableVotes: state.unavailableVotes.filter(
              (id) => id !== event.targetPeerId,
            ),
            skipVotes: state.skipVotes.filter(
              (id) => id !== event.targetPeerId,
            ),
          };

          logger.info?.("Kicked peer from room", {
            actorId: event.actorId,
            targetPeerId: event.targetPeerId,
          });

          const adCleanup = removePeerFromAdWaits(
            nextState,
            event.targetPeerId,
            nowMs,
            effects,
            logger,
            "KICK",
          );
          nextState = adCleanup.state;
          effects.push({
            type: "DISCONNECT_PEER",
            peerId: event.targetPeerId,
            reason: "kicked",
          });
          if (adCleanup.anchorChanged) {
            emitSyncAnchor(nextState, effects);
          }
          emitMembersUpdated(nextState, effects);
          emitQueueUpdated(nextState, effects);
          nextState = maybeCompleteLoadingBarrier(
            nextState,
            nowMs,
            effects,
            logger,
          );
          if (
            nextState.settings.voteSkipMode !== "off" &&
            nextState.currentTrack !== null
          ) {
            const required = computeSkipVotesRequired(
              nextState.settings.voteSkipMode,
              Object.keys(nextState.members).length,
            );
            if (nextState.skipVotes.length >= required) {
              logger.info?.("Advancing track on VOTE_SKIP quorum after kick", {
                seq: nextState.seq,
                votes: nextState.skipVotes.length,
                required,
              });
              return {
                state: advanceToNextTrack(nextState, nowMs, effects, logger),
                effects,
              };
            }
          }
          return { state: nextState, effects };
        }
      }
    }

    case "HOST_UPDATE_SETTINGS": {
      if (!isAdmin(state, event.actorId)) {
        logger.warn?.("Ignored HOST_UPDATE_SETTINGS from non-admin", {
          actorId: event.actorId,
        });
        return { state, effects };
      }
      const nextSettings: RoomSettings = {
        ...state.settings,
        ...event.settings,
      };

      let nextScheduler = state.scheduler;
      const queueModeChanged =
        nextSettings.queueMode !== state.settings.queueMode;
      if (queueModeChanged) {
        nextScheduler = setSchedulerMode(
          nextScheduler,
          nextSettings.queueMode,
          logger,
        );
      }

      let skipVotes = state.skipVotes;
      let skipVotesChanged = false;
      if (nextSettings.voteSkipMode === "off" && skipVotes.length > 0) {
        skipVotes = [];
        skipVotesChanged = true;
      }

      let nextState: RoomState = {
        ...state,
        settings: nextSettings,
        scheduler: nextScheduler,
        skipVotes,
      };

      if (nextSettings.adSyncMode === "stay-live") {
        const cleared = clearAdWaits(
          nextState,
          nowMs,
          effects,
          logger,
          "SETTINGS_STAY_LIVE",
        );
        if (cleared !== nextState) {
          nextState = cleared;
          emitSyncAnchor(nextState, effects);
        }
      }

      logger.info?.("Updated room settings", {
        actorId: event.actorId,
        settings: nextSettings,
      });

      effects.push({
        type: "BROADCAST_SETTINGS_UPDATED",
        epoch: nextState.epoch,
        settings: nextSettings,
      });
      if (
        nextSettings.voteSkipMode !== "off" &&
        nextState.currentTrack !== null &&
        nextState.skipVotes.length >=
          computeSkipVotesRequired(
            nextSettings.voteSkipMode,
            Object.keys(nextState.members).length,
          )
      ) {
        return {
          state: advanceToNextTrack(nextState, nowMs, effects, logger),
          effects,
        };
      }
      if (queueModeChanged || skipVotesChanged) {
        emitQueueUpdated(nextState, effects);
      }
      return { state: nextState, effects };
    }

    case "TICK": {
      let nextState = state;

      const expiredAdEntries = Object.entries(nextState.waitingOnAds).filter(
        ([, startedAtMs]) => nowMs - startedAtMs >= AD_STUCK_TIMEOUT_MS,
      );

      if (expiredAdEntries.length > 0) {
        const nextWaiting = { ...nextState.waitingOnAds };
        const nextTimeoutCounts = { ...nextState.adTimeoutCounts };
        const nextStayLivePeers = [...nextState.sessionStayLivePeers];
        const expiredAdPeers: string[] = [];

        for (const [peerId, startedAtMs] of expiredAdEntries) {
          expiredAdPeers.push(peerId);
          delete nextWaiting[peerId];
          const count = (nextTimeoutCounts[peerId] ?? 0) + 1;
          nextTimeoutCounts[peerId] = count;
          logger.warn?.("Peer hit 90s stuck-ad timeout", {
            peerId,
            seq: nextState.seq,
            timeoutCount: count,
            maxTimeoutsBeforeDemote: MAX_AD_TIMEOUTS_BEFORE_DEMOTE,
            elapsedMs: nowMs - startedAtMs,
          });
          if (
            count >= MAX_AD_TIMEOUTS_BEFORE_DEMOTE &&
            !nextStayLivePeers.includes(peerId)
          ) {
            nextStayLivePeers.push(peerId);
            logger.warn?.(
              "Auto-demoted peer to stay-live after repeated ad timeouts",
              {
                peerId,
                seq: nextState.seq,
                timeoutCount: count,
              },
            );
          }
          effects.push({ type: "CANCEL_TIMER", timer: "AD_STUCK", peerId });
        }

        const resumeAnchor =
          Object.keys(nextWaiting).length === 0 && nextState.pausedForAd;
        nextState = {
          ...nextState,
          waitingOnAds: nextWaiting,
          adTimeoutCounts: nextTimeoutCounts,
          sessionStayLivePeers: nextStayLivePeers,
          pausedForAd: resumeAnchor ? false : nextState.pausedForAd,
          anchorHostTimeMs: resumeAnchor
            ? nextState.desiredPlaybackState === "PLAYING"
              ? nowMs + PLAYBACK_START_LEAD_MS
              : nowMs
            : nextState.anchorHostTimeMs,
        };

        if (resumeAnchor) {
          logger.info?.("Resumed from PAUSED_FOR_AD after stuck-ad timeout", {
            seq: nextState.seq,
            expiredAdPeers,
            anchorPosSec: nextState.anchorPosSec,
          });
        }

        emitSyncAnchor(nextState, effects);
      }

      if (
        nextState.desiredPlaybackState === "LOADING_BARRIER" &&
        nextState.loadingBarrierStartedAtMs !== null &&
        nowMs - nextState.loadingBarrierStartedAtMs >=
          LOADING_BARRIER_TIMEOUT_MS
      ) {
        const elapsedMs = nowMs - nextState.loadingBarrierStartedAtMs;
        const readySet = new Set(nextState.loadingReadyPeers);
        const pendingPeerIds = Object.values(nextState.members)
          .filter((m) => isBarrierEligible(m) && !readySet.has(m.peerId))
          .map((m) => m.peerId);
        nextState = {
          ...nextState,
          desiredPlaybackState: "PLAYING",
          anchorHostTimeMs: nowMs + PLAYBACK_START_LEAD_MS,
          loadingBarrierStartedAtMs: null,
        };
        effects.push({ type: "CANCEL_TIMER", timer: "LOADING_BARRIER" });
        logger.warn?.("LOADING_BARRIER timed out; forcing playback start", {
          seq: nextState.seq,
          videoId: nextState.currentTrack?.videoId ?? "",
          elapsedMs,
          readyPeers: nextState.loadingReadyPeers.length,
          pendingPeerIds,
        });
        emitSyncAnchor(nextState, effects);
      }

      if (
        nextState.desiredPlaybackState === "PLAYING" &&
        !nextState.pausedForAd &&
        nextState.currentTrack !== null &&
        projectLivePosSec(nextState, nowMs) >=
          nextState.currentTrack.durationSec
      ) {
        logger.info?.("Advancing track on duration reached", {
          seq: nextState.seq,
          videoId: nextState.currentTrack.videoId,
          durationSec: nextState.currentTrack.durationSec,
        });
        nextState = advanceToNextTrack(nextState, nowMs, effects, logger);
      }

      return { state: nextState, effects };
    }
  }
}
