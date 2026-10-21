import { io, Socket } from "socket.io-client";
import { BrowserView } from "electron";
import playerStateStore from "../../player-state-store";
import log from "electron-log";

// How far apart (in seconds) local and host progress can be before we force a seek
const SYNC_DRIFT_THRESHOLD = 5;

interface TransformedPlayerState {
  player: {
    trackState: number;
    videoProgress: number;
    volume: number;
    muted: boolean;
    adPlaying: boolean;
    queue: unknown;
  };
  video: {
    id: string;
    title: string;
    author: string;
    durationSeconds: number;
    [key: string]: unknown;
  } | null;
  playlistId: string | null;
}

export interface PartyMember {
  socketId: string;
  displayName: string;
  joinedAt: number;
}

type PartyClientEventHandler = {
  onStateChanged?: (state: "inactive" | "connecting" | "joined") => void;
  onMembersChanged?: (members: PartyMember[]) => void;
  onError?: (message: string) => void;
  onDissolved?: (reason: string) => void;
};

/**
 * Client that connects to a remote host's listening party.
 *
 * When connected, it receives the host's player state and syncs the local
 * YTM player to match (track, play/pause, seek position).
 */
export default class ListeningPartyClient {
  private socket: Socket | null = null;
  private ytmView: BrowserView | null = null;
  private handlers: PartyClientEventHandler = {};

  setYtmView(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  setHandlers(handlers: PartyClientEventHandler): void {
    this.handlers = handlers;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  connect(hostIp: string, port: number, partyCode: string, displayName: string): void {
    if (this.socket) {
      this.disconnect();
    }

    this.handlers.onStateChanged?.("connecting");

    this.socket = io(`ws://${hostIp}:${port}/api/v1/party`, {
      transports: ["websocket"],
      auth: {
        partyCode,
        displayName
      },
      reconnection: false,
      timeout: 10000
    });

    this.socket.on("connect", () => {
      log.info(`Connected to listening party at ${hostIp}:${port}`);
      this.handlers.onStateChanged?.("joined");
    });

    this.socket.on("state-update", (state: TransformedPlayerState) => {
      this.syncPlayback(state);
    });

    this.socket.on("member-joined", (data: { member: PartyMember; members: PartyMember[] }) => {
      this.handlers.onMembersChanged?.(data.members);
    });

    this.socket.on("member-left", (data: { socketId: string; members: PartyMember[] }) => {
      this.handlers.onMembersChanged?.(data.members);
    });

    this.socket.on("party-dissolved", (data: { reason: string }) => {
      log.info(`Party dissolved: ${data.reason}`);
      this.handlers.onDissolved?.(data.reason);
      this.cleanup();
    });

    this.socket.on("error", (data: { code: string; message: string }) => {
      log.error(`Party error: ${data.code} - ${data.message}`);
      this.handlers.onError?.(data.message);
      this.cleanup();
    });

    this.socket.on("connect_error", (err: Error) => {
      log.error(`Party connection error: ${err.message}`);
      this.handlers.onError?.(`Could not connect: ${err.message}`);
      this.cleanup();
    });

    this.socket.on("disconnect", (reason: string) => {
      log.info(`Disconnected from party: ${reason}`);
      if (reason !== "io client disconnect") {
        this.handlers.onError?.(`Disconnected: ${reason}`);
      }
      this.cleanup();
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.handlers.onStateChanged?.("inactive");
  }

  private syncPlayback(hostState: TransformedPlayerState): void {
    if (!this.ytmView) return;

    const hostVideo = hostState.video;
    const hostPlayer = hostState.player;

    // Don't sync during ads
    if (hostPlayer.adPlaying) return;

    // No video on host
    if (!hostVideo) return;

    const localState = playerStateStore.getState();
    const localVideoId = localState.videoDetails?.id ?? null;

    // --- Track sync: change to host's track if different ---
    if (hostVideo.id !== localVideoId) {
      this.ytmView.webContents.send("remoteControl:execute", "navigate", {
        watchEndpoint: {
          videoId: hostVideo.id
        }
      });
      // After changing track, don't try to seek immediately (let it buffer)
      return;
    }

    // --- Play/pause sync ---
    // 1 = Playing, 0 = Paused
    if (hostPlayer.trackState === 1 && localState.trackState !== 1) {
      this.ytmView.webContents.send("remoteControl:execute", "play");
    } else if (hostPlayer.trackState === 0 && localState.trackState !== 0) {
      this.ytmView.webContents.send("remoteControl:execute", "pause");
    }

    // --- Position sync: seek if drifted too far ---
    if (hostVideo.id === localVideoId && hostPlayer.trackState === 1) {
      const drift = Math.abs(hostPlayer.videoProgress - localState.videoProgress);
      if (drift > SYNC_DRIFT_THRESHOLD) {
        this.ytmView.webContents.send("remoteControl:execute", "seekTo", hostPlayer.videoProgress);
      }
    }
  }
}
