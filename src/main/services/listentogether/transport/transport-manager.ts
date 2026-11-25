import {
  noopLogger,
  type ListenTogetherLogger,
} from "~shared/listentogether/logger";
import { DirectWsTransport } from "./direct-ws";
import type { ITransport, TransportConnection, TransportMode } from "./types";

const DEFAULT_DIRECT_HEAD_START_MS = 250;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;

export type RaceTransportsOptions<TAuth> = {
  directEndpoints?: string[];
  directTransports?: ITransport[];
  tailcatTransport?: ITransport | null;
  relayTransport?: ITransport | null;
  authenticate: (
    conn: TransportConnection,
    signal: AbortSignal,
  ) => Promise<TAuth>;
  directHeadStartMs?: number;
  directTimeoutMs?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
  logger?: ListenTogetherLogger;
};

export type RaceTransportsResult<TAuth> = {
  connection: TransportConnection;
  auth: TAuth;
  mode: TransportMode;
};

/**
 * Races direct endpoints with a 250 ms head-start concurrently against Tailcat and relay transports.
 * The first authenticated connection wins and immediately aborts/closes all losing attempts.
 */
export function raceTransports<TAuth>(
  options: RaceTransportsOptions<TAuth>,
): Promise<RaceTransportsResult<TAuth>> {
  const logger = options.logger ?? noopLogger;
  const directHeadStartMs =
    options.directHeadStartMs ?? DEFAULT_DIRECT_HEAD_START_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;

  const directList: ITransport[] =
    options.directTransports ??
    (options.directEndpoints ?? []).map(
      (ep) =>
        new DirectWsTransport(ep, {
          timeoutMs: options.directTimeoutMs ?? 3000,
          logger,
        }),
    );

  const tailcat = options.tailcatTransport ?? null;
  const relay = options.relayTransport ?? null;
  const secondaryList: ITransport[] = [
    ...(tailcat ? [tailcat] : []),
    ...(relay ? [relay] : []),
  ];

  if (directList.length === 0 && secondaryList.length === 0) {
    logger.warn?.("Cannot start transport race: no endpoints available");
    return Promise.reject(new Error("No transport endpoints available"));
  }
  if (options.signal?.aborted) {
    logger.info?.("Transport race aborted before start");
    return Promise.reject(new Error("Transport race aborted"));
  }

  logger.info?.("Starting transport race", {
    directCount: directList.length,
    hasTailcat: tailcat !== null,
    hasRelay: relay !== null,
    directHeadStartMs,
    totalTimeoutMs,
  });

  return new Promise<RaceTransportsResult<TAuth>>((resolve, reject) => {
    let settled = false;
    let secondaryStarted = false;
    let directRemaining = directList.length;
    let inFlightCount = 0;

    const errors: Error[] = [];
    const openedConnections = new Set<TransportConnection>();
    const masterController = new AbortController();

    let headStartTimer: NodeJS.Timeout | null = null;
    let totalTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (headStartTimer) {
        clearTimeout(headStartTimer);
        headStartTimer = null;
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = null;
      }
      options.signal?.removeEventListener("abort", onExternalAbort);
    };

    const closeAllExcept = (
      winnerConn?: TransportConnection,
      winnerTransport?: ITransport,
    ): { cancelledConnections: number; cancelledTransports: number } => {
      let cancelledConnections = 0;
      let cancelledTransports = 0;
      for (const conn of openedConnections) {
        if (conn !== winnerConn) {
          cancelledConnections += 1;
          logger.debug?.("Closing losing transport connection", {
            id: conn.id,
            mode: conn.mode,
            remoteLabel: conn.remoteLabel,
          });
          try {
            conn.close(1000, "Lost transport race");
          } catch {
            // ignore close error
          }
        }
      }
      openedConnections.clear();
      for (const t of [...directList, ...secondaryList]) {
        if (t !== winnerTransport) {
          cancelledTransports += 1;
          try {
            t.close();
          } catch {
            // ignore
          }
        }
      }
      return { cancelledConnections, cancelledTransports };
    };

    const failAll = (finalError: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      masterController.abort();
      const { cancelledConnections, cancelledTransports } = closeAllExcept();
      logger.warn?.("Transport race failed", {
        reason: finalError.message,
        errorCount: errors.length,
        cancelledConnections,
        cancelledTransports,
      });
      reject(finalError);
    };

    const onExternalAbort = () => {
      logger.info?.("Transport race aborted externally");
      failAll(new Error("Transport race aborted"));
    };
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    if (totalTimeoutMs > 0) {
      totalTimer = setTimeout(() => {
        logger.warn?.("Transport race timed out", {
          totalTimeoutMs,
          errorCount: errors.length,
        });
        failAll(
          new Error(`Transport race timed out after ${totalTimeoutMs} ms`),
        );
      }, totalTimeoutMs);
    }

    const maybeFinishWithFailure = () => {
      if (settled) return;
      if (
        inFlightCount === 0 &&
        (secondaryList.length === 0 || secondaryStarted)
      ) {
        const message =
          errors.length > 0
            ? errors.map((e) => e.message).join("; ")
            : "All transports failed";
        failAll(
          new AggregateError(errors, `All transports failed: ${message}`),
        );
      }
    };

    const runAttempt = async (transport: ITransport, isDirect: boolean) => {
      if (settled) return;
      inFlightCount += 1;
      let conn: TransportConnection | null = null;

      try {
        conn = await transport.connect(masterController.signal);
        if (settled || masterController.signal.aborted) {
          logger.debug?.("Closing late losing transport connection", {
            id: conn.id,
            mode: conn.mode,
            remoteLabel: conn.remoteLabel,
          });
          conn.close(1000, "Lost transport race");
          return;
        }
        openedConnections.add(conn);

        const auth = await options.authenticate(conn, masterController.signal);
        if (settled || masterController.signal.aborted) {
          logger.debug?.("Closing post-auth losing transport connection", {
            id: conn.id,
            mode: conn.mode,
            remoteLabel: conn.remoteLabel,
          });
          conn.close(1000, "Lost transport race");
          openedConnections.delete(conn);
          return;
        }

        settled = true;
        cleanup();
        masterController.abort();
        const { cancelledConnections, cancelledTransports } = closeAllExcept(
          conn,
          transport,
        );
        logger.info?.("Transport race won", {
          winnerMode: transport.mode,
          winnerId: conn.id,
          remoteLabel: conn.remoteLabel,
          cancelledConnections,
          cancelledTransports,
        });
        resolve({
          connection: conn,
          auth,
          mode: transport.mode,
        });
      } catch (err) {
        if (conn) {
          openedConnections.delete(conn);
          try {
            conn.close(1008, "Authentication failed");
          } catch {
            // ignore
          }
        }
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        logger.debug?.("Transport attempt failed", {
          mode: transport.mode,
          error: error.message,
        });
      } finally {
        inFlightCount -= 1;
        if (isDirect) {
          directRemaining -= 1;
          if (
            !settled &&
            directRemaining === 0 &&
            secondaryList.length > 0 &&
            !secondaryStarted
          ) {
            if (headStartTimer) {
              clearTimeout(headStartTimer);
              headStartTimer = null;
            }
            logger.info?.(
              "All direct transports failed; launching secondary transports immediately",
              {
                directCount: directList.length,
                hasTailcat: tailcat !== null,
                hasRelay: relay !== null,
              },
            );
            launchSecondary();
          }
        }
        maybeFinishWithFailure();
      }
    };

    const launchSecondary = () => {
      if (settled || secondaryStarted || secondaryList.length === 0) return;
      secondaryStarted = true;
      for (const secondary of secondaryList) {
        void runAttempt(secondary, false);
      }
    };

    for (const direct of directList) {
      void runAttempt(direct, true);
    }

    if (secondaryList.length > 0) {
      if (directList.length === 0 || directHeadStartMs <= 0) {
        launchSecondary();
      } else {
        headStartTimer = setTimeout(() => {
          headStartTimer = null;
          logger.info?.(
            "Direct head-start elapsed; launching secondary transports",
            {
              directHeadStartMs,
              hasTailcat: tailcat !== null,
              hasRelay: relay !== null,
            },
          );
          launchSecondary();
        }, directHeadStartMs);
      }
    }
  });
}

export class TransportManager {
  private readonly logger: ListenTogetherLogger;
  private readonly directHeadStartMs: number;
  private readonly totalTimeoutMs: number;

  constructor(
    options: {
      logger?: ListenTogetherLogger;
      directHeadStartMs?: number;
      totalTimeoutMs?: number;
    } = {},
  ) {
    this.logger = options.logger ?? noopLogger;
    this.directHeadStartMs =
      options.directHeadStartMs ?? DEFAULT_DIRECT_HEAD_START_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  }

  public race<TAuth>(
    options: Omit<
      RaceTransportsOptions<TAuth>,
      "logger" | "directHeadStartMs" | "totalTimeoutMs"
    > & {
      directHeadStartMs?: number;
      totalTimeoutMs?: number;
    },
  ): Promise<RaceTransportsResult<TAuth>> {
    return raceTransports({
      ...options,
      logger: this.logger,
      directHeadStartMs: options.directHeadStartMs ?? this.directHeadStartMs,
      totalTimeoutMs: options.totalTimeoutMs ?? this.totalTimeoutMs,
    });
  }
}
