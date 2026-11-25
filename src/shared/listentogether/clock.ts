import { noopLogger, type ListenTogetherLogger } from "./logger";

const RING_BUFFER_CAPACITY = 8;
const INITIAL_BURST_SAMPLES = 5;
const MAX_VALID_RTT_MS = 5_000;
const RTT_OUTLIER_FACTOR = 1.5;
const RTT_OUTLIER_FLOOR_MS = 15;
const STEADY_PREV_WEIGHT = 0.75;
const STEADY_TARGET_WEIGHT = 0.25;
const MAX_STEP_DELTA_MS = 40;

type ClockSample = {
  rttMs: number;
  offsetMs: number;
};

function computeMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export class ClockSync {
  private readonly logger: ListenTogetherLogger;
  private buffer: ClockSample[] = [];
  private acceptedSinceReset = 0;
  private offsetMs = 0;
  private minRttMs: number | null = null;

  constructor(logger: ListenTogetherLogger = noopLogger) {
    this.logger = logger;
  }

  recordSample(t0: number, t1: number, t2: number, t3: number): boolean {
    if (
      !Number.isFinite(t0) ||
      !Number.isFinite(t1) ||
      !Number.isFinite(t2) ||
      !Number.isFinite(t3)
    ) {
      this.logger.debug?.("ClockSync discarded non-finite sample", {
        t0,
        t1,
        t2,
        t3,
      });
      return false;
    }

    const rttMs = t3 - t0 - (t2 - t1);
    if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > MAX_VALID_RTT_MS) {
      this.logger.debug?.("ClockSync discarded out-of-range RTT sample", {
        rttMs,
        minValidMs: 0,
        maxValidMs: MAX_VALID_RTT_MS,
      });
      return false;
    }

    const sampleOffsetMs = (t1 - t0 + (t2 - t3)) / 2;
    if (!Number.isFinite(sampleOffsetMs)) {
      this.logger.debug?.("ClockSync discarded non-finite offset sample", {
        rttMs,
        sampleOffsetMs,
      });
      return false;
    }

    if (this.buffer.length >= RING_BUFFER_CAPACITY) {
      this.buffer.shift();
    }
    this.buffer.push({ rttMs, offsetMs: sampleOffsetMs });
    this.acceptedSinceReset += 1;

    let minRtt = Infinity;
    for (const sample of this.buffer) {
      if (sample.rttMs < minRtt) {
        minRtt = sample.rttMs;
      }
    }
    this.minRttMs = minRtt;

    const rttThreshold = Math.max(
      minRtt * RTT_OUTLIER_FACTOR,
      minRtt + RTT_OUTLIER_FLOOR_MS,
    );
    const filteredOffsets = this.buffer
      .filter((sample) => sample.rttMs <= rttThreshold)
      .map((sample) => sample.offsetMs);
    const outlierCount = this.buffer.length - filteredOffsets.length;
    if (rttMs > rttThreshold) {
      this.logger.debug?.(
        "ClockSync discarded outlier RTT sample from filter",
        {
          rttMs,
          minRttMs: minRtt,
          rttThresholdMs: rttThreshold,
          outlierCount,
          bufferSize: this.buffer.length,
        },
      );
    }

    const medianTarget = computeMedian(filteredOffsets);

    if (this.acceptedSinceReset <= INITIAL_BURST_SAMPLES) {
      this.offsetMs = medianTarget;
    } else {
      const ewmaTarget =
        STEADY_PREV_WEIGHT * this.offsetMs +
        STEADY_TARGET_WEIGHT * medianTarget;
      const rawDelta = ewmaTarget - this.offsetMs;
      const clampedDelta = Math.max(
        -MAX_STEP_DELTA_MS,
        Math.min(MAX_STEP_DELTA_MS, rawDelta),
      );
      this.offsetMs += clampedDelta;
    }

    return true;
  }

  reset(): void {
    const previousOffsetMs = this.offsetMs;
    const previousSampleCount = this.buffer.length;
    const previousMinRttMs = this.minRttMs;
    this.buffer = [];
    this.acceptedSinceReset = 0;
    this.offsetMs = 0;
    this.minRttMs = null;
    this.logger.info?.("ClockSync reset", {
      previousOffsetMs,
      previousSampleCount,
      previousMinRttMs,
    });
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  getSampleCount(): number {
    return this.buffer.length;
  }

  getAcceptedSampleCount(): number {
    return this.acceptedSinceReset;
  }

  getMinRttMs(): number | null {
    return this.minRttMs;
  }

  projectHostNow(localNowMs: number): number {
    return localNowMs + this.offsetMs;
  }
}
