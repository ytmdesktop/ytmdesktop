import { describe, expect, it } from "vitest";
import type { ListenTogetherLogger } from "../logger";
import type { QueueTrack } from "../protocol";
import {
  createSchedulerState,
  dequeueNextTrack,
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
} from "../scheduler";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

function createSpyLogger(): {
  logger: Required<ListenTogetherLogger>;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  return {
    entries,
    logger: {
      debug: (message, context) =>
        entries.push({ level: "debug", message, context }),
      info: (message, context) =>
        entries.push({ level: "info", message, context }),
      warn: (message, context) =>
        entries.push({ level: "warn", message, context }),
      error: (message, context) =>
        entries.push({ level: "error", message, context }),
    },
  };
}

function makeVideoId(index: number): string {
  return `vid_${String(index).padStart(7, "0")}`;
}

function makeTrack(
  index: number,
  overrides: Partial<QueueTrack> = {},
): QueueTrack {
  return {
    entryId: `entry-${index}`,
    videoId: makeVideoId(index),
    title: `Track ${index}`,
    author: `Artist ${index}`,
    durationSec: 180,
    thumbnailUrl: null,
    addedBy: "dj-a",
    addedByName: "DJ A",
    addedAtMs: index * 1000,
    source: "dj",
    pinned: false,
    ...overrides,
  };
}

describe("scheduler: fair-rr starvation prevention & ordering", () => {
  it("prevents bulk-add starvation: DJ A adds 30 songs, first plays, DJ B adds 1 -> DJ B plays immediately next", () => {
    let state = createSchedulerState("fair-rr");

    for (let i = 1; i <= 30; i++) {
      const res = enqueueDjTrack(
        state,
        "dj-a",
        makeTrack(i, { addedBy: "dj-a", addedByName: "DJ A", addedAtMs: i }),
        "admin",
        "off",
        i * 100,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    const firstPlay = dequeueNextTrack(state);
    expect(firstPlay.track?.entryId).toBe("entry-1");
    state = firstPlay.state;

    const addB = enqueueDjTrack(
      state,
      "dj-b",
      makeTrack(101, {
        entryId: "entry-b1",
        addedBy: "dj-b",
        addedByName: "DJ B",
        addedAtMs: 5000,
      }),
      "dj",
      "off",
      5000,
    );
    expect(addB.ok).toBe(true);
    if (addB.ok) state = addB.state;

    expect(materializeQueue(state)[0]?.entryId).toBe("entry-b1");

    const secondPlay = dequeueNextTrack(state);
    expect(secondPlay.track?.entryId).toBe("entry-b1");
    expect(secondPlay.track?.addedBy).toBe("dj-b");
    state = secondPlay.state;

    const thirdPlay = dequeueNextTrack(state);
    expect(thirdPlay.track?.entryId).toBe("entry-2");
    expect(thirdPlay.track?.addedBy).toBe("dj-a");
  });

  it("does not grant catch-up bursts to a late-joining DJ", () => {
    let state = createSchedulerState("fair-rr");

    for (let i = 1; i <= 6; i++) {
      const res = enqueueDjTrack(
        state,
        "dj-a",
        makeTrack(i, { addedBy: "dj-a", addedAtMs: i * 10 }),
        "dj",
        "off",
        i * 2000,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    // Play 4 tracks from DJ A (rounds 0..3 -> djNextRound["dj-a"] = 4, currentRound = 3)
    for (let i = 0; i < 4; i++) {
      const next = dequeueNextTrack(state);
      state = next.state;
    }

    // Late DJ B adds 2 tracks while DJ A has tracks remaining
    for (let i = 1; i <= 2; i++) {
      const res = enqueueDjTrack(
        state,
        "dj-b",
        makeTrack(50 + i, {
          entryId: `b-${i}`,
          addedBy: "dj-b",
          addedAtMs: 10000 + i * 10,
        }),
        "dj",
        "off",
        10000 + i * 2000,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    // DJ B plays 1 immediately (round 3 < DJ A's round 4), then alternates with DJ A
    const order: string[] = [];
    while (true) {
      const next = dequeueNextTrack(state);
      if (!next.track) break;
      order.push(next.track.entryId);
      state = next.state;
    }
    expect(order).toEqual(["b-1", "entry-5", "b-2", "entry-6"]);
  });

  it("breaks fair-rr ties deterministically by addedAtMs then entryId", () => {
    let state = createSchedulerState("fair-rr");

    const addB = enqueueDjTrack(
      state,
      "dj-b",
      makeTrack(1, { entryId: "entry-z", addedBy: "dj-b", addedAtMs: 100 }),
      "dj",
      "off",
      100,
    );
    if (addB.ok) state = addB.state;

    const addA = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2, { entryId: "entry-a", addedBy: "dj-a", addedAtMs: 100 }),
      "dj",
      "off",
      200,
    );
    if (addA.ok) state = addA.state;

    const first = dequeueNextTrack(state);
    expect(first.track?.entryId).toBe("entry-a");
    const second = dequeueNextTrack(first.state);
    expect(second.track?.entryId).toBe("entry-z");
  });
});

describe("scheduler: fifo, pinnedNext, removal, and demote vs purge", () => {
  it("preserves exact insertion order in fifo mode and supports dynamic mode switching", () => {
    let state = createSchedulerState("fifo");
    const { logger, entries } = createSpyLogger();

    const adds = [
      { dj: "dj-a", id: "a1", idx: 1, t: 1000 },
      { dj: "dj-a", id: "a2", idx: 2, t: 2500 },
      { dj: "dj-b", id: "b1", idx: 3, t: 3000 },
      { dj: "dj-a", id: "a3", idx: 4, t: 4000 },
    ];
    for (const item of adds) {
      const res = enqueueDjTrack(
        state,
        item.dj,
        makeTrack(item.idx, { entryId: item.id, addedAtMs: item.t }),
        "dj",
        "off",
        item.t,
        logger,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    expect(materializeQueue(state).map((t) => t.entryId)).toEqual([
      "a1",
      "a2",
      "b1",
      "a3",
    ]);

    const d1 = dequeueNextTrack(state, logger);
    expect(d1.track?.entryId).toBe("a1");
    const d2 = dequeueNextTrack(d1.state, logger);
    expect(d2.track?.entryId).toBe("a2");

    // Switch remaining queue (b1, a3) to fair-rr
    const switched = setSchedulerMode(d2.state, "fair-rr", logger);
    expect(
      entries.some((e) => e.message === "Changed scheduler queue mode"),
    ).toBe(true);
    expect(materializeQueue(switched).map((t) => t.entryId)).toEqual([
      "b1",
      "a3",
    ]);
  });

  it("prioritizes pinnedNext ahead of both fair-rr and fifo queues", () => {
    let state = createSchedulerState("fifo");

    for (const [idx, dj] of [
      [1, "dj-a"],
      [2, "dj-b"],
      [3, "dj-a"],
    ] as const) {
      const res = enqueueDjTrack(
        state,
        dj,
        makeTrack(idx, { addedBy: dj, addedAtMs: idx * 1000 }),
        "dj",
        "off",
        idx * 1000,
      );
      if (res.ok) state = res.state;
    }

    const pin3 = pinTrackNext(state, "entry-3");
    expect(pin3.ok).toBe(true);
    state = pin3.state;

    const pin2 = pinTrackNext(state, "entry-2");
    expect(pin2.ok).toBe(true);
    state = pin2.state;

    // Re-pinning entry-3 moves it to front of pinnedNext
    const repin3 = pinTrackNext(state, "entry-3");
    expect(repin3.ok).toBe(true);
    state = repin3.state;

    expect(materializeQueue(state).map((t) => t.entryId)).toEqual([
      "entry-3",
      "entry-2",
      "entry-1",
    ]);
    expect(dequeueNextTrack(state).track?.entryId).toBe("entry-3");
  });

  it("enforces removeTrack ownership and admin override", () => {
    let state = createSchedulerState("fair-rr");
    const addA = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(1, { addedBy: "dj-a" }),
      "dj",
      "off",
      1000,
    );
    if (addA.ok) state = addA.state;

    const addB = enqueueDjTrack(
      state,
      "dj-b",
      makeTrack(2, { addedBy: "dj-b" }),
      "dj",
      "off",
      1000,
    );
    if (addB.ok) state = addB.state;

    // Non-owner DJ cannot remove DJ A's track
    const denied = removeTrack(state, "entry-1", "dj-b", false);
    expect(denied.ok).toBe(false);
    expect(denied.removed).toBeNull();

    // Admin can remove any track
    const adminRemoved = removeTrack(state, "entry-1", "host", true);
    expect(adminRemoved.ok).toBe(true);
    expect(adminRemoved.removed?.entryId).toBe("entry-1");

    // Owner DJ can remove own track
    const ownerRemoved = removeTrack(
      adminRemoved.state,
      "entry-2",
      "dj-b",
      false,
    );
    expect(ownerRemoved.ok).toBe(true);
    expect(materializeQueue(ownerRemoved.state)).toHaveLength(0);
  });

  it("keeps existing tracks on plain demote while purging tracks on demote-clear / kick", () => {
    let state = createSchedulerState("fair-rr");
    const r1 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(1, { addedBy: "dj-a" }),
      "dj",
      "off",
      1000,
    );
    if (r1.ok) state = r1.state;
    const r2 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2, { addedBy: "dj-a" }),
      "dj",
      "off",
      2500,
    );
    if (r2.ok) state = r2.state;
    const r3 = enqueueDjTrack(
      state,
      "dj-b",
      makeTrack(3, { addedBy: "dj-b" }),
      "dj",
      "off",
      3000,
    );
    if (r3.ok) state = r3.state;
    state = pinTrackNext(state, "entry-2").state;
    state = setAutoplayCandidates(state, [
      makeTrack(99, { addedBy: "dj-a", source: "autoplay" }),
      makeTrack(100, { addedBy: "dj-b", source: "autoplay" }),
    ]);

    // Plain demote keeps already-queued tracks, but blocks future adds with NOT_DJ
    expect(materializeQueue(state).map((t) => t.entryId)).toEqual([
      "entry-2",
      "entry-1",
      "entry-3",
    ]);
    const blockedAfterDemote = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(4, { addedBy: "dj-a" }),
      "listener",
      "off",
      5000,
    );
    expect(blockedAfterDemote).toEqual({ ok: false, reason: "NOT_DJ" });

    // demote-clear / kick purges all tracks owned by dj-a across pinned, queue, and autoplayPool
    const purged = purgePeerTracks(state, "dj-a", undefined, "demote-clear");
    expect(materializeQueue(purged).map((t) => t.entryId)).toEqual(["entry-3"]);
    expect(peekAutoplayNext(purged)?.entryId).toBe("entry-100");
  });
});

describe("scheduler: rate limit presets & validation", () => {
  it("enforces off preset: 1000 ms debounce and 25 max queued per DJ", () => {
    let state = createSchedulerState("fair-rr");

    const first = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(1),
      "dj",
      "off",
      10_000,
    );
    expect(first.ok).toBe(true);
    if (first.ok) state = first.state;

    // 999 ms elapsed -> rejected with retryAfterMs = 1
    const tooFast = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2),
      "dj",
      "off",
      10_999,
    );
    expect(tooFast).toEqual({
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterMs: 1,
    });

    // Exact 1000 ms elapsed -> accepted
    const atBoundary = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2),
      "dj",
      "off",
      11_000,
    );
    expect(atBoundary.ok).toBe(true);
    if (atBoundary.ok) state = atBoundary.state;

    // Fill remaining up to 25
    for (let i = 3; i <= 25; i++) {
      const res = enqueueDjTrack(
        state,
        "dj-a",
        makeTrack(i),
        "dj",
        "off",
        11_000 + i * 1_000,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    const overflow = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(26),
      "dj",
      "off",
      100_000,
    );
    expect(overflow).toEqual({ ok: false, reason: "MAX_QUEUE_REACHED" });
  });

  it("enforces strict preset: 3 max queued (including pinned) and 30_000 ms cooldown", () => {
    let state = createSchedulerState("fair-rr");

    const t1 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(1),
      "dj",
      "strict",
      1_000,
    );
    expect(t1.ok).toBe(true);
    if (t1.ok) state = t1.state;

    const tooSoon = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2),
      "dj",
      "strict",
      30_999,
    );
    expect(tooSoon).toEqual({
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterMs: 1,
    });

    const t2 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2),
      "dj",
      "strict",
      31_000,
    );
    expect(t2.ok).toBe(true);
    if (t2.ok) state = t2.state;

    // Pin t2 to verify pinnedNext counts toward max queued per DJ
    state = pinTrackNext(state, "entry-2").state;

    const t3 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(3),
      "dj",
      "strict",
      61_000,
    );
    expect(t3.ok).toBe(true);
    if (t3.ok) state = t3.state;

    const t4 = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(4),
      "dj",
      "strict",
      100_000,
    );
    expect(t4).toEqual({ ok: false, reason: "MAX_QUEUE_REACHED" });
  });

  it("exempts admin from rate limits and max queue caps", () => {
    let state = createSchedulerState("fair-rr");

    for (let i = 1; i <= 30; i++) {
      const res = enqueueDjTrack(
        state,
        "host",
        makeTrack(i, { addedBy: "host" }),
        "admin",
        "strict",
        0,
      );
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }

    expect(materializeQueue(state)).toHaveLength(30);
  });

  it("rejects invalid tracks and duplicate entryIds", () => {
    let state = createSchedulerState("fair-rr");
    const r1 = enqueueDjTrack(state, "dj-a", makeTrack(1), "dj", "off", 1000);
    if (r1.ok) state = r1.state;

    const dup = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(2, { entryId: "entry-1" }),
      "dj",
      "off",
      5000,
    );
    expect(dup).toEqual({ ok: false, reason: "INVALID_TRACK" });

    const badVideo = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(3, { videoId: "bad" }),
      "dj",
      "off",
      5000,
    );
    expect(badVideo).toEqual({ ok: false, reason: "INVALID_TRACK" });
  });
});

describe("scheduler: autoplay priority, preemption, and deduplication", () => {
  it("plays autoplay only when pinned and DJ queues are empty", () => {
    let state = createSchedulerState("fair-rr");
    state = setAutoplayCandidates(state, [
      makeTrack(90, { source: "autoplay" }),
      makeTrack(91, { source: "autoplay" }),
    ]);

    const addDj = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(1),
      "dj",
      "off",
      1000,
    );
    if (addDj.ok) state = addDj.state;

    const first = dequeueNextTrack(state);
    expect(first.track?.entryId).toBe("entry-1");
    expect(first.track?.source).toBe("dj");

    const second = dequeueNextTrack(first.state);
    expect(second.track?.entryId).toBe("entry-90");
    expect(second.track?.source).toBe("autoplay");
  });

  it("triggers preemption on DJ add during autoplay and guards burst adds with preemptionInFlight", () => {
    const { logger, entries } = createSpyLogger();
    const autoplayTrack = makeTrack(90, { source: "autoplay" });
    const djTrack = makeTrack(1, { source: "dj" });

    expect(shouldPreemptForDjAdd(null, false, logger)).toBe(false);
    expect(shouldPreemptForDjAdd(djTrack, false, logger)).toBe(false);
    expect(shouldPreemptForDjAdd(autoplayTrack, false, logger)).toBe(true);
    expect(shouldPreemptForDjAdd(autoplayTrack, true, logger)).toBe(false);

    expect(
      entries.some(
        (e) =>
          e.level === "info" &&
          e.message === "Triggered autoplay preemption for DJ track add",
      ),
    ).toBe(true);
    expect(
      entries.some(
        (e) =>
          e.level === "debug" &&
          e.message ===
            "Skipped autoplay preemption because preemption is already in flight",
      ),
    ).toBe(true);
  });

  it("deduplicates autoplay pool against queued tracks, batch duplicates, and last 20 history items", () => {
    let state = createSchedulerState("fair-rr");
    const { logger, entries } = createSpyLogger();

    // Record 20 history tracks (indices 1..20)
    for (let i = 1; i <= 20; i++) {
      state = recordHistoryVideoId(state, makeVideoId(i));
    }

    // Queue track 21
    const q21 = enqueueDjTrack(state, "dj-a", makeTrack(21), "dj", "off", 1000);
    if (q21.ok) state = q21.state;

    // Candidate 1 (in 20-item history), 20 (in history), 21 (queued), 22 (valid), 22 dup, invalid candidate, 23 (valid)
    state = setAutoplayCandidates(
      state,
      [
        makeTrack(1, { entryId: "ap-1" }),
        makeTrack(20, { entryId: "ap-20" }),
        makeTrack(21, { entryId: "ap-21" }),
        makeTrack(22, { entryId: "ap-22" }),
        makeTrack(22, { entryId: "ap-22-dup" }),
        makeTrack(999, { entryId: "ap-bad", videoId: "invalid" }),
        makeTrack(23, { entryId: "ap-23" }),
      ],
      logger,
    );

    expect(state.autoplayPool.map((t) => t.entryId)).toEqual([
      "ap-22",
      "ap-23",
    ]);
    expect(
      entries.some((e) => e.message === "Filtered invalid autoplay candidates"),
    ).toBe(true);

    // Adding track 24 into history pushes track 1 out of the 20-item history window
    state = recordHistoryVideoId(state, makeVideoId(24));
    state = setAutoplayCandidates(state, [
      makeTrack(1, { entryId: "ap-1-reeligible" }),
      makeTrack(2, { entryId: "ap-2-still-blocked" }),
    ]);

    expect(state.autoplayPool.map((t) => t.entryId)).toEqual([
      "ap-1-reeligible",
    ]);
  });

  it("unpinTrack restores a pinned track back to its DJ queue position in fair-rr and fifo", () => {
    for (const mode of ["fair-rr", "fifo"] as const) {
      let state = createSchedulerState(mode);
      for (const [idx, dj] of [
        [1, "dj-a"],
        [2, "dj-b"],
        [3, "dj-a"],
      ] as const) {
        const res = enqueueDjTrack(
          state,
          dj,
          makeTrack(idx, { addedBy: dj, addedAtMs: idx * 1000 }),
          "dj",
          "off",
          idx * 1000,
        );
        if (res.ok) state = res.state;
      }

      state = pinTrackNext(state, "entry-3").state;
      expect(materializeQueue(state).map((t) => t.entryId)).toEqual([
        "entry-3",
        "entry-1",
        "entry-2",
      ]);
      expect(materializeQueue(state)[0].pinned).toBe(true);

      const unpin = unpinTrack(state, "entry-3");
      expect(unpin.ok).toBe(true);
      state = unpin.state;

      expect(materializeQueue(state).map((t) => t.entryId)).toEqual([
        "entry-1",
        "entry-2",
        "entry-3",
      ]);
      expect(materializeQueue(state).every((t) => !t.pinned)).toBe(true);

      expect(unpinTrack(state, "missing").ok).toBe(false);
    }
  });
});

describe("scheduler: host reorderTrack and jumpToQueuedTrack", () => {
  function build(mode: "fair-rr" | "fifo", specs: [number, string][]) {
    let state = createSchedulerState(mode);
    for (const [idx, dj] of specs) {
      const res = enqueueDjTrack(
        state,
        dj,
        makeTrack(idx, { addedBy: dj, addedAtMs: idx * 1000 }),
        "dj",
        "off",
        idx * 1000,
      );
      if (res.ok) state = res.state;
    }
    return state;
  }
  const ids = (s: ReturnType<typeof build>) =>
    materializeQueue(s).map((t) => t.entryId);

  it("fifo: reorders unpinned tracks and pins/unpins by dragging across the pinned boundary", () => {
    let state = build("fifo", [
      [1, "dj-a"],
      [2, "dj-b"],
      [3, "dj-a"],
      [4, "dj-b"],
    ]);
    state = reorderTrack(state, "entry-4", 0).state;
    expect(ids(state)).toEqual(["entry-4", "entry-1", "entry-2", "entry-3"]);

    state = reorderTrack(state, "entry-3", 1).state;
    expect(ids(state)).toEqual(["entry-4", "entry-3", "entry-1", "entry-2"]);

    // Pin one track, then drag another into the pinned zone (index 0) and back out
    state = pinTrackNext(state, "entry-1").state;
    expect(ids(state)[0]).toBe("entry-1");
    state = reorderTrack(state, "entry-2", 0).state;
    expect(state.pinnedNext.map((t) => t.entryId)).toEqual([
      "entry-2",
      "entry-1",
    ]);
    state = reorderTrack(state, "entry-2", 3).state;
    expect(state.pinnedNext.map((t) => t.entryId)).toEqual(["entry-1"]);
    expect(ids(state)).toContain("entry-2");
    expect(materializeQueue(state)).toHaveLength(4);

    expect(reorderTrack(state, "missing", 0).ok).toBe(false);
  });

  it("fair-rr: same-DJ reorder keeps other DJ turns; upward cross-DJ move pins; downward defers round", () => {
    let state = build("fair-rr", [
      [1, "dj-a"],
      [2, "dj-a"],
      [4, "dj-a"],
      [3, "dj-b"],
    ]);
    expect(ids(state)).toEqual(["entry-1", "entry-3", "entry-2", "entry-4"]);

    const same = reorderTrack(state, "entry-4", 2);
    expect(same.ok).toBe(true);
    expect(ids(same.state)).toEqual(["entry-1", "entry-3", "entry-4", "entry-2"]);
    expect(same.state.pinnedNext).toEqual([]);

    const up = reorderTrack(state, "entry-3", 0);
    expect(ids(up.state)[0]).toBe("entry-3");
    expect(up.state.pinnedNext.map((t) => t.entryId)).toEqual(["entry-3"]);
    expect(ids(up.state)).toHaveLength(4);

    const down = reorderTrack(state, "entry-1", 1);
    expect(down.ok).toBe(true);
    expect(materializeQueue(down.state)).toHaveLength(4);
    expect(ids(down.state)[0]).toBe("entry-3");
  });

  it("jumpToQueuedTrack removes only the target, keeps other DJs' tracks, advances jumped DJ round", () => {
    const state = build("fair-rr", [
      [1, "dj-a"],
      [2, "dj-b"],
      [3, "dj-a"],
    ]);
    const res = jumpToQueuedTrack(state, "entry-2");
    expect(res.track?.entryId).toBe("entry-2");
    expect(ids(res.state)).toEqual(["entry-1", "entry-3"]);
    expect(res.state.djNextRound["dj-b"]).toBe(
      (state.djNextRound["dj-b"] ?? state.currentRound) + 1,
    );

    const pinned = pinTrackNext(state, "entry-3").state;
    const pj = jumpToQueuedTrack(pinned, "entry-3");
    expect(pj.track?.entryId).toBe("entry-3");
    expect(pj.state.pinnedNext).toEqual([]);

    expect(jumpToQueuedTrack(state, "nope").track).toBeNull();
  });

  it("removeTrack grants cooldown and deferred-round forgiveness without forgiving reorder pins", () => {
    let state = createSchedulerState("fair-rr");
    const r1 = enqueueDjTrack(state, "dj-a", makeTrack(1, { addedBy: "dj-a" }), "dj", "strict", 100);
    if (!r1.ok) throw new Error("expected enqueue 1 ok");
    state = r1.state;
    const r2 = enqueueDjTrack(state, "dj-b", makeTrack(2, { addedBy: "dj-b" }), "dj", "strict", 200);
    if (!r2.ok) throw new Error("expected enqueue 2 ok");
    state = r2.state;

    // Defer dj-a downward via cross-DJ reorder, then remove entry-1 -> forgives round & strict cooldown
    state = reorderTrack(state, "entry-1", 1).state;
    expect(state.djNextRound["dj-a"]).toBeGreaterThan(state.currentRound);

    const removed = removeTrack(state, "entry-1", "dj-a", false);
    expect(removed.ok).toBe(true);
    state = removed.state;
    expect(state.djNextRound["dj-a"]).toBe(state.currentRound);
    expect(state.lastEnqueueAtByDj["dj-a"]).toBeUndefined();

    const replacement = enqueueDjTrack(
      state,
      "dj-a",
      makeTrack(3, { addedBy: "dj-a" }),
      "dj",
      "strict",
      250,
    );
    expect(replacement.ok).toBe(true);
  });

  it("materializeQueue handles large 500-track fair-rr queues accurately", () => {
    let state = createSchedulerState("fair-rr");
    for (let i = 0; i < 500; i++) {
      const djId = `dj-${i % 10}`;
      const res = enqueueDjTrack(
        state,
        djId,
        makeTrack(i, { addedBy: djId }),
        "admin",
        "off",
        i,
      );
      if (!res.ok) throw new Error(`expected enqueue ${i} ok`);
      state = res.state;
    }
    const materialized = materializeQueue(state);
    expect(materialized).toHaveLength(500);
    const firstRoundDjs = new Set(materialized.slice(0, 10).map((t) => t.addedBy));
    expect(firstRoundDjs.size).toBe(10);
  });
});
