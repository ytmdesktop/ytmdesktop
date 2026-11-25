import { describe, expect, it } from "vitest";
import type { ListenTogetherLogger } from "../logger";
import type { QueueTrack, Role, RoomSettings } from "../protocol";
import {
  AD_STUCK_TIMEOUT_MS,
  LOADING_BARRIER_TIMEOUT_MS,
  PLAYBACK_START_LEAD_MS,
  createRoomState,
  projectLivePosSec,
  reduceRoomEvent,
  type RoomEffect,
  type RoomEvent,
  type RoomState,
} from "../room-fsm";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

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
    durationSec: 200,
    thumbnailUrl: null,
    addedBy: "host",
    addedByName: "Host",
    addedAtMs: index * 1_000,
    source: "dj",
    pinned: false,
    ...overrides,
  };
}

class MultiPeerRoomSim {
  state: RoomState;
  nowMs: number;
  allEffects: RoomEffect[] = [];
  lastEffects: RoomEffect[] = [];
  logs: LogEntry[] = [];
  readonly logger: Required<ListenTogetherLogger>;

  constructor(options?: {
    settings?: Partial<RoomSettings>;
    initialQueue?: QueueTrack[];
    nowMs?: number;
  }) {
    this.nowMs = options?.nowMs ?? 1_000;
    this.logger = {
      debug: (message, context) =>
        this.logs.push({ level: "debug", message, context }),
      info: (message, context) =>
        this.logs.push({ level: "info", message, context }),
      warn: (message, context) =>
        this.logs.push({ level: "warn", message, context }),
      error: (message, context) =>
        this.logs.push({ level: "error", message, context }),
    };
    this.state = createRoomState({
      roomId: "room-sim",
      hostPeerId: "host",
      hostDisplayName: "Host",
      settings: options?.settings,
      initialQueue: options?.initialQueue,
      nowMs: this.nowMs,
      logger: this.logger,
    });
  }

  dispatch(event: RoomEvent): RoomEffect[] {
    const res = reduceRoomEvent(this.state, event, this.nowMs, this.logger);
    this.state = res.state;
    this.lastEffects = res.effects;
    this.allEffects.push(...res.effects);
    return res.effects;
  }

  join(
    peerId: string,
    role: Role = "dj",
    transport: "direct" | "relay" = "direct",
  ): RoomEffect[] {
    return this.dispatch({
      type: "PEER_JOINED",
      peerId,
      displayName: peerId.toUpperCase(),
      transport,
      role,
    });
  }

  advanceTime(deltaMs: number): RoomEffect[] {
    this.nowMs += deltaMs;
    return this.dispatch({ type: "TICK" });
  }

  readyAll(peerIds: string[]): void {
    const seq = this.state.seq;
    for (const peerId of peerIds) {
      this.dispatch({ type: "TRACK_READY", peerId, seq });
    }
  }
}

describe("room-fsm: LOADING_BARRIER", () => {
  it("waits for all eligible peers and starts PLAYING with +150ms future anchor", () => {
    const sim = new MultiPeerRoomSim({ nowMs: 10_000 });
    sim.join("peer-a");
    sim.join("peer-b");

    const addEffects = sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "host",
      track: makeTrack(1),
    });

    expect(sim.state.seq).toBe(1);
    expect(sim.state.desiredPlaybackState).toBe("LOADING_BARRIER");
    expect(sim.state.members.host.status).toBe("buffering");
    expect(sim.state.members["peer-a"].status).toBe("buffering");
    expect(sim.state.members["peer-b"].status).toBe("buffering");
    expect(addEffects).toContainEqual({
      type: "SCHEDULE_TIMER",
      timer: "LOADING_BARRIER",
      seq: 1,
      delayMs: LOADING_BARRIER_TIMEOUT_MS,
    });

    // First two peers ready -> still in LOADING_BARRIER
    sim.dispatch({ type: "TRACK_READY", peerId: "host", seq: 1 });
    sim.dispatch({ type: "TRACK_READY", peerId: "peer-a", seq: 1 });
    expect(sim.state.desiredPlaybackState).toBe("LOADING_BARRIER");

    // Advance 350ms, final peer sends TRACK_READY
    sim.nowMs += 350;
    const readyEffects = sim.dispatch({
      type: "TRACK_READY",
      peerId: "peer-b",
      seq: 1,
    });

    expect(sim.state.desiredPlaybackState).toBe("PLAYING");
    expect(sim.state.anchorPosSec).toBe(0);
    expect(sim.state.anchorHostTimeMs).toBe(sim.nowMs + PLAYBACK_START_LEAD_MS);
    expect(readyEffects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "LOADING_BARRIER",
    });
    expect(readyEffects).toContainEqual(
      expect.objectContaining({
        type: "BROADCAST_SYNC_ANCHOR",
        anchor: expect.objectContaining({
          seq: 1,
          desiredState: "PLAYING",
          anchorHostTimeMs: 10_350 + 150,
        }),
      }),
    );
    expect(
      sim.logs.some(
        (l) => l.level === "info" && l.message === "LOADING_BARRIER completed",
      ),
    ).toBe(true);
  });

  it("forces PLAYING after 4000ms timeout when a peer stalls", () => {
    const sim = new MultiPeerRoomSim({ nowMs: 1_000 });
    sim.join("peer-a");
    sim.join("peer-b");

    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "host",
      track: makeTrack(1),
    });
    sim.dispatch({ type: "TRACK_READY", peerId: "host", seq: 1 });
    sim.dispatch({ type: "TRACK_READY", peerId: "peer-a", seq: 1 });

    // At 3999ms elapsed -> still waiting
    sim.advanceTime(3_999);
    expect(sim.state.desiredPlaybackState).toBe("LOADING_BARRIER");

    // At 4000ms elapsed -> barrier times out
    const timeoutEffects = sim.advanceTime(1);
    expect(sim.state.desiredPlaybackState).toBe("PLAYING");
    expect(sim.state.anchorHostTimeMs).toBe(sim.nowMs + PLAYBACK_START_LEAD_MS);
    expect(timeoutEffects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "LOADING_BARRIER",
    });
    expect(timeoutEffects).toContainEqual(
      expect.objectContaining({ type: "BROADCAST_SYNC_ANCHOR" }),
    );
    expect(
      sim.logs.some(
        (l) =>
          l.level === "warn" &&
          l.message === "LOADING_BARRIER timed out; forcing playback start" &&
          Array.isArray(l.context?.pendingPeerIds) &&
          l.context.pendingPeerIds.includes("peer-b"),
      ),
    ).toBe(true);
  });
});

describe("room-fsm: PAUSED_FOR_AD (pause-for-all)", () => {
  function startPlayingWithThreePeers() {
    const sim = new MultiPeerRoomSim({ nowMs: 10_000 });
    sim.join("peer-a");
    sim.join("peer-b");
    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "host",
      track: makeTrack(1, { durationSec: 200 }),
    });
    sim.readyAll(["host", "peer-a", "peer-b"]);
    // Move past 150ms lead + 30s playback
    sim.nowMs += PLAYBACK_START_LEAD_MS + 30_000;
    return sim;
  }

  it("handles overlapping ads across multiple peers without losing frozen anchor position", () => {
    const sim = startPlayingWithThreePeers();
    expect(projectLivePosSec(sim.state, sim.nowMs)).toBe(30);

    // Peer A starts ad at 30s
    const adAStart = sim.dispatch({
      type: "AD_STARTED",
      peerId: "peer-a",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(true);
    expect(sim.state.anchorPosSec).toBe(30);
    expect(Object.keys(sim.state.waitingOnAds)).toEqual(["peer-a"]);
    expect(sim.state.members["peer-a"].status).toBe("in-ad");
    expect(adAStart).toContainEqual({
      type: "SCHEDULE_TIMER",
      timer: "AD_STUCK",
      seq: 1,
      delayMs: AD_STUCK_TIMEOUT_MS,
      peerId: "peer-a",
    });

    // 10s later, Peer B also starts ad; anchorPosSec must remain 30s
    sim.nowMs += 10_000;
    const adBStart = sim.dispatch({
      type: "AD_STARTED",
      peerId: "peer-b",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(true);
    expect(sim.state.anchorPosSec).toBe(30);
    expect(Object.keys(sim.state.waitingOnAds)).toEqual(["peer-a", "peer-b"]);
    expect(adBStart).toContainEqual({
      type: "SCHEDULE_TIMER",
      timer: "AD_STUCK",
      seq: 1,
      delayMs: AD_STUCK_TIMEOUT_MS,
      peerId: "peer-b",
    });

    // Peer A finishes ad -> room stays paused waiting on Peer B
    sim.nowMs += 10_000;
    const adAEnd = sim.dispatch({
      type: "AD_ENDED",
      peerId: "peer-a",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(true);
    expect(Object.keys(sim.state.waitingOnAds)).toEqual(["peer-b"]);
    expect(sim.state.members["peer-a"].status).toBe("synced");
    expect(adAEnd).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-a",
    });

    // Peer B finishes ad -> room resumes with +150ms future anchor at 30s
    sim.nowMs += 15_000;
    const adBEnd = sim.dispatch({
      type: "AD_ENDED",
      peerId: "peer-b",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(sim.state.anchorPosSec).toBe(30);
    expect(sim.state.anchorHostTimeMs).toBe(sim.nowMs + PLAYBACK_START_LEAD_MS);
    expect(adBEnd).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-b",
    });
    expect(adBEnd).toContainEqual(
      expect.objectContaining({ type: "BROADCAST_SYNC_ANCHOR" }),
    );
    expect(
      sim.logs.some(
        (l) => l.level === "info" && l.message === "Resumed from PAUSED_FOR_AD",
      ),
    ).toBe(true);
  });

  it("keeps Host play/pause orthogonal to pausedForAd", () => {
    const sim = startPlayingWithThreePeers();

    sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq: 1 });
    expect(sim.state.desiredPlaybackState).toBe("PLAYING");
    expect(sim.state.pausedForAd).toBe(true);

    // Host pauses while pausedForAd is true -> PAUSED_BY_USER + pausedForAd stays true
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "pause" });
    expect(sim.state.desiredPlaybackState).toBe("PAUSED_BY_USER");
    expect(sim.state.pausedForAd).toBe(true);

    // Peer A finishes ad -> pausedForAd clears, but room stays PAUSED_BY_USER
    sim.nowMs += 5_000;
    sim.dispatch({ type: "AD_ENDED", peerId: "peer-a", seq: 1 });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.desiredPlaybackState).toBe("PAUSED_BY_USER");

    // Second scenario: Peer B enters ad while PAUSED_BY_USER, then Host presses play
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 1 });
    expect(sim.state.pausedForAd).toBe(true);
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    expect(sim.state.desiredPlaybackState).toBe("PLAYING");
    expect(sim.state.pausedForAd).toBe(true);
    // Playback remains frozen while pausedForAd is true
    sim.nowMs += 5_000;
    expect(projectLivePosSec(sim.state, sim.nowMs)).toBe(30);

    // Once Peer B finishes ad, playback resumes
    sim.dispatch({ type: "AD_ENDED", peerId: "peer-b", seq: 1 });
    expect(sim.state.pausedForAd).toBe(false);
    sim.nowMs += PLAYBACK_START_LEAD_MS + 2_000;
    expect(projectLivePosSec(sim.state, sim.nowMs)).toBe(32);
  });

  it("grants max 1 ad wait per (peerId, seq) to block griefing loops", () => {
    const sim = startPlayingWithThreePeers();

    sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq: 1 });
    expect(sim.state.pausedForAd).toBe(true);
    sim.dispatch({ type: "AD_ENDED", peerId: "peer-a", seq: 1 });
    expect(sim.state.pausedForAd).toBe(false);

    // Peer A attempts a second AD_STARTED on the same seq=1 -> ignored for pause!
    const repeatAd = sim.dispatch({
      type: "AD_STARTED",
      peerId: "peer-a",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(sim.state.members["peer-a"].status).toBe("in-ad");
    expect(
      repeatAd.some(
        (e) => e.type === "SCHEDULE_TIMER" && e.timer === "AD_STUCK",
      ),
    ).toBe(false);
  });

  it("expires stuck ads after 90_000ms and auto-demotes peer to stay-live after 3 timeouts", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 0,
      initialQueue: [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)],
    });
    sim.join("peer-a");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });

    for (let seq = 1; seq <= 3; seq++) {
      expect(sim.state.seq).toBe(seq);
      sim.readyAll(["host", "peer-a"]);
      sim.nowMs += PLAYBACK_START_LEAD_MS + 1_000;

      sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq });
      expect(sim.state.pausedForAd).toBe(true);

      // 89_999 ms -> still waiting
      sim.advanceTime(AD_STUCK_TIMEOUT_MS - 1);
      expect(sim.state.pausedForAd).toBe(true);

      // 90_000 ms -> times out
      const timeoutEffects = sim.advanceTime(1);
      expect(sim.state.pausedForAd).toBe(false);
      expect(sim.state.waitingOnAds).toEqual({});
      expect(sim.state.adTimeoutCounts["peer-a"]).toBe(seq);
      expect(timeoutEffects).toContainEqual({
        type: "CANCEL_TIMER",
        timer: "AD_STUCK",
        peerId: "peer-a",
      });

      if (seq < 3) {
        sim.dispatch({
          type: "HOST_TRANSPORT",
          actorId: "host",
          action: "skip",
        });
      }
    }

    expect(sim.state.sessionStayLivePeers).toContain("peer-a");
    expect(
      sim.logs.some(
        (l) =>
          l.level === "warn" &&
          l.message ===
            "Auto-demoted peer to stay-live after repeated ad timeouts",
      ),
    ).toBe(true);

    // On seq=4, peer-a's AD_STARTED no longer pauses the room
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "skip" });
    expect(sim.state.seq).toBe(4);
    sim.dispatch({ type: "TRACK_READY", peerId: "host", seq: 4 });
    sim.dispatch({ type: "TRACK_READY", peerId: "peer-a", seq: 4 });
    sim.nowMs += PLAYBACK_START_LEAD_MS + 1_000;

    sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq: 4 });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(sim.state.members["peer-a"].status).toBe("in-ad");
  });

  it("supports HOST_FORCE_RESUME_FROM_AD and rejects unauthorized or stale-seq calls", () => {
    const sim = startPlayingWithThreePeers();
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq: 1 });
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 1 });

    // Non-admin ignored
    sim.dispatch({
      type: "HOST_FORCE_RESUME_FROM_AD",
      actorId: "peer-a",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(true);

    // Wrong seq ignored
    sim.dispatch({
      type: "HOST_FORCE_RESUME_FROM_AD",
      actorId: "host",
      seq: 99,
    });
    expect(sim.state.pausedForAd).toBe(true);

    // Host force resume clears all waiting peers
    const effects = sim.dispatch({
      type: "HOST_FORCE_RESUME_FROM_AD",
      actorId: "host",
      seq: 1,
    });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(effects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-a",
    });
    expect(effects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-b",
    });
    expect(effects).toContainEqual(
      expect.objectContaining({ type: "BROADCAST_SYNC_ANCHOR" }),
    );
    expect(
      sim.logs.some(
        (l) =>
          l.level === "info" && l.message === "Host forced resume from ad wait",
      ),
    ).toBe(true);
  });

  it("handles mid-session toggle between pause-for-all and stay-live", () => {
    const sim = startPlayingWithThreePeers();
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-a", seq: 1 });
    expect(sim.state.pausedForAd).toBe(true);

    // Toggle to stay-live -> clears active ad waits and resumes immediately
    const toStayLive = sim.dispatch({
      type: "HOST_UPDATE_SETTINGS",
      actorId: "host",
      settings: { adSyncMode: "stay-live" },
    });
    expect(sim.state.settings.adSyncMode).toBe("stay-live");
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(toStayLive).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-a",
    });
    expect(toStayLive).toContainEqual(
      expect.objectContaining({ type: "BROADCAST_SETTINGS_UPDATED" }),
    );
    expect(toStayLive).toContainEqual(
      expect.objectContaining({ type: "BROADCAST_SYNC_ANCHOR" }),
    );

    // Peer B starts ad while stay-live -> does not pause
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 1 });
    expect(sim.state.pausedForAd).toBe(false);

    // Toggle back to pause-for-all -> future AD_STARTED pauses again
    sim.dispatch({
      type: "HOST_UPDATE_SETTINGS",
      actorId: "host",
      settings: { adSyncMode: "pause-for-all" },
    });
    sim.dispatch({ type: "QUEUE_ADD", actorId: "host", track: makeTrack(2) });
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "skip" });
    sim.readyAll(["host", "peer-a", "peer-b"]);
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 2 });
    expect(sim.state.pausedForAd).toBe(true);
  });
});

describe("room-fsm: JOINING_CATCHUP, TRACK_ENDED, TRACK_UNAVAILABLE, and preemption", () => {
  it("excludes mid-song joiners (catching-up) from LOADING_BARRIER, ad pauses, and quorums until TRACK_READY", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      initialQueue: [makeTrack(1), makeTrack(2)],
    });
    sim.join("peer-a");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    sim.readyAll(["host", "peer-a"]);
    sim.nowMs += PLAYBACK_START_LEAD_MS + 15_000;

    // Peer C and Peer D join mid-song -> status catching-up + receive snapshots
    const joinEffects = sim.join("peer-c");
    sim.join("peer-d");
    expect(sim.state.members["peer-c"].status).toBe("catching-up");
    expect(sim.state.members["peer-d"].status).toBe("catching-up");
    expect(joinEffects).toContainEqual(
      expect.objectContaining({
        type: "SEND_ROOM_SNAPSHOT",
        peerId: "peer-c",
      }),
    );

    // Catching-up peer starting an ad does NOT pause the room
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-d", seq: 1 });
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});

    // Advance to track 2 while peer-c is still catching-up -> barrier only waits for host & peer-a
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "skip" });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.members["peer-c"].status).toBe("catching-up");
    sim.readyAll(["host", "peer-a"]);
    expect(sim.state.desiredPlaybackState).toBe("PLAYING");

    // Once peer-c sends TRACK_READY for seq=2, peer-c becomes synced
    sim.dispatch({ type: "TRACK_READY", peerId: "peer-c", seq: 2 });
    expect(sim.state.members["peer-c"].status).toBe("synced");
  });

  it("advances on TRACK_ENDED >= 50% non-ad quorum or duration reached", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 0,
      initialQueue: [
        makeTrack(1, { durationSec: 100 }),
        makeTrack(2, { durationSec: 50 }),
      ],
    });
    sim.join("peer-a");
    sim.join("peer-b");
    sim.join("peer-c");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    sim.readyAll(["host", "peer-a", "peer-b", "peer-c"]);
    sim.nowMs += PLAYBACK_START_LEAD_MS;

    // Put peer-c in-ad (via stay-live so room keeps playing) -> 3 active non-ad peers (threshold = 1.5)
    sim.dispatch({
      type: "HOST_UPDATE_SETTINGS",
      actorId: "host",
      settings: { adSyncMode: "stay-live" },
    });
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-c", seq: 1 });

    // 1st vote (plus duplicate from same peer) does not meet 1.5 threshold
    sim.dispatch({ type: "TRACK_ENDED", peerId: "peer-a", seq: 1 });
    sim.dispatch({ type: "TRACK_ENDED", peerId: "peer-a", seq: 1 });
    expect(sim.state.seq).toBe(1);

    // 2nd unique active vote reaches quorum -> advances to track 2
    sim.dispatch({ type: "TRACK_ENDED", peerId: "peer-b", seq: 1 });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.currentTrack?.entryId).toBe("entry-2");

    // Track 2 advances on TICK when projectedPosSec >= durationSec (50s)
    sim.readyAll(["host", "peer-a", "peer-b"]);
    sim.nowMs += PLAYBACK_START_LEAD_MS;
    sim.advanceTime(49_999);
    expect(sim.state.seq).toBe(2);
    sim.advanceTime(1);
    expect(sim.state.seq).toBe(3);
    expect(sim.state.desiredPlaybackState).toBe("IDLE");
    expect(sim.state.currentTrack).toBeNull();
  });

  it("handles TRACK_UNAVAILABLE minority vs >=50% quorum and immediate skip for host or track adder", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      initialQueue: [makeTrack(1, { addedBy: "host" })],
    });
    sim.join("peer-a");
    sim.join("peer-b");
    sim.join("peer-c");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-a",
      track: makeTrack(2, { addedBy: "peer-a" }),
    });
    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "host",
      track: makeTrack(3, { addedBy: "host" }),
    });

    // Track 1 (added by host): 4 eligible peers -> threshold = 2
    // Minority (1 peer: peer-b) -> marked unavailable, does NOT skip
    sim.dispatch({
      type: "TRACK_UNAVAILABLE",
      peerId: "peer-b",
      seq: 1,
      errorCode: 150,
    });
    expect(sim.state.seq).toBe(1);
    expect(sim.state.members["peer-b"].status).toBe("unavailable");

    // 2nd peer (peer-c) -> 2 >= 2 -> skips to Track 2
    sim.dispatch({
      type: "TRACK_UNAVAILABLE",
      peerId: "peer-c",
      seq: 1,
      errorCode: 150,
    });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.currentTrack?.entryId).toBe("entry-2");

    // Track 2 (added by peer-a): queuing DJ (peer-a) reports unavailable -> skips immediately
    sim.dispatch({
      type: "TRACK_UNAVAILABLE",
      peerId: "peer-a",
      seq: 2,
      errorCode: "UNPLAYABLE",
    });
    expect(sim.state.seq).toBe(3);

    // Track 3: Host (admin) reports unavailable -> skips immediately to IDLE
    sim.dispatch({
      type: "TRACK_UNAVAILABLE",
      peerId: "host",
      seq: 3,
      errorCode: 101,
    });
    expect(sim.state.desiredPlaybackState).toBe("IDLE");
  });

  it("clears waitingOnAds and cancels AD_STUCK timers on autoplay preemption", () => {
    const sim = new MultiPeerRoomSim({ nowMs: 1_000 });
    sim.join("peer-a");
    sim.join("peer-b");

    // Seed autoplay candidates and start playback via host skip
    sim.dispatch({
      type: "AUTOPLAY_CANDIDATES",
      actorId: "host",
      candidates: [
        makeTrack(90, { source: "autoplay" }),
        makeTrack(91, { source: "autoplay" }),
      ],
    });
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    expect(sim.state.seq).toBe(1);
    expect(sim.state.currentTrack?.source).toBe("autoplay");

    sim.readyAll(["host", "peer-a", "peer-b"]);
    sim.nowMs += PLAYBACK_START_LEAD_MS + 5_000;

    // Peer B enters ad -> room paused on seq=1 waitingOnAds["peer-b"]
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 1 });
    expect(sim.state.pausedForAd).toBe(true);
    expect(sim.state.waitingOnAds["peer-b"]).toBeDefined();

    // DJ A adds a real track -> preempts autoplay immediately and clears old seq waitingOnAds
    const preemptEffects = sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-a",
      track: makeTrack(10, { addedBy: "peer-a" }),
    });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.currentTrack?.entryId).toBe("entry-10");
    expect(sim.state.currentTrack?.source).toBe("dj");
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(sim.state.desiredPlaybackState).toBe("LOADING_BARRIER");
    expect(preemptEffects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-b",
    });

    // Burst second DJ add must NOT double-preempt the newly started DJ track
    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-a",
      track: makeTrack(11, { addedBy: "peer-a" }),
    });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.currentTrack?.entryId).toBe("entry-10");

    // Stale AD_ENDED from old seq=1 is ignored; AD_ENDED on seq=2 restores peer-b
    sim.dispatch({ type: "AD_ENDED", peerId: "peer-b", seq: 1 });
    expect(sim.state.members["peer-b"].status).toBe("in-ad");
    sim.dispatch({ type: "AD_ENDED", peerId: "peer-b", seq: 2 });
    expect(sim.state.members["peer-b"].status).toBe("buffering");
  });

  it("handles moderation actions (demote-clear, kick) and emits structured logs", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      initialQueue: [makeTrack(1, { addedBy: "host" })],
    });
    sim.join("peer-a");
    sim.join("peer-b");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    sim.readyAll(["host", "peer-a", "peer-b"]);
    sim.nowMs += PLAYBACK_START_LEAD_MS + 1_000;

    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-a",
      track: makeTrack(2, { addedBy: "peer-a" }),
    });
    sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-b",
      track: makeTrack(3, { addedBy: "peer-b" }),
    });

    // demote-clear on peer-a removes peer-a's queued track and revokes DJ role
    sim.dispatch({
      type: "HOST_MODERATION",
      actorId: "host",
      targetPeerId: "peer-a",
      action: "demote-clear",
    });
    expect(sim.state.members["peer-a"].role).toBe("listener");

    const rejectedAdd = sim.dispatch({
      type: "QUEUE_ADD",
      actorId: "peer-a",
      track: makeTrack(4, { addedBy: "peer-a" }),
    });
    expect(rejectedAdd).toContainEqual({
      type: "SEND_ACTION_REJECTED",
      peerId: "peer-a",
      reason: "NOT_DJ",
      retryAfterMs: undefined,
    });

    // peer-b enters ad, then gets kicked -> ad wait clears & DISCONNECT_PEER emitted
    sim.dispatch({ type: "AD_STARTED", peerId: "peer-b", seq: 1 });
    expect(sim.state.pausedForAd).toBe(true);

    const kickEffects = sim.dispatch({
      type: "HOST_MODERATION",
      actorId: "host",
      targetPeerId: "peer-b",
      action: "kick",
    });
    expect(sim.state.members["peer-b"]).toBeUndefined();
    expect(sim.state.pausedForAd).toBe(false);
    expect(sim.state.waitingOnAds).toEqual({});
    expect(kickEffects).toContainEqual({
      type: "DISCONNECT_PEER",
      peerId: "peer-b",
      reason: "kicked",
    });
    expect(kickEffects).toContainEqual({
      type: "CANCEL_TIMER",
      timer: "AD_STUCK",
      peerId: "peer-b",
    });

    const logMessages = sim.logs.map((l) => l.message);
    expect(logMessages).toContain("Peer joined room");
    expect(logMessages).toContain("Demoted peer and cleared queued tracks");
    expect(logMessages).toContain("Kicked peer from room");
    expect(logMessages).toContain("Entered PAUSED_FOR_AD for peer");
    expect(logMessages).toContain("Resumed from PAUSED_FOR_AD");
  });

  it("enforces admin-only QUEUE_UNPIN and broadcasts updated unpinned queue", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      initialQueue: [makeTrack(1), makeTrack(2), makeTrack(3)],
    });
    sim.join("peer-a");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });

    // Queue now has entry-2, entry-3
    sim.dispatch({ type: "QUEUE_PIN_NEXT", actorId: "host", entryId: "entry-3" });
    expect(
      sim.state.scheduler.pinnedNext.map((t) => t.entryId),
    ).toEqual(["entry-3"]);

    // Non-admin peer-a cannot unpin
    const denied = sim.dispatch({
      type: "QUEUE_UNPIN",
      actorId: "peer-a",
      entryId: "entry-3",
    });
    expect(denied).toEqual([]);
    expect(
      sim.state.scheduler.pinnedNext.map((t) => t.entryId),
    ).toEqual(["entry-3"]);

    // Host unpins entry-3 and broadcasts QUEUE_UPDATED
    const unpinnedEffects = sim.dispatch({
      type: "QUEUE_UNPIN",
      actorId: "host",
      entryId: "entry-3",
    });
    expect(sim.state.scheduler.pinnedNext).toEqual([]);
    expect(unpinnedEffects).toContainEqual(
      expect.objectContaining({
        type: "BROADCAST_QUEUE_UPDATED",
        queue: [
          expect.objectContaining({ entryId: "entry-2", pinned: false }),
          expect.objectContaining({ entryId: "entry-3", pinned: false }),
        ],
      }),
    );
  });
});

describe("room-fsm: host jump, drag reorder, history, and configurable vote skip", () => {
  it("tracks room history and lets host jump forward to upcoming songs and backward to history", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      initialQueue: [
        makeTrack(1, { addedBy: "host" }),
        makeTrack(2, { addedBy: "host" }),
        makeTrack(3, { addedBy: "host" }),
      ],
    });
    sim.join("peer-a");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    expect(sim.state.currentTrack?.entryId).toBe("entry-1");
    expect(sim.state.history).toEqual([]);

    // Non-host cannot jump tracks
    const denied = sim.dispatch({
      type: "HOST_JUMP_TRACK",
      actorId: "peer-a",
      target: "queue",
      entryId: "entry-3",
    });
    expect(denied).toEqual([]);
    expect(sim.state.currentTrack?.entryId).toBe("entry-1");

    // Host jumps forward to entry-3 -> entry-1 moves to greyed-out history, entry-2 remains in queue
    sim.dispatch({
      type: "HOST_JUMP_TRACK",
      actorId: "host",
      target: "queue",
      entryId: "entry-3",
    });
    expect(sim.state.currentTrack?.entryId).toBe("entry-3");
    expect(sim.state.history.map((t) => t.entryId)).toEqual(["entry-1"]);
    expect(sim.state.scheduler.perDjQueues["host"].map((t) => t.entryId)).toEqual([
      "entry-2",
    ]);

    // Host jumps backward to entry-1 in history -> entry-3 moves to history, entry-1 plays again
    sim.dispatch({
      type: "HOST_JUMP_TRACK",
      actorId: "host",
      target: "history",
      entryId: "entry-1",
    });
    expect(sim.state.currentTrack?.entryId).toBe("entry-1");
    expect(sim.state.history.map((t) => t.entryId)).toEqual(["entry-3"]);
  });

  it("enforces admin-only QUEUE_REORDER and broadcasts updated queue", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      settings: { queueMode: "fifo" },
      initialQueue: [
        makeTrack(1, { addedBy: "host" }),
        makeTrack(2, { addedBy: "host" }),
        makeTrack(3, { addedBy: "host" }),
        makeTrack(4, { addedBy: "host" }),
      ],
    });
    sim.join("peer-a");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });

    // Non-host reorder ignored
    expect(
      sim.dispatch({
        type: "QUEUE_REORDER",
        actorId: "peer-a",
        entryId: "entry-4",
        targetIndex: 0,
      }),
    ).toEqual([]);

    // Host reorders entry-4 to index 0
    const effects = sim.dispatch({
      type: "QUEUE_REORDER",
      actorId: "host",
      entryId: "entry-4",
      targetIndex: 0,
    });
    expect(effects).toContainEqual(
      expect.objectContaining({
        type: "BROADCAST_QUEUE_UPDATED",
        queue: [
          expect.objectContaining({ entryId: "entry-4" }),
          expect.objectContaining({ entryId: "entry-2" }),
          expect.objectContaining({ entryId: "entry-3" }),
        ],
      }),
    );
  });

  it("handles configurable VOTE_SKIP modes (off, majority, two-thirds, unanimous) and recalculates on peer leave", () => {
    const sim = new MultiPeerRoomSim({
      nowMs: 1_000,
      settings: { voteSkipMode: "majority" },
      initialQueue: [
        makeTrack(1, { addedBy: "host" }),
        makeTrack(2, { addedBy: "host" }),
        makeTrack(3, { addedBy: "host" }),
      ],
    });
    sim.join("peer-a");
    sim.join("peer-b");
    sim.dispatch({ type: "HOST_TRANSPORT", actorId: "host", action: "play" });
    sim.readyAll(["host", "peer-a", "peer-b"]);
    expect(sim.state.seq).toBe(1);

    // 3 members + majority -> need 2 votes
    sim.dispatch({ type: "VOTE_SKIP", peerId: "peer-a", seq: 1 });
    expect(sim.state.skipVotes).toEqual(["peer-a"]);
    expect(sim.state.seq).toBe(1);

    // Clicking again toggles off vote
    sim.dispatch({ type: "VOTE_SKIP", peerId: "peer-a", seq: 1 });
    expect(sim.state.skipVotes).toEqual([]);

    // Switch to unanimous (need all 3) -> 2 votes stay on track 1
    sim.dispatch({
      type: "HOST_UPDATE_SETTINGS",
      actorId: "host",
      settings: { voteSkipMode: "unanimous" },
    });
    sim.dispatch({ type: "VOTE_SKIP", peerId: "peer-a", seq: 1 });
    sim.dispatch({ type: "VOTE_SKIP", peerId: "host", seq: 1 });
    expect(sim.state.skipVotes).toEqual(["peer-a", "host"]);
    expect(sim.state.seq).toBe(1);

    // If peer-b leaves, remaining 2/2 meets unanimous -> auto-advances and resets votes!
    sim.dispatch({ type: "PEER_LEFT", peerId: "peer-b" });
    expect(sim.state.seq).toBe(2);
    expect(sim.state.currentTrack?.entryId).toBe("entry-2");
    expect(sim.state.skipVotes).toEqual([]);

    // Host disables voteSkipMode -> VOTE_SKIP is ignored
    sim.dispatch({
      type: "HOST_UPDATE_SETTINGS",
      actorId: "host",
      settings: { voteSkipMode: "off" },
    });
    sim.dispatch({ type: "VOTE_SKIP", peerId: "peer-a", seq: 2 });
    expect(sim.state.skipVotes).toEqual([]);
    expect(sim.state.seq).toBe(2);
  });
});
