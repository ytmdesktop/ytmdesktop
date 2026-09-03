import log from "electron-log";
import { defineInterface, DefinedInterface, ExportRegistration, MessageBus, NameRegistration, sessionBus } from "dbus-native";

import {
  AdDetails,
  LikeStatus,
  MiniPlayerAd,
  MiniPlayerCommand,
  MiniPlayerLikeStatus,
  MiniPlayerPlayResultAction,
  MiniPlayerRepeatMode,
  MiniPlayerSearchResult,
  MiniPlayerSearchSnapshot,
  MiniPlayerSnapshot,
  MiniPlayerStatus,
  PlayerState,
  RepeatMode,
  VideoState
} from "./player-state-store";

export const MINI_PLAYER_SERVICE = "io.github.ytmdesktop.MiniPlayer";
export const MINI_PLAYER_PATH = "/io/github/ytmdesktop/MiniPlayer";

const MAX_SEARCH_QUERY_LENGTH = 200;

type MiniPlayerActions = {
  command(command: MiniPlayerCommand, value?: number): void;
  search(query: string): Promise<MiniPlayerSearchResult[]>;
  playResult(videoId: string, action: MiniPlayerPlayResultAction): void;
  toggleMainWindow(): void;
  showMainWindow(): void;
  openSettings(): void;
  quit(): void;
};

type SessionState = {
  authenticated: boolean;
  hasSavedTrack: boolean;
};

const PROGRESS_SIGNAL_INTERVAL_MS = 1000;

export default class LinuxMiniPlayerService {
  private playerState: PlayerState;
  private sessionState: SessionState;
  private stableStatus: MiniPlayerStatus = "idle";
  private statusOverride: "loading" | "needs-main-app" | null = null;
  private stateJson = "null";
  private lastImmediateSignature = "";
  private lastSignalAt = 0;
  private progressSignalTimeout: NodeJS.Timeout | null = null;
  private searchRequestId = 0;
  private bus: MessageBus | null = null;
  private definition: DefinedInterface | null = null;
  private exported: ExportRegistration | null = null;
  private ownedName: NameRegistration | null = null;

  constructor(
    private readonly actions: MiniPlayerActions,
    initialState: PlayerState,
    initialSessionState: SessionState
  ) {
    this.playerState = initialState;
    this.sessionState = initialSessionState;
    this.updateStableStatus(initialState.trackState);
    this.refreshSnapshot(false);
  }

  async start() {
    if (this.bus) return;

    const bus = sessionBus({ reconnect: true });
    bus.connection.on("error", error => log.error("Linux mini-player D-Bus error", error));
    bus.connection.on("handlerError", error => log.error("Linux mini-player handler error", error));

    const ownedName = await bus.ownName(MINI_PLAYER_SERVICE, 4);
    if (!ownedName.isPrimaryOwner) {
      await bus.close();
      throw new Error(`Unable to own D-Bus service ${MINI_PLAYER_SERVICE}`);
    }

    const definition = defineInterface({
      name: MINI_PLAYER_SERVICE,
      methods: {
        GetState: {
          out: { stateJson: "s" },
          handler: () => this.stateJson
        },
        Command: {
          in: { command: "s", value: "d" },
          handler: ({ command, value }: { command: string; value: number }) => {
            const allowedCommands = new Set<MiniPlayerCommand>([
              "previous",
              "playPause",
              "next",
              "seekTo",
              "toggleLike",
              "toggleDislike",
              "repeatMode",
              "shuffle",
              "setVolume",
              "mute",
              "startMix",
              "skipAd"
            ]);
            if (!allowedCommands.has(command as MiniPlayerCommand)) return;
            if (command === "seekTo" && (!Number.isFinite(value) || value < 0)) return;
            if (command === "setVolume" && (!Number.isFinite(value) || value < 0 || value > 100)) return;
            if (command === "repeatMode" && ![0, 1, 2].includes(value)) return;
            this.actions.command(command as MiniPlayerCommand, value);
          }
        },
        ToggleMainWindow: { handler: () => this.actions.toggleMainWindow() },
        ShowMainWindow: { handler: () => this.actions.showMainWindow() },
        OpenSettings: { handler: () => this.actions.openSettings() },
        Quit: { handler: () => this.actions.quit() },
        Search: {
          in: { query: "s" },
          handler: ({ query }: { query: string }) => {
            this.startSearch(query);
          }
        },
        PlayResult: {
          in: { videoId: "s", action: "s" },
          handler: ({ videoId, action }: { videoId: string; action: string }) => {
            if (!videoId || (action !== "now" && action !== "next")) return;
            this.actions.playResult(videoId, action);
          }
        }
      },
      signals: {
        StateChanged: { args: { stateJson: "s" } },
        SearchResultsChanged: { args: { resultsJson: "s" } }
      }
    });

    const exported = await bus.export(MINI_PLAYER_PATH, definition);
    this.bus = bus;
    this.definition = definition;
    this.exported = exported;
    this.ownedName = ownedName;
    log.info("Started Linux mini-player D-Bus service", MINI_PLAYER_SERVICE);
  }

  updatePlayerState(state: PlayerState) {
    this.playerState = state;
    this.updateStableStatus(state.trackState);
    if (state.videoDetails) this.statusOverride = null;
    this.refreshSnapshot(true);
  }

  updateSessionState(sessionState: SessionState) {
    this.sessionState = sessionState;
    if (!sessionState.authenticated) this.statusOverride = null;
    this.refreshSnapshot(true);
  }

  setLoading() {
    this.statusOverride = "loading";
    this.refreshSnapshot(true);
  }

  setNeedsMainApp() {
    this.statusOverride = "needs-main-app";
    this.refreshSnapshot(true);
  }

  async stop() {
    this.searchRequestId += 1;
    if (this.progressSignalTimeout) clearTimeout(this.progressSignalTimeout);
    const exported = this.exported;
    const ownedName = this.ownedName;
    const bus = this.bus;

    this.progressSignalTimeout = null;
    this.exported = null;
    this.ownedName = null;
    this.definition = null;
    this.bus = null;

    await exported?.remove();
    await ownedName?.release();
    await bus?.close();
  }

  private updateStableStatus(trackState: VideoState) {
    if (trackState === VideoState.Playing) this.stableStatus = "playing";
    if (trackState === VideoState.Paused) this.stableStatus = "paused";
  }

  private createSnapshot(): MiniPlayerSnapshot {
    const video = this.playerState.videoDetails;
    const queueReady = !!video && (this.playerState.queue?.items.length ?? 0) > 0;
    const artworkUrl = cleanArtworkUrl(video?.thumbnails.length ? [...video.thumbnails].sort((left, right) => right.width - left.width)[0].url : null);
    const likeStatus = toLikeStatus(video?.likeStatus);
    const repeatMode = toRepeatMode(this.playerState.queue?.repeatMode);
    const adDetails = this.playerState.adDetails;
    const adPlaying = !!this.playerState.adPlaying;
    const ad = adPlaying ? toMiniPlayerAd(adDetails) : null;

    // Signing in is not required to play YouTube Music, so it gates nothing but the account-bound
    // actions below. A signed-out listener still gets ads and free playback, and the panel has to
    // drive it.
    let status: MiniPlayerStatus;
    let message: string | null = null;
    if (adPlaying) {
      // stableStatus is stuck on "paused" for the whole ad: YTM reports the song pausing but the
      // ad player never reports itself playing. The ad element is the only truth here.
      status = adDetails?.isPlaying ? "playing" : "paused";
    } else if (video) {
      status = this.stableStatus === "playing" ? "playing" : "paused";
    } else if (this.statusOverride === "loading") {
      status = "loading";
      message = "Resuming last track…";
    } else if (this.statusOverride === "needs-main-app" || !this.sessionState.hasSavedTrack) {
      status = "needs-main-app";
      message = "Choose a track in YouTube Music";
    } else {
      status = "idle";
      message = "Resume last track";
    }

    return {
      version: 1,
      authenticated: this.sessionState.authenticated,
      status,
      track: video
        ? {
            id: video.id,
            title: video.title,
            artist: video.author,
            durationSeconds: video.durationSeconds,
            artworkUrl,
            likeStatus
          }
        : null,
      progressSeconds: adPlaying ? (adDetails?.progressSeconds ?? 0) : this.playerState.videoProgress,
      canPlay: (!!video || this.sessionState.hasSavedTrack) && status !== "needs-main-app",
      canPrevious: queueReady,
      canNext: queueReady,
      // Rating a track is the only thing here that actually needs an account.
      canLike: this.sessionState.authenticated && !!video && !adPlaying,
      canSkipAd: adPlaying && !!adDetails?.canSkip,
      likeStatus,
      repeatMode,
      volume: Math.max(0, Math.min(100, this.playerState.volume ?? 0)),
      muted: !!this.playerState.muted,
      adPlaying,
      ad,
      message
    };
  }

  private refreshSnapshot(emit: boolean) {
    const snapshot = this.createSnapshot();
    this.stateJson = JSON.stringify(snapshot);
    if (!emit || !this.definition) return;

    const immediateSignature = JSON.stringify({ ...snapshot, progressSeconds: 0 });
    const immediateChange = immediateSignature !== this.lastImmediateSignature;
    this.lastImmediateSignature = immediateSignature;
    if (immediateChange) {
      this.emitState();
      return;
    }

    const elapsed = Date.now() - this.lastSignalAt;
    if (elapsed >= PROGRESS_SIGNAL_INTERVAL_MS) {
      this.emitState();
    } else if (!this.progressSignalTimeout) {
      this.progressSignalTimeout = setTimeout(() => {
        this.progressSignalTimeout = null;
        this.emitState();
      }, PROGRESS_SIGNAL_INTERVAL_MS - elapsed);
    }
  }

  private emitState() {
    if (!this.definition) return;
    if (this.progressSignalTimeout) clearTimeout(this.progressSignalTimeout);
    this.progressSignalTimeout = null;
    this.lastSignalAt = Date.now();
    this.definition.emit.StateChanged(this.stateJson);
  }

  private startSearch(rawQuery: string) {
    const query = rawQuery.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const requestId = ++this.searchRequestId;

    if (!query) {
      this.emitSearch({ version: 1, query: "", status: "idle", results: [], message: null });
      return;
    }

    this.emitSearch({ version: 1, query, status: "loading", results: [], message: null });
    void this.actions
      .search(query)
      .then(results => {
        if (requestId !== this.searchRequestId) return;
        this.emitSearch({
          version: 1,
          query,
          status: "ready",
          results,
          message: results.length ? null : "No songs found"
        });
      })
      .catch(error => {
        if (requestId !== this.searchRequestId) return;
        log.error("Linux mini-player search failed", error);
        this.emitSearch({
          version: 1,
          query,
          status: "error",
          results: [],
          message: "Search failed"
        });
      });
  }

  private emitSearch(snapshot: MiniPlayerSearchSnapshot) {
    if (!this.definition) return;
    this.definition.emit.SearchResultsChanged(JSON.stringify(snapshot));
  }
}

function cleanArtworkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/-l90-rj\b/g, "")
    .replace(/-rw\b/g, "")
    .replace(/-rj\b/g, "")
    .replace(/=w(\d+)-h(\d+)/, (_match, width, height) => {
      const side = Math.max(Number(width), Number(height), 512);
      return `=w${side}-h${side}-c`;
    });
}

function toMiniPlayerAd(details: AdDetails | null): MiniPlayerAd {
  return {
    title: details?.title || "Advertisement",
    // The badge ("Sponsored 1 of 2") is the only advertiser text most video ads expose.
    advertiser: details?.advertiser || details?.badge || null,
    // Video ads carry no artwork; the panel shows its placeholder rather than the interrupted song.
    artworkUrl: null,
    durationSeconds: details?.durationSeconds ?? 0,
    skipHint: details?.skipHint ?? null
  };
}

function toLikeStatus(status: LikeStatus | undefined): MiniPlayerLikeStatus {
  if (status === LikeStatus.Like) return "like";
  if (status === LikeStatus.Dislike) return "dislike";
  return "indifferent";
}

function toRepeatMode(mode: RepeatMode | undefined): MiniPlayerRepeatMode {
  if (mode === RepeatMode.All) return "all";
  if (mode === RepeatMode.One) return "one";
  return "none";
}
