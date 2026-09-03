import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import listeningPartyManager from "./manager";
import playerStateStore, { PlayerState } from "../../../../../player-state-store";
import log from "electron-log";

const NAMESPACE = "/api/v1/party";

// Threshold in seconds: only broadcast seek if position jumps more than this
const SEEK_THRESHOLD_SECONDS = 5;

interface ListeningPartyPluginOptions extends FastifyPluginOptions {
  transformPlayerState: (state: PlayerState) => unknown;
}

/**
 * Listening Party Fastify plugin.
 *
 * Adds a Socket.IO namespace at /api/v1/party for guest connections.
 * The host creates/dissolves parties via IPC (not via socket).
 *
 * Security:
 * - Guests authenticate with the 8-char party code (grants ZERO access to the companion server API)
 * - Party namespace is fully isolated from /api/v1/realtime
 * - Guests cannot send commands; leader-only control
 * - Brute-force protection via ListeningPartyManager IP blocking
 */
const ListeningPartyPlugin: FastifyPluginCallback<ListeningPartyPluginOptions> = (fastify, options, done) => {
  const { transformPlayerState } = options;

  let stateListener: ((state: PlayerState) => void) | null = null;
  let lastBroadcastVideoId: string | null = null;
  let lastBroadcastTrackState: number | null = null;
  let lastBroadcastProgress: number | null = null;

  const startBroadcasting = () => {
    if (stateListener) return;

    stateListener = (state: PlayerState) => {
      const videoId = state.videoDetails?.id ?? null;
      const trackState = state.trackState;
      const progress = state.videoProgress;

      const trackChanged = videoId !== lastBroadcastVideoId;
      const stateChanged = trackState !== lastBroadcastTrackState;
      const significantSeek = lastBroadcastProgress !== null && progress !== null && Math.abs(progress - lastBroadcastProgress) > SEEK_THRESHOLD_SECONDS;

      if (!trackChanged && !stateChanged && !significantSeek) {
        return;
      }

      lastBroadcastVideoId = videoId;
      lastBroadcastTrackState = trackState;
      lastBroadcastProgress = progress;

      fastify.io.of(NAMESPACE).emit("state-update", transformPlayerState(state));
    };

    playerStateStore.addEventListener(stateListener);
  };

  const stopBroadcasting = () => {
    if (stateListener) {
      playerStateStore.removeEventListener(stateListener);
      stateListener = null;
    }
    lastBroadcastVideoId = null;
    lastBroadcastTrackState = null;
    lastBroadcastProgress = null;
  };

  fastify.ready().then(() => {
    const partyNs = fastify.io.of(NAMESPACE);

    // --- React to manager events (triggered by IPC from the host's UI) ---
    listeningPartyManager.on("partyCreated", () => {
      startBroadcasting();
    });

    listeningPartyManager.on("partyDissolved", () => {
      stopBroadcasting();
      partyNs.emit("party-dissolved", { reason: "Host ended the party" });
      partyNs.fetchSockets().then(sockets => {
        for (const s of sockets) {
          s.disconnect(true);
        }
      });
    });

    // --- Socket authentication middleware (guests only) ---
    partyNs.use((socket, next) => {
      const partyCode = socket.handshake.auth.partyCode;
      if (typeof partyCode !== "string" || !partyCode) {
        next(new Error("Party code required to join"));
        return;
      }

      // Defer code validation to connection handler to avoid leaking party existence
      socket.data.partyCode = partyCode;
      socket.data.displayName = typeof socket.handshake.auth.displayName === "string" ? socket.handshake.auth.displayName : "Guest";
      next();
    });

    // --- Connection handler (guests only) ---
    partyNs.on("connection", socket => {
      const ip = socket.handshake.address;
      const member = listeningPartyManager.addGuest(socket.data.partyCode, socket.id, socket.data.displayName, ip);

      if (!member) {
        socket.emit("error", { code: "PARTY_JOIN_FAILED", message: "Invalid party code or party is full" });
        socket.disconnect(true);
        return;
      }

      const partyInfo = listeningPartyManager.getPartyInfo();
      partyNs.emit("member-joined", { member, members: partyInfo.members });

      // Send current state so guest can sync immediately
      socket.emit("state-update", transformPlayerState(playerStateStore.getState()));
      log.info(`Party guest connected: ${socket.id} (${member.displayName})`);

      socket.on("disconnect", () => {
        listeningPartyManager.removeGuest(socket.id);
        if (listeningPartyManager.isActive()) {
          const info = listeningPartyManager.getPartyInfo();
          if (info) {
            partyNs.emit("member-left", { socketId: socket.id, members: info.members });
          }
        }
        log.info(`Party guest disconnected: ${socket.id}`);
      });
    });
  });

  done();
};

export default ListeningPartyPlugin;
