import { Value } from "@sinclair/typebox/value";
import { noopLogger, type ListenTogetherLogger } from "./logger";
import {
  QueueTrackSchema,
  type ActionRejectedReason,
  type QueueMode,
  type QueueTrack,
  type RateLimitPreset,
  type Role,
} from "./protocol";

const MAX_HISTORY_VIDEO_IDS = 20;
const OFF_MAX_QUEUED_PER_DJ = 25;
const OFF_DEBOUNCE_MS = 1_000;
const STRICT_MAX_QUEUED_PER_DJ = 3;
const STRICT_COOLDOWN_MS = 30_000;

export type SchedulerState = {
  mode: QueueMode;
  perDjQueues: Record<string, QueueTrack[]>;
  djNextRound: Record<string, number>;
  currentRound: number;
  fifoOrder: string[];
  pinnedNext: QueueTrack[];
  autoplayPool: QueueTrack[];
  historyVideoIds: string[];
  lastEnqueueAtByDj: Record<string, number>;
};

export type EnqueueDjTrackResult =
  | { ok: true; state: SchedulerState }
  | { ok: false; reason: ActionRejectedReason; retryAfterMs?: number };

export function createSchedulerState(
  mode: QueueMode = "fair-rr",
): SchedulerState {
  return {
    mode,
    perDjQueues: {},
    djNextRound: {},
    currentRound: 0,
    fifoOrder: [],
    pinnedNext: [],
    autoplayPool: [],
    historyVideoIds: [],
    lastEnqueueAtByDj: {},
  };
}

function collectQueuedVideoIds(
  state: Pick<SchedulerState, "pinnedNext" | "perDjQueues">,
): Set<string> {
  const ids = new Set<string>();
  for (const track of state.pinnedNext) {
    ids.add(track.videoId);
  }
  for (const queue of Object.values(state.perDjQueues)) {
    for (const track of queue) {
      ids.add(track.videoId);
    }
  }
  return ids;
}

function hasEntryId(
  state: Pick<SchedulerState, "pinnedNext" | "perDjQueues">,
  entryId: string,
): boolean {
  if (state.pinnedNext.some((t) => t.entryId === entryId)) return true;
  for (const queue of Object.values(state.perDjQueues)) {
    if (queue.some((t) => t.entryId === entryId)) return true;
  }
  return false;
}

function appendHistoryVideoId(
  historyVideoIds: string[],
  videoId: string,
): string[] {
  const next = [...historyVideoIds, videoId];
  if (next.length > MAX_HISTORY_VIDEO_IDS) {
    return next.slice(next.length - MAX_HISTORY_VIDEO_IDS);
  }
  return next;
}

function deduplicateAutoplayPool(
  candidates: readonly QueueTrack[],
  queuedVideoIds: Set<string>,
  historyVideoIds: readonly string[],
): QueueTrack[] {
  const blocked = new Set<string>(queuedVideoIds);
  for (const videoId of historyVideoIds.slice(-MAX_HISTORY_VIDEO_IDS)) {
    blocked.add(videoId);
  }
  const result: QueueTrack[] = [];
  for (const candidate of candidates) {
    if (blocked.has(candidate.videoId)) continue;
    blocked.add(candidate.videoId);
    result.push({
      ...candidate,
      source: "autoplay",
      pinned: false,
    });
  }
  return result;
}

export function recordHistoryVideoId(
  state: SchedulerState,
  videoId: string,
): SchedulerState {
  const historyVideoIds = appendHistoryVideoId(state.historyVideoIds, videoId);
  const queuedVideoIds = collectQueuedVideoIds(state);
  return {
    ...state,
    historyVideoIds,
    autoplayPool: deduplicateAutoplayPool(
      state.autoplayPool,
      queuedVideoIds,
      historyVideoIds,
    ),
  };
}

export function enqueueDjTrack(
  state: SchedulerState,
  djId: string,
  track: QueueTrack,
  role: Role,
  rateLimitPreset: RateLimitPreset,
  nowMs: number,
  logger: ListenTogetherLogger = noopLogger,
): EnqueueDjTrackResult {
  if (role === "listener") {
    logger.warn?.("Rejected DJ track enqueue: insufficient role", {
      djId,
      role,
      videoId: track.videoId,
      reason: "NOT_DJ",
    });
    return { ok: false, reason: "NOT_DJ" };
  }

  const normalizedTrack: QueueTrack = {
    ...track,
    addedBy: djId,
    addedAtMs:
      Number.isFinite(track.addedAtMs) && track.addedAtMs >= 0
        ? track.addedAtMs
        : nowMs,
    source: "dj",
    pinned: false,
  };

  const duplicateEntryId = hasEntryId(state, normalizedTrack.entryId);
  if (!Value.Check(QueueTrackSchema, normalizedTrack) || duplicateEntryId) {
    logger.warn?.("Rejected DJ track enqueue: invalid track", {
      djId,
      entryId: track.entryId,
      videoId: track.videoId,
      duplicateEntryId,
      reason: "INVALID_TRACK",
    });
    return { ok: false, reason: "INVALID_TRACK" };
  }

  if (role !== "admin") {
    const existingDjCount =
      (state.perDjQueues[djId]?.length ?? 0) +
      state.pinnedNext.filter((t) => t.addedBy === djId).length;
    const maxQueued =
      rateLimitPreset === "strict"
        ? STRICT_MAX_QUEUED_PER_DJ
        : OFF_MAX_QUEUED_PER_DJ;
    if (existingDjCount >= maxQueued) {
      logger.warn?.("Rejected DJ track enqueue: max queued tracks reached", {
        djId,
        role,
        rateLimitPreset,
        existingDjCount,
        maxQueued,
        reason: "MAX_QUEUE_REACHED",
      });
      return { ok: false, reason: "MAX_QUEUE_REACHED" };
    }

    const cooldownMs =
      rateLimitPreset === "strict" ? STRICT_COOLDOWN_MS : OFF_DEBOUNCE_MS;
    const lastEnqueueMs = state.lastEnqueueAtByDj[djId];
    if (lastEnqueueMs !== undefined && nowMs - lastEnqueueMs < cooldownMs) {
      const retryAfterMs = cooldownMs - (nowMs - lastEnqueueMs);
      logger.warn?.("Rejected DJ track enqueue: rate limited", {
        djId,
        role,
        rateLimitPreset,
        cooldownMs,
        retryAfterMs,
        reason: "RATE_LIMITED",
      });
      return {
        ok: false,
        reason: "RATE_LIMITED",
        retryAfterMs,
      };
    }
  }

  const existingQueue = state.perDjQueues[djId] ?? [];
  const nextDjNextRound = { ...state.djNextRound };
  if (existingQueue.length === 0) {
    nextDjNextRound[djId] = Math.max(
      state.djNextRound[djId] ?? 0,
      state.currentRound,
    );
  }

  const nextPerDjQueues = {
    ...state.perDjQueues,
    [djId]: [...existingQueue, normalizedTrack],
  };
  const nextFifoOrder = [...state.fifoOrder, normalizedTrack.entryId];
  const nextLastEnqueueAtByDj = {
    ...state.lastEnqueueAtByDj,
    [djId]: nowMs,
  };
  const queuedVideoIds = collectQueuedVideoIds({
    pinnedNext: state.pinnedNext,
    perDjQueues: nextPerDjQueues,
  });

  logger.debug?.("Enqueued DJ track", {
    djId,
    entryId: normalizedTrack.entryId,
    videoId: normalizedTrack.videoId,
    mode: state.mode,
    round: nextDjNextRound[djId],
  });

  return {
    ok: true,
    state: {
      ...state,
      perDjQueues: nextPerDjQueues,
      djNextRound: nextDjNextRound,
      fifoOrder: nextFifoOrder,
      lastEnqueueAtByDj: nextLastEnqueueAtByDj,
      autoplayPool: deduplicateAutoplayPool(
        state.autoplayPool,
        queuedVideoIds,
        state.historyVideoIds,
      ),
    },
  };
}

function selectFairRrNextDj(
  perDjQueues: Record<string, QueueTrack[]>,
  djNextRound: Record<string, number>,
  headIndices?: Record<string, number>,
): { djId: string; round: number; head: QueueTrack } | null {
  let best: { djId: string; round: number; head: QueueTrack } | null = null;

  for (const [djId, queue] of Object.entries(perDjQueues)) {
    const headIdx = headIndices?.[djId] ?? 0;
    if (headIdx >= queue.length) continue;
    const head = queue[headIdx];
    const round = djNextRound[djId] ?? 0;

    if (
      !best ||
      round < best.round ||
      (round === best.round && head.addedAtMs < best.head.addedAtMs) ||
      (round === best.round &&
        head.addedAtMs === best.head.addedAtMs &&
        head.entryId < best.head.entryId)
    ) {
      best = { djId, round, head };
    }
  }

  return best;
}

function finalizeDequeuedTrack(
  state: SchedulerState,
  track: QueueTrack,
  overrides: Partial<
    Pick<
      SchedulerState,
      "pinnedNext" | "perDjQueues" | "djNextRound" | "currentRound" | "fifoOrder"
    >
  >,
): { track: QueueTrack; state: SchedulerState } {
  const pinnedNext = overrides.pinnedNext ?? state.pinnedNext;
  const perDjQueues = overrides.perDjQueues ?? state.perDjQueues;
  const historyVideoIds = appendHistoryVideoId(
    state.historyVideoIds,
    track.videoId,
  );
  const queuedVideoIds = collectQueuedVideoIds({ pinnedNext, perDjQueues });
  return {
    track,
    state: {
      ...state,
      ...overrides,
      historyVideoIds,
      autoplayPool: deduplicateAutoplayPool(
        state.autoplayPool,
        queuedVideoIds,
        historyVideoIds,
      ),
    },
  };
}

function dequeuePinnedNextAt(
  state: SchedulerState,
  index: number,
): { track: QueueTrack; state: SchedulerState } {
  const track = state.pinnedNext[index];
  const nextPinned = [
    ...state.pinnedNext.slice(0, index),
    ...state.pinnedNext.slice(index + 1),
  ];
  return finalizeDequeuedTrack(state, track, { pinnedNext: nextPinned });
}

export function dequeueNextTrack(
  state: SchedulerState,
  logger: ListenTogetherLogger = noopLogger,
): {
  track: QueueTrack | null;
  state: SchedulerState;
} {
  if (state.pinnedNext.length > 0) {
    const res = dequeuePinnedNextAt(state, 0);
    logger.debug?.("Dequeued next track", {
      lane: "pinned",
      entryId: res.track.entryId,
      videoId: res.track.videoId,
      addedBy: res.track.addedBy,
    });
    return res;
  }

  if (state.mode === "fifo" && state.fifoOrder.length > 0) {
    const [nextEntryId, ...restFifo] = state.fifoOrder;
    const nextPerDjQueues: Record<string, QueueTrack[]> = {
      ...state.perDjQueues,
    };
    let dequeued: QueueTrack | null = null;

    for (const [djId, queue] of Object.entries(state.perDjQueues)) {
      const idx = queue.findIndex((t) => t.entryId === nextEntryId);
      if (idx !== -1) {
        dequeued = queue[idx];
        const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
        if (remaining.length === 0) {
          delete nextPerDjQueues[djId];
        } else {
          nextPerDjQueues[djId] = remaining;
        }
        break;
      }
    }

    if (dequeued) {
      logger.debug?.("Dequeued next track", {
        lane: "fifo",
        entryId: dequeued.entryId,
        videoId: dequeued.videoId,
        addedBy: dequeued.addedBy,
      });
      return finalizeDequeuedTrack(state, dequeued, {
        perDjQueues: nextPerDjQueues,
        fifoOrder: restFifo,
      });
    }
  }

  const chosen = selectFairRrNextDj(state.perDjQueues, state.djNextRound);
  if (chosen) {
    const queue = state.perDjQueues[chosen.djId];
    const remaining = queue.slice(1);
    const nextPerDjQueues = { ...state.perDjQueues };
    if (remaining.length === 0) {
      delete nextPerDjQueues[chosen.djId];
    } else {
      nextPerDjQueues[chosen.djId] = remaining;
    }

    const nextDjNextRound = {
      ...state.djNextRound,
      [chosen.djId]: chosen.round + 1,
    };
    const nextFifoOrder = state.fifoOrder.filter(
      (id) => id !== chosen.head.entryId,
    );

    logger.debug?.("Dequeued next track", {
      lane: "fair-rr",
      entryId: chosen.head.entryId,
      videoId: chosen.head.videoId,
      addedBy: chosen.head.addedBy,
      round: chosen.round,
    });

    return finalizeDequeuedTrack(state, chosen.head, {
      perDjQueues: nextPerDjQueues,
      djNextRound: nextDjNextRound,
      currentRound: chosen.round,
      fifoOrder: nextFifoOrder,
    });
  }

  if (state.autoplayPool.length > 0) {
    const [track, ...restAutoplay] = state.autoplayPool;
    const historyVideoIds = appendHistoryVideoId(
      state.historyVideoIds,
      track.videoId,
    );
    const queuedVideoIds = collectQueuedVideoIds(state);
    logger.debug?.("Dequeued next track", {
      lane: "autoplay",
      entryId: track.entryId,
      videoId: track.videoId,
      addedBy: track.addedBy,
    });
    return {
      track,
      state: {
        ...state,
        historyVideoIds,
        autoplayPool: deduplicateAutoplayPool(
          restAutoplay,
          queuedVideoIds,
          historyVideoIds,
        ),
      },
    };
  }

  return { track: null, state };
}

export function materializeQueue(state: SchedulerState): QueueTrack[] {
  const result: QueueTrack[] = [...state.pinnedNext];

  if (state.mode === "fifo") {
    const byEntryId = new Map<string, QueueTrack>();
    for (const queue of Object.values(state.perDjQueues)) {
      for (const track of queue) {
        byEntryId.set(track.entryId, track);
      }
    }
    for (const entryId of state.fifoOrder) {
      const track = byEntryId.get(entryId);
      if (track) {
        result.push(track);
      }
    }
    return result;
  }

  const simIndices: Record<string, number> = {};
  for (const djId of Object.keys(state.perDjQueues)) {
    simIndices[djId] = 0;
  }
  const simRounds: Record<string, number> = { ...state.djNextRound };

  while (true) {
    const chosen = selectFairRrNextDj(state.perDjQueues, simRounds, simIndices);
    if (!chosen) break;
    result.push(chosen.head);
    simIndices[chosen.djId] += 1;
    simRounds[chosen.djId] = chosen.round + 1;
  }

  return result;
}

export function peekAutoplayNext(state: SchedulerState): QueueTrack | null {
  return state.autoplayPool[0] ?? null;
}

export function dismissAutoplayNext(state: SchedulerState): SchedulerState {
  if (state.autoplayPool.length === 0) return state;
  return {
    ...state,
    autoplayPool: state.autoplayPool.slice(1),
  };
}

export function removeTrack(
  state: SchedulerState,
  entryId: string,
  actorId: string,
  isAdmin: boolean,
  logger: ListenTogetherLogger = noopLogger,
  options: { forgive?: boolean } = {},
): { ok: boolean; removed: QueueTrack | null; state: SchedulerState } {
  const forgive = options.forgive !== false;
  const pinnedIdx = state.pinnedNext.findIndex((t) => t.entryId === entryId);
  if (pinnedIdx !== -1) {
    const target = state.pinnedNext[pinnedIdx];
    if (!isAdmin && target.addedBy !== actorId) {
      logger.warn?.("Rejected track removal: insufficient permissions", {
        entryId,
        actorId,
        ownerId: target.addedBy,
      });
      return { ok: false, removed: null, state };
    }
    const nextPinned = [
      ...state.pinnedNext.slice(0, pinnedIdx),
      ...state.pinnedNext.slice(pinnedIdx + 1),
    ];
    let nextLastEnqueueAtByDj = state.lastEnqueueAtByDj;
    if (forgive && actorId === target.addedBy && target.addedBy in nextLastEnqueueAtByDj) {
      nextLastEnqueueAtByDj = { ...nextLastEnqueueAtByDj };
      delete nextLastEnqueueAtByDj[target.addedBy];
    }
    logger.debug?.("Removed pinned track from queue", {
      entryId,
      actorId,
      isAdmin,
      videoId: target.videoId,
    });
    return {
      ok: true,
      removed: target,
      state: {
        ...state,
        pinnedNext: nextPinned,
        lastEnqueueAtByDj: nextLastEnqueueAtByDj,
      },
    };
  }

  for (const [djId, queue] of Object.entries(state.perDjQueues)) {
    const idx = queue.findIndex((t) => t.entryId === entryId);
    if (idx !== -1) {
      const target = queue[idx];
      if (!isAdmin && target.addedBy !== actorId) {
        logger.warn?.("Rejected track removal: insufficient permissions", {
          entryId,
          actorId,
          ownerId: target.addedBy,
        });
        return { ok: false, removed: null, state };
      }
      const nextPerDjQueues = { ...state.perDjQueues };
      const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
      if (remaining.length === 0) {
        delete nextPerDjQueues[djId];
      } else {
        nextPerDjQueues[djId] = remaining;
      }
      let nextLastEnqueueAtByDj = state.lastEnqueueAtByDj;
      let nextDjNextRound = state.djNextRound;
      if (forgive) {
        if ((actorId === djId || remaining.length === 0) && djId in nextLastEnqueueAtByDj) {
          nextLastEnqueueAtByDj = { ...nextLastEnqueueAtByDj };
          delete nextLastEnqueueAtByDj[djId];
        }
        if (
          remaining.length === 0 &&
          (nextDjNextRound[djId] ?? state.currentRound) > state.currentRound
        ) {
          nextDjNextRound = {
            ...nextDjNextRound,
            [djId]: state.currentRound,
          };
        }
      }
      logger.debug?.("Removed DJ track from queue", {
        entryId,
        actorId,
        isAdmin,
        videoId: target.videoId,
      });
      return {
        ok: true,
        removed: target,
        state: {
          ...state,
          perDjQueues: nextPerDjQueues,
          djNextRound: nextDjNextRound,
          lastEnqueueAtByDj: nextLastEnqueueAtByDj,
          fifoOrder: state.fifoOrder.filter((id) => id !== entryId),
        },
      };
    }
  }

  return { ok: false, removed: null, state };
}

export function pinTrackNext(
  state: SchedulerState,
  entryId: string,
  logger: ListenTogetherLogger = noopLogger,
): { ok: boolean; state: SchedulerState } {
  const pinnedIdx = state.pinnedNext.findIndex((t) => t.entryId === entryId);
  if (pinnedIdx !== -1) {
    if (pinnedIdx === 0) {
      return { ok: true, state };
    }
    const target = state.pinnedNext[pinnedIdx];
    logger.debug?.("Reordered pinned track to front", {
      entryId,
      videoId: target.videoId,
    });
    return {
      ok: true,
      state: {
        ...state,
        pinnedNext: [
          target,
          ...state.pinnedNext.slice(0, pinnedIdx),
          ...state.pinnedNext.slice(pinnedIdx + 1),
        ],
      },
    };
  }

  for (const [djId, queue] of Object.entries(state.perDjQueues)) {
    const idx = queue.findIndex((t) => t.entryId === entryId);
    if (idx !== -1) {
      const target: QueueTrack = { ...queue[idx], pinned: true };
      const nextPerDjQueues = { ...state.perDjQueues };
      const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
      if (remaining.length === 0) {
        delete nextPerDjQueues[djId];
      } else {
        nextPerDjQueues[djId] = remaining;
      }
      logger.debug?.("Pinned DJ track next", {
        entryId,
        videoId: target.videoId,
      });
      return {
        ok: true,
        state: {
          ...state,
          pinnedNext: [target, ...state.pinnedNext],
          perDjQueues: nextPerDjQueues,
          fifoOrder: state.fifoOrder.filter((id) => id !== entryId),
        },
      };
    }
  }

  return { ok: false, state };
}

export function unpinTrack(
  state: SchedulerState,
  entryId: string,
  logger: ListenTogetherLogger = noopLogger,
): { ok: boolean; state: SchedulerState } {
  const pinnedIdx = state.pinnedNext.findIndex((t) => t.entryId === entryId);
  if (pinnedIdx === -1) {
    return { ok: false, state };
  }

  const target = state.pinnedNext[pinnedIdx];
  const nextPinned = [
    ...state.pinnedNext.slice(0, pinnedIdx),
    ...state.pinnedNext.slice(pinnedIdx + 1),
  ];
  const restored: QueueTrack = { ...target, pinned: false };

  const existingDjQueue = state.perDjQueues[restored.addedBy] ?? [];
  const nextDjQueue = [...existingDjQueue, restored].sort((a, b) => {
    if (a.addedAtMs !== b.addedAtMs) {
      return a.addedAtMs - b.addedAtMs;
    }
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  });

  const nextPerDjQueues = {
    ...state.perDjQueues,
    [restored.addedBy]: nextDjQueue,
  };

  const trackByEntryId = new Map<string, QueueTrack>();
  for (const queue of Object.values(nextPerDjQueues)) {
    for (const track of queue) {
      trackByEntryId.set(track.entryId, track);
    }
  }

  const nextFifoOrder = state.fifoOrder.filter((id) => id !== restored.entryId);
  let insertIdx = nextFifoOrder.length;
  for (let i = 0; i < nextFifoOrder.length; i++) {
    const existing = trackByEntryId.get(nextFifoOrder[i]);
    if (
      existing &&
      (restored.addedAtMs < existing.addedAtMs ||
        (restored.addedAtMs === existing.addedAtMs &&
          restored.entryId < existing.entryId))
    ) {
      insertIdx = i;
      break;
    }
  }
  nextFifoOrder.splice(insertIdx, 0, restored.entryId);

  logger.debug?.("Unpinned track back to DJ queue", {
    entryId,
    videoId: restored.videoId,
    addedBy: restored.addedBy,
  });

  return {
    ok: true,
    state: {
      ...state,
      pinnedNext: nextPinned,
      perDjQueues: nextPerDjQueues,
      fifoOrder: nextFifoOrder,
    },
  };
}

function moveArrayItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function syncDjQueueOrderFromFifo(
  perDjQueues: Record<string, QueueTrack[]>,
  fifoOrder: readonly string[],
  djId: string,
): Record<string, QueueTrack[]> {
  const queue = perDjQueues[djId];
  if (!queue || queue.length <= 1) return perDjQueues;
  const fifoRank = new Map<string, number>();
  fifoOrder.forEach((id, idx) => fifoRank.set(id, idx));
  const sorted = [...queue].sort((a, b) => {
    const rankA = fifoRank.get(a.entryId) ?? Number.MAX_SAFE_INTEGER;
    const rankB = fifoRank.get(b.entryId) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
  return {
    ...perDjQueues,
    [djId]: sorted,
  };
}

export function reorderTrack(
  state: SchedulerState,
  entryId: string,
  targetIndex: number,
  logger: ListenTogetherLogger = noopLogger,
): { ok: boolean; state: SchedulerState } {
  const materialized = materializeQueue(state);
  const currentIndex = materialized.findIndex((t) => t.entryId === entryId);
  if (currentIndex === -1) {
    return { ok: false, state };
  }

  const clampedTarget = Math.max(
    0,
    Math.min(materialized.length - 1, Math.trunc(targetIndex)),
  );
  if (clampedTarget === currentIndex) {
    return { ok: true, state };
  }

  const pinnedLen = state.pinnedNext.length;
  const movedTrack = materialized[currentIndex];

  if (state.mode === "fifo") {
    if (currentIndex < pinnedLen && clampedTarget < pinnedLen) {
      logger.debug?.("Reordered pinned track within pinned lane", {
        entryId,
        from: currentIndex,
        to: clampedTarget,
      });
      return {
        ok: true,
        state: {
          ...state,
          pinnedNext: moveArrayItem(state.pinnedNext, currentIndex, clampedTarget),
        },
      };
    }

    if (currentIndex < pinnedLen && clampedTarget >= pinnedLen) {
      const unpinned = unpinTrack(state, entryId, logger);
      if (!unpinned.ok) return { ok: false, state };
      const afterPinnedLen = unpinned.state.pinnedNext.length;
      const desiredFifoIdx = Math.max(
        0,
        Math.min(
          unpinned.state.fifoOrder.length - 1,
          clampedTarget - afterPinnedLen,
        ),
      );
      const currentFifoIdx = unpinned.state.fifoOrder.indexOf(entryId);
      if (currentFifoIdx === -1) return { ok: false, state };
      const nextFifoOrder = moveArrayItem(
        unpinned.state.fifoOrder,
        currentFifoIdx,
        desiredFifoIdx,
      );
      return {
        ok: true,
        state: {
          ...unpinned.state,
          fifoOrder: nextFifoOrder,
          perDjQueues: syncDjQueueOrderFromFifo(
            unpinned.state.perDjQueues,
            nextFifoOrder,
            movedTrack.addedBy,
          ),
        },
      };
    }

    if (currentIndex >= pinnedLen && clampedTarget < pinnedLen) {
      const removed = removeTrack(state, entryId, movedTrack.addedBy, true, logger, {
        forgive: false,
      });
      if (!removed.ok || !removed.removed) return { ok: false, state };
      const pinnedCopy: QueueTrack = { ...removed.removed, pinned: true };
      const nextPinned = [...removed.state.pinnedNext];
      nextPinned.splice(clampedTarget, 0, pinnedCopy);
      return {
        ok: true,
        state: {
          ...removed.state,
          pinnedNext: nextPinned,
        },
      };
    }

    const fromFifoIdx = currentIndex - pinnedLen;
    const toFifoIdx = clampedTarget - pinnedLen;
    if (
      fromFifoIdx < 0 ||
      toFifoIdx < 0 ||
      fromFifoIdx >= state.fifoOrder.length ||
      toFifoIdx >= state.fifoOrder.length
    ) {
      return { ok: false, state };
    }
    const nextFifoOrder = moveArrayItem(state.fifoOrder, fromFifoIdx, toFifoIdx);
    logger.debug?.("Reordered FIFO queue track", {
      entryId,
      from: currentIndex,
      to: clampedTarget,
    });
    return {
      ok: true,
      state: {
        ...state,
        fifoOrder: nextFifoOrder,
        perDjQueues: syncDjQueueOrderFromFifo(
          state.perDjQueues,
          nextFifoOrder,
          movedTrack.addedBy,
        ),
      },
    };
  }

  // fair-rr mode
  if (currentIndex < pinnedLen && clampedTarget < pinnedLen) {
    logger.debug?.("Reordered pinned track within fair-rr pinned lane", {
      entryId,
      from: currentIndex,
      to: clampedTarget,
    });
    return {
      ok: true,
      state: {
        ...state,
        pinnedNext: moveArrayItem(state.pinnedNext, currentIndex, clampedTarget),
      },
    };
  }

  if (currentIndex < pinnedLen && clampedTarget >= pinnedLen) {
    const unpinned = unpinTrack(state, entryId, logger);
    return { ok: unpinned.ok, state: unpinned.state };
  }

  if (currentIndex >= pinnedLen && clampedTarget <= pinnedLen) {
    const removed = removeTrack(state, entryId, movedTrack.addedBy, true, logger, {
      forgive: false,
    });
    if (!removed.ok || !removed.removed) return { ok: false, state };
    const pinnedCopy: QueueTrack = { ...removed.removed, pinned: true };
    const nextPinned = [...removed.state.pinnedNext];
    const insertIdx = Math.max(0, Math.min(nextPinned.length, clampedTarget));
    nextPinned.splice(insertIdx, 0, pinnedCopy);
    logger.debug?.("Promoted track into pinned lane via reorder", {
      entryId,
      from: currentIndex,
      to: insertIdx,
    });
    return {
      ok: true,
      state: {
        ...removed.state,
        pinnedNext: nextPinned,
      },
    };
  }

  const targetTrack = materialized[clampedTarget];
  if (targetTrack.addedBy === movedTrack.addedBy) {
    const djQueue = state.perDjQueues[movedTrack.addedBy] ?? [];
    const fromDjIdx = djQueue.findIndex((t) => t.entryId === entryId);
    const toDjIdx = djQueue.findIndex((t) => t.entryId === targetTrack.entryId);
    if (fromDjIdx === -1 || toDjIdx === -1) return { ok: false, state };
    const nextDjQueue = moveArrayItem(djQueue, fromDjIdx, toDjIdx);
    logger.debug?.("Reordered tracks within DJ queue in fair-rr mode", {
      djId: movedTrack.addedBy,
      entryId,
      fromDjIdx,
      toDjIdx,
    });
    return {
      ok: true,
      state: {
        ...state,
        perDjQueues: {
          ...state.perDjQueues,
          [movedTrack.addedBy]: nextDjQueue,
        },
      },
    };
  }

  if (clampedTarget < currentIndex) {
    const removed = removeTrack(state, entryId, movedTrack.addedBy, true, logger, {
      forgive: false,
    });
    if (!removed.ok || !removed.removed) return { ok: false, state };
    const pinnedCopy: QueueTrack = { ...removed.removed, pinned: true };
    const nextPinned = [...removed.state.pinnedNext, pinnedCopy];
    logger.debug?.("Promoted track to pinnedNext on upward cross-DJ reorder", {
      entryId,
      from: currentIndex,
      to: clampedTarget,
    });
    return {
      ok: true,
      state: {
        ...removed.state,
        pinnedNext: nextPinned,
      },
    };
  }

  const movedDjRound = state.djNextRound[movedTrack.addedBy] ?? state.currentRound;
  const targetDjRound =
    state.djNextRound[targetTrack.addedBy] ?? state.currentRound;
  const deferredRound = Math.max(movedDjRound + 1, targetDjRound + 1);
  logger.debug?.("Deferred DJ round on downward cross-DJ reorder", {
    djId: movedTrack.addedBy,
    entryId,
    previousRound: movedDjRound,
    deferredRound,
  });
  return {
    ok: true,
    state: {
      ...state,
      djNextRound: {
        ...state.djNextRound,
        [movedTrack.addedBy]: deferredRound,
      },
    },
  };
}

export function jumpToQueuedTrack(
  state: SchedulerState,
  entryId: string,
  logger: ListenTogetherLogger = noopLogger,
): { track: QueueTrack | null; state: SchedulerState } {
  const pinnedIdx = state.pinnedNext.findIndex((t) => t.entryId === entryId);
  if (pinnedIdx !== -1) {
    const res = dequeuePinnedNextAt(state, pinnedIdx);
    logger.info?.("Host jumped to pinned queued track", {
      entryId,
      videoId: res.track.videoId,
      addedBy: res.track.addedBy,
    });
    return res;
  }

  for (const [djId, queue] of Object.entries(state.perDjQueues)) {
    const idx = queue.findIndex((t) => t.entryId === entryId);
    if (idx !== -1) {
      const target = queue[idx];
      const remaining = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
      const nextPerDjQueues = { ...state.perDjQueues };
      if (remaining.length === 0) {
        delete nextPerDjQueues[djId];
      } else {
        nextPerDjQueues[djId] = remaining;
      }

      const prevRound = state.djNextRound[djId] ?? state.currentRound;
      const nextDjNextRound = {
        ...state.djNextRound,
        [djId]: prevRound + 1,
      };
      const nextFifoOrder = state.fifoOrder.filter((id) => id !== entryId);

      logger.info?.("Host jumped to DJ queued track", {
        entryId,
        videoId: target.videoId,
        addedBy: target.addedBy,
        previousRound: prevRound,
        nextRound: nextDjNextRound[djId],
      });

      return finalizeDequeuedTrack(state, target, {
        perDjQueues: nextPerDjQueues,
        djNextRound: nextDjNextRound,
        fifoOrder: nextFifoOrder,
      });
    }
  }

  return { track: null, state };
}

export function purgePeerTracks(
  state: SchedulerState,
  peerId: string,
  logger: ListenTogetherLogger = noopLogger,
  reason: "demote-clear" | "kick" | "purge" = "purge",
): SchedulerState {
  const removedEntryIds = new Set<string>();
  const nextPerDjQueues: Record<string, QueueTrack[]> = {};

  for (const [djId, queue] of Object.entries(state.perDjQueues)) {
    const kept: QueueTrack[] = [];
    for (const track of queue) {
      if (track.addedBy === peerId) {
        removedEntryIds.add(track.entryId);
      } else {
        kept.push(track);
      }
    }
    if (kept.length > 0) {
      nextPerDjQueues[djId] = kept;
    }
  }

  const nextPinned = state.pinnedNext.filter((track) => {
    if (track.addedBy === peerId) {
      removedEntryIds.add(track.entryId);
      return false;
    }
    return true;
  });

  const nextAutoplayPool = state.autoplayPool.filter(
    (track) => track.addedBy !== peerId,
  );
  const purgedAutoplayCount =
    state.autoplayPool.length - nextAutoplayPool.length;

  logger.info?.("Purged peer tracks from scheduler", {
    peerId,
    reason,
    purgedQueueCount: removedEntryIds.size,
    purgedAutoplayCount,
  });

  return {
    ...state,
    pinnedNext: nextPinned,
    perDjQueues: nextPerDjQueues,
    fifoOrder: state.fifoOrder.filter((id) => !removedEntryIds.has(id)),
    autoplayPool: nextAutoplayPool,
  };
}

export function setAutoplayCandidates(
  state: SchedulerState,
  candidates: readonly QueueTrack[],
  logger: ListenTogetherLogger = noopLogger,
): SchedulerState {
  const validCandidates = candidates.filter((c) =>
    Value.Check(QueueTrackSchema, c),
  );
  if (validCandidates.length < candidates.length) {
    logger.warn?.("Filtered invalid autoplay candidates", {
      totalCount: candidates.length,
      validCount: validCandidates.length,
    });
  }
  const queuedVideoIds = collectQueuedVideoIds(state);
  const autoplayPool = deduplicateAutoplayPool(
    validCandidates,
    queuedVideoIds,
    state.historyVideoIds,
  );
  logger.debug?.("Updated autoplay candidate pool", {
    poolSize: autoplayPool.length,
  });
  return {
    ...state,
    autoplayPool,
  };
}

export function shouldPreemptForDjAdd(
  currentTrack: QueueTrack | null,
  preemptionInFlight: boolean,
  logger: ListenTogetherLogger = noopLogger,
): boolean {
  if (currentTrack === null || currentTrack.source !== "autoplay") {
    return false;
  }
  if (preemptionInFlight) {
    logger.debug?.(
      "Skipped autoplay preemption because preemption is already in flight",
      {
        currentEntryId: currentTrack.entryId,
        currentVideoId: currentTrack.videoId,
      },
    );
    return false;
  }
  logger.info?.("Triggered autoplay preemption for DJ track add", {
    preemptedEntryId: currentTrack.entryId,
    preemptedVideoId: currentTrack.videoId,
  });
  return true;
}

export function setSchedulerMode(
  state: SchedulerState,
  mode: QueueMode,
  logger: ListenTogetherLogger = noopLogger,
): SchedulerState {
  if (state.mode !== mode) {
    logger.info?.("Changed scheduler queue mode", {
      previousMode: state.mode,
      nextMode: mode,
    });
  }
  return {
    ...state,
    mode,
  };
}
