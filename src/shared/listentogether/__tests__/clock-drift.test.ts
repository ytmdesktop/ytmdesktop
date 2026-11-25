import { describe, expect, it } from "vitest";
import { ClockSync } from "../clock";
import { DriftController } from "../drift";
import type { ListenTogetherLogger } from "../logger";
import type { PlaybackAnchor } from "../protocol";

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

function feedSample(
  clock: ClockSync,
  trueOffsetMs: number,
  rttMs: number,
  t0 = 1_000,
): boolean {
  const halfRtt = rttMs / 2;
  const t1 = t0 + halfRtt + trueOffsetMs;
  const t2 = t1;
  const t3 = t0 + rttMs;
  return clock.recordSample(t0, t1, t2, t3);
}

function makeAnchor(overrides: Partial<PlaybackAnchor> = {}): PlaybackAnchor {
  return {
    seq: 1,
    videoId: "dQw4w9WgXcQ",
    durationSec: 200,
    desiredState: "PLAYING",
    pausedForAd: false,
    waitingOnAds: [],
    anchorPosSec: 10,
    anchorHostTimeMs: 10_000,
    ...overrides,
  };
}

describe("ClockSync", () => {
  it("converges immediately during the 5-ping join burst even for large offsets", () => {
    const clock = new ClockSync();

    expect(feedSample(clock, 5_000, 20, 1_000)).toBe(true);
    expect(clock.getOffsetMs()).toBe(5_000);
    expect(clock.getAcceptedSampleCount()).toBe(1);

    expect(feedSample(clock, 5_020, 22, 2_000)).toBe(true);
    expect(clock.getOffsetMs()).toBe(5_010);

    expect(feedSample(clock, 5_010, 18, 3_000)).toBe(true);
    expect(clock.getOffsetMs()).toBe(5_010);

    expect(feedSample(clock, 4_990, 20, 4_000)).toBe(true);
    expect(clock.getOffsetMs()).toBe(5_005);

    expect(feedSample(clock, 5_000, 16, 5_000)).toBe(true);
    expect(clock.getOffsetMs()).toBe(5_000);
    expect(clock.getSampleCount()).toBe(5);
    expect(clock.projectHostNow(20_000)).toBe(25_000);
  });

  it("maintains W=8 ring buffer and rejects RTT outliers above max(minRtt*1.5, minRtt+15)", () => {
    const { logger, entries } = createSpyLogger();
    const clock = new ClockSync(logger);

    // 5 baseline samples with rtt = 10ms -> threshold = max(15, 25) = 25ms
    for (let i = 0; i < 5; i++) {
      expect(feedSample(clock, 1_000, 10, i * 100)).toBe(true);
    }
    expect(clock.getMinRttMs()).toBe(10);
    expect(clock.getOffsetMs()).toBe(1_000);

    // Outlier at rtt = 26ms (> 25ms) with wildly skewed offset must be ignored
    expect(feedSample(clock, 9_999, 26, 600)).toBe(true);
    expect(clock.getOffsetMs()).toBe(1_000);
    expect(
      entries.some(
        (e) =>
          e.message === "ClockSync discarded outlier RTT sample from filter",
      ),
    ).toBe(true);

    // Sample at exact boundary rtt = 25ms (<= 25ms) is accepted into filter
    expect(feedSample(clock, 1_040, 25, 700)).toBe(true);
    expect(clock.getSampleCount()).toBe(7);

    // Push 2 more low-RTT samples -> buffer capped at W=8
    expect(feedSample(clock, 1_000, 10, 800)).toBe(true);
    expect(feedSample(clock, 1_000, 10, 900)).toBe(true);
    expect(clock.getSampleCount()).toBe(8);

    // Test multiplicative branch: when minRtt = 100ms, threshold = max(150, 115) = 150ms
    const highRttClock = new ClockSync();
    for (let i = 0; i < 5; i++) {
      feedSample(highRttClock, 500, 100, i * 100);
    }
    expect(highRttClock.getMinRttMs()).toBe(100);
    feedSample(highRttClock, 9_000, 151, 600);
    expect(highRttClock.getOffsetMs()).toBe(500);
  });

  it("clamps steady-state EWMA steps to +/-40 ms per sample", () => {
    const clock = new ClockSync();

    // Establish initial offset = 0ms over 5 samples
    for (let i = 0; i < 5; i++) {
      feedSample(clock, 0, 10, i * 100);
    }
    expect(clock.getOffsetMs()).toBe(0);

    // Feed 8 samples at +400ms to shift the entire W=8 window median to +400ms
    // Sample 6 (buffer: [0,0,0,0,0,400]): median=0 -> offset=0
    feedSample(clock, 400, 10, 600);
    expect(clock.getOffsetMs()).toBe(0);

    // Samples 7..9: once median hits 200 or 400, ewma delta > 40ms is clamped to +40ms
    feedSample(clock, 400, 10, 700);
    feedSample(clock, 400, 10, 800);
    feedSample(clock, 400, 10, 900); // median = 200 -> 0.25*200 = 50 -> clamped +40
    expect(clock.getOffsetMs()).toBe(40);

    // Sample 10 (buffer has 3 zeros and 5x400 -> median = 400):
    // ewma = 0.75*40 + 0.25*400 = 130 -> delta = +90 -> clamped to +40 => 80
    feedSample(clock, 400, 10, 1_000);
    expect(clock.getOffsetMs()).toBe(80);

    // Now test negative -40 ms clamp
    const negClock = new ClockSync();
    for (let i = 0; i < 5; i++) {
      feedSample(negClock, 0, 10, i * 100);
    }
    for (let i = 0; i < 4; i++) {
      feedSample(negClock, -400, 10, 600 + i * 100);
    }
    expect(negClock.getOffsetMs()).toBe(-40);
  });

  it("discards non-finite and out-of-range RTT samples and supports reset()", () => {
    const { logger, entries } = createSpyLogger();
    const clock = new ClockSync(logger);

    expect(clock.recordSample(Number.NaN, 100, 100, 110)).toBe(false);
    expect(clock.recordSample(100, 100, 100, 99)).toBe(false); // rtt = -1
    expect(clock.recordSample(0, 100, 100, 5_001)).toBe(false); // rtt > 5000

    feedSample(clock, 2_500, 12, 1_000);
    expect(clock.getOffsetMs()).toBe(2_500);

    clock.reset();
    expect(clock.getOffsetMs()).toBe(0);
    expect(clock.getSampleCount()).toBe(0);
    expect(clock.getAcceptedSampleCount()).toBe(0);
    expect(clock.getMinRttMs()).toBeNull();
    expect(entries.some((e) => e.message === "ClockSync reset")).toBe(true);

    // After reset, 5-ping immediate burst convergence is active again
    feedSample(clock, -1_200, 14, 2_000);
    expect(clock.getOffsetMs()).toBe(-1_200);
  });
});

describe("DriftController", () => {
  it("projects future anchorHostTimeMs as waitToPlayMs without negative seek", () => {
    const drift = new DriftController();
    const anchor = makeAnchor({
      anchorPosSec: 0,
      anchorHostTimeMs: 10_150,
    });

    const beforeStart = drift.projectTargetPosSec(anchor, 10_000);
    expect(beforeStart).toEqual({ posSec: 0, waitToPlayMs: 150 });

    // During waitToPlayMs > 0, evaluateDrift never issues a seek
    expect(drift.evaluateDrift(anchor, 5, 10_000, 10_000)).toEqual({
      action: "none",
    });

    const afterStart = drift.projectTargetPosSec(anchor, 12_150);
    expect(afterStart).toEqual({ posSec: 2, waitToPlayMs: 0 });

    const clampedEnd = drift.projectTargetPosSec(anchor, 500_000);
    expect(clampedEnd).toEqual({ posSec: 200, waitToPlayMs: 0 });

    const pausedForAd = drift.projectTargetPosSec(
      makeAnchor({
        pausedForAd: true,
        anchorPosSec: 45,
        anchorHostTimeMs: 10_000,
      }),
      50_000,
    );
    expect(pausedForAd).toEqual({ posSec: 45, waitToPlayMs: 0 });
  });

  it("enforces 500ms deadband, 1500ms 2-tick seek, and 2500ms immediate seek", () => {
    const { logger, entries } = createSpyLogger();
    const drift = new DriftController(logger);
    const anchor = makeAnchor({ anchorPosSec: 10, anchorHostTimeMs: 10_000 });

    // At hostNowMs = 20_000, targetPosSec = 20
    expect(drift.evaluateDrift(anchor, 20.5, 20_000, 20_000)).toEqual({
      action: "none",
    });
    expect(drift.evaluateDrift(anchor, 19.5, 20_000, 20_500)).toEqual({
      action: "none",
    });

    // Between 500ms and 1500ms -> still no seek
    expect(drift.evaluateDrift(anchor, 18.5, 20_000, 21_000)).toEqual({
      action: "none",
    });

    // Moderate drift (> 1500ms and <= 2500ms): requires 2 consecutive ticks
    expect(drift.evaluateDrift(anchor, 18.4, 20_000, 22_000)).toEqual({
      action: "none",
    });
    // Non-moderate sample resets streak
    expect(drift.evaluateDrift(anchor, 19.9, 20_000, 22_500)).toEqual({
      action: "none",
    });
    // Now 2 consecutive moderate ticks trigger seek
    expect(drift.evaluateDrift(anchor, 18.0, 20_000, 23_000)).toEqual({
      action: "none",
    });
    expect(drift.evaluateDrift(anchor, 18.0, 20_000, 23_500)).toEqual({
      action: "seek",
      targetPosSec: 20,
      reason: "DRIFT_OVER_1500MS",
    });

    // Immediate seek (> 2500ms) fires on 1st tick
    expect(drift.evaluateDrift(anchor, 17.4, 20_000, 24_000)).toEqual({
      action: "seek",
      targetPosSec: 20,
      reason: "DRIFT_OVER_2500MS",
    });

    expect(
      entries.some(
        (e) => e.message === "DriftController triggered immediate hard seek",
      ),
    ).toBe(true);
  });

  it("enforces 1500ms seek cooldown", () => {
    const drift = new DriftController();
    const anchor = makeAnchor({ anchorPosSec: 10, anchorHostTimeMs: 10_000 });

    drift.markSeekIssued(20_000);

    expect(drift.evaluateDrift(anchor, 0, 20_500, 20_500)).toEqual({
      action: "none",
      reason: "SEEK_COOLDOWN",
    });
    expect(drift.evaluateDrift(anchor, 0, 21_499, 21_499)).toEqual({
      action: "none",
      reason: "SEEK_COOLDOWN",
    });
    expect(drift.evaluateDrift(anchor, 0, 21_500, 21_500)).toEqual({
      action: "seek",
      targetPosSec: 21.5,
      reason: "DRIFT_OVER_2500MS",
    });
  });

  it("triggers DEGRADED_SYNC for 5000ms after >3 seeks in 10000ms and recovers afterwards", () => {
    const { logger, entries } = createSpyLogger();
    const drift = new DriftController(logger);
    const anchor = makeAnchor({ anchorPosSec: 0, anchorHostTimeMs: 0 });

    // 3 seeks within 10s are allowed
    drift.markSeekIssued(1_000);
    drift.markSeekIssued(3_000);
    drift.markSeekIssued(5_000);
    expect(drift.isDegraded(5_000)).toBe(false);

    // 4th seek at t=7_000ms (> 3 seeks in 10_000ms) -> DEGRADED_SYNC until 12_000ms
    drift.markSeekIssued(7_000);
    expect(drift.isDegraded(7_000)).toBe(true);
    expect(drift.isDegraded(11_999)).toBe(true);
    expect(drift.evaluateDrift(anchor, 100, 11_999, 11_999)).toEqual({
      action: "degraded",
      reason: "DEGRADED_SYNC",
    });

    // At t=12_000ms (degradedUntilLocalMs), controller exits DEGRADED_SYNC
    expect(drift.isDegraded(12_000)).toBe(false);
    const recovered = drift.evaluateDrift(anchor, 0, 12_000, 12_000);
    expect(recovered).toEqual({
      action: "seek",
      targetPosSec: 12,
      reason: "DRIFT_OVER_2500MS",
    });
    expect(
      entries.some(
        (e) => e.message === "DriftController entered DEGRADED_SYNC",
      ),
    ).toBe(true);
    expect(
      entries.some((e) => e.message === "DriftController exited DEGRADED_SYNC"),
    ).toBe(true);

    drift.reset();
    expect(drift.isDegraded(12_000)).toBe(false);
  });

  it("ignores IDLE, LOADING_BARRIER, and non-finite localPosSec", () => {
    const drift = new DriftController();
    expect(
      drift.evaluateDrift(
        makeAnchor({ desiredState: "IDLE" }),
        0,
        50_000,
        50_000,
      ),
    ).toEqual({ action: "none" });
    expect(
      drift.evaluateDrift(
        makeAnchor({ desiredState: "LOADING_BARRIER" }),
        0,
        50_000,
        50_000,
      ),
    ).toEqual({ action: "none" });
    expect(
      drift.evaluateDrift(makeAnchor(), Number.NaN, 50_000, 50_000),
    ).toEqual({ action: "none" });
  });
});
