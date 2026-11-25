import { noopLogger, type ListenTogetherLogger } from "./logger";
import type { PlaybackAnchor } from "./protocol";

const DEADBAND_MS = 500;
const MODERATE_DRIFT_MS = 1_500;
const IMMEDIATE_SEEK_DRIFT_MS = 2_500;
const SEEK_COOLDOWN_MS = 1_500;
const THRASH_WINDOW_MS = 10_000;
const THRASH_MAX_SEEKS = 3;
const DEGRADED_DURATION_MS = 5_000;

export type TargetPositionProjection = {
  posSec: number;
  waitToPlayMs: number;
};

export type DriftEvaluation = {
  action: "none" | "seek" | "degraded";
  targetPosSec?: number;
  reason?: string;
};

export class DriftController {
  private readonly logger: ListenTogetherLogger;
  private consecutiveModerateCount = 0;
  private lastSeekIssuedLocalMs: number | null = null;
  private recentSeekLocalMs: number[] = [];
  private degradedUntilLocalMs: number | null = null;

  constructor(logger: ListenTogetherLogger = noopLogger) {
    this.logger = logger;
  }

  projectTargetPosSec(
    anchor: PlaybackAnchor,
    hostNowMs: number,
  ): TargetPositionProjection {
    if (anchor.desiredState === "PLAYING" && !anchor.pausedForAd) {
      if (hostNowMs < anchor.anchorHostTimeMs) {
        return {
          posSec: Math.max(0, anchor.anchorPosSec),
          waitToPlayMs: anchor.anchorHostTimeMs - hostNowMs,
        };
      }
      const elapsedSec = (hostNowMs - anchor.anchorHostTimeMs) / 1000;
      const projected = Math.max(0, anchor.anchorPosSec + elapsedSec);
      return {
        posSec:
          anchor.durationSec > 0
            ? Math.min(anchor.durationSec, projected)
            : projected,
        waitToPlayMs: 0,
      };
    }

    return {
      posSec: Math.max(0, anchor.anchorPosSec),
      waitToPlayMs: 0,
    };
  }

  evaluateDrift(
    anchor: PlaybackAnchor,
    localPosSec: number,
    hostNowMs: number,
    localNowMs: number,
  ): DriftEvaluation {
    if (
      anchor.desiredState === "IDLE" ||
      anchor.desiredState === "LOADING_BARRIER"
    ) {
      this.consecutiveModerateCount = 0;
      return { action: "none" };
    }

    if (this.degradedUntilLocalMs !== null) {
      if (localNowMs < this.degradedUntilLocalMs) {
        return { action: "degraded", reason: "DEGRADED_SYNC" };
      }
      this.degradedUntilLocalMs = null;
      this.recentSeekLocalMs = this.recentSeekLocalMs.filter(
        (ts) => localNowMs - ts <= THRASH_WINDOW_MS,
      );
      this.logger.info?.("DriftController exited DEGRADED_SYNC", {
        localNowMs,
        remainingSeeksInWindow: this.recentSeekLocalMs.length,
      });
    }

    if (
      this.lastSeekIssuedLocalMs !== null &&
      localNowMs - this.lastSeekIssuedLocalMs < SEEK_COOLDOWN_MS
    ) {
      return { action: "none", reason: "SEEK_COOLDOWN" };
    }

    const projection = this.projectTargetPosSec(anchor, hostNowMs);
    if (projection.waitToPlayMs > 0) {
      this.consecutiveModerateCount = 0;
      return { action: "none" };
    }

    if (!Number.isFinite(localPosSec)) {
      this.logger.debug?.("DriftController ignored non-finite local position", {
        localPosSec,
      });
      return { action: "none" };
    }

    const absDriftMs = Math.abs(localPosSec - projection.posSec) * 1000;
    if (absDriftMs <= DEADBAND_MS) {
      this.consecutiveModerateCount = 0;
      return { action: "none" };
    }

    if (absDriftMs > IMMEDIATE_SEEK_DRIFT_MS) {
      this.consecutiveModerateCount = 0;
      this.logger.info?.("DriftController triggered immediate hard seek", {
        reason: "DRIFT_OVER_2500MS",
        absDriftMs,
        localPosSec,
        targetPosSec: projection.posSec,
      });
      return {
        action: "seek",
        targetPosSec: projection.posSec,
        reason: "DRIFT_OVER_2500MS",
      };
    }

    if (absDriftMs > MODERATE_DRIFT_MS) {
      this.consecutiveModerateCount += 1;
      if (this.consecutiveModerateCount >= 2) {
        this.consecutiveModerateCount = 0;
        this.logger.info?.(
          "DriftController triggered consecutive-moderate hard seek",
          {
            reason: "DRIFT_OVER_1500MS",
            absDriftMs,
            localPosSec,
            targetPosSec: projection.posSec,
          },
        );
        return {
          action: "seek",
          targetPosSec: projection.posSec,
          reason: "DRIFT_OVER_1500MS",
        };
      }
      this.logger.debug?.("DriftController observed moderate drift sample", {
        absDriftMs,
        consecutiveModerateCount: this.consecutiveModerateCount,
        localPosSec,
        targetPosSec: projection.posSec,
      });
      return { action: "none" };
    }

    this.consecutiveModerateCount = 0;
    return { action: "none" };
  }

  markSeekIssued(localNowMs: number): void {
    this.lastSeekIssuedLocalMs = localNowMs;
    this.consecutiveModerateCount = 0;
    this.recentSeekLocalMs = [
      ...this.recentSeekLocalMs.filter(
        (ts) => localNowMs - ts <= THRASH_WINDOW_MS,
      ),
      localNowMs,
    ];
    if (this.recentSeekLocalMs.length > THRASH_MAX_SEEKS) {
      this.degradedUntilLocalMs = localNowMs + DEGRADED_DURATION_MS;
      this.logger.warn?.("DriftController entered DEGRADED_SYNC", {
        seekCountInWindow: this.recentSeekLocalMs.length,
        degradedUntilLocalMs: this.degradedUntilLocalMs,
        localNowMs,
      });
    }
  }

  isDegraded(localNowMs: number): boolean {
    return (
      this.degradedUntilLocalMs !== null &&
      localNowMs < this.degradedUntilLocalMs
    );
  }

  reset(): void {
    const wasDegraded = this.degradedUntilLocalMs !== null;
    this.consecutiveModerateCount = 0;
    this.lastSeekIssuedLocalMs = null;
    this.recentSeekLocalMs = [];
    this.degradedUntilLocalMs = null;
    if (wasDegraded) {
      this.logger.debug?.("DriftController reset", { wasDegraded });
    }
  }
}
