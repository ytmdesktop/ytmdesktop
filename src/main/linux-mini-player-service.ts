import log from "electron-log";
import GnomePanelReadiness from "./gnome-panel-readiness";
import { defineInterface, DefinedInterface, ExportRegistration, MessageBus, NameRegistration, sessionBus } from "dbus-native";

import {
  AdDetails,
  LikeStatus,
  MiniPlayerAd,
  MiniPlayerArtistBrowsePage,
  MiniPlayerArtistBrowseRequest,
  MiniPlayerArtistBrowseSnapshot,
  MiniPlayerArtistSection,
  MiniPlayerCommand,
  MiniPlayerLikeStatus,
  MiniPlayerRepeatMode,
  MiniPlayerMusicRequest,
  MiniPlayerMusicPage,
  MiniPlayerMusicCategory,
  MiniPlayerAlbumPage,
  MiniPlayerQueueResult,
  MiniPlayerSearchMode,
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
const BROWSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// "browse:<browseId>[:<params>]" or "token:<continuation>", opaque strings handed back by the page.
const CONTINUATION_PATTERN = /^(browse|token):[A-Za-z0-9_%=+/.:-]{1,4096}$/;
const ARTIST_SECTIONS = new Set<MiniPlayerArtistSection>(["", "songs", "videos"]);

type MiniPlayerActions = {
  command(command: MiniPlayerCommand, value?: number): void;
  searchMusic(request: MiniPlayerMusicRequest): Promise<MiniPlayerMusicPage>;
  startResultMix(videoId: string): Promise<MiniPlayerQueueResult>;
  albumBrowse(albumId: string, continuation: string | null): Promise<MiniPlayerAlbumPage>;
  playNext(videoId: string): Promise<MiniPlayerQueueResult>;
  openAlbum(albumId: string): void;
  search(query: string, mode: MiniPlayerSearchMode): Promise<MiniPlayerSearchResult[]>;
  artistBrowse(request: MiniPlayerArtistBrowseRequest): Promise<MiniPlayerArtistBrowsePage>;
  openArtist(browseId: string): void;
  playResult(videoId: string): void;
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
  private artistRequestId = 0;
  private albumRequestId = 0;
  private queueBusy = false;
  private readonly panelReadiness: GnomePanelReadiness;
  private bus: MessageBus | null = null;
  private definition: DefinedInterface | null = null;
  private exported: ExportRegistration | null = null;
  private ownedName: NameRegistration | null = null;

  constructor(
    private readonly actions: MiniPlayerActions,
    initialState: PlayerState,
    initialSessionState: SessionState,
    panel: { version: number; changed: (ready: boolean) => void }
  ) {
    this.panelReadiness = new GnomePanelReadiness(panel.version, ready => {
      if (ready) log.info(`GNOME mini-player UI ready (v${panel.version}); update verified`);
      panel.changed(ready);
    }, () => log.error(`GNOME mini-player UI readiness timed out (expected v${panel.version}); keeping tray fallback`));
    this.playerState = initialState;
    this.sessionState = initialSessionState;
    this.updateStableStatus(initialState.trackState);
    this.refreshSnapshot(false);
  }

  get isPanelReady() {
    return this.panelReadiness.isReady;
  }

  get isPanelPending() {
    return this.panelReadiness.isPending;
  }

  invalidatePanel() {
    this.panelReadiness.begin();
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
        GetPanelSession: {
          out: { sessionJson: "s" },
          handler: () => JSON.stringify(this.panelReadiness.description)
        },
        ReportPanelReady: {
          in: { version: "u", session: "s" },
          out: { accepted: "b" },
          handler: ({version, session}: {version: number; session: string}) => {
            const accepted = this.panelReadiness.report(version, session);
            if (!accepted) log.warn(`GNOME mini-player UI readiness rejected (reported v${version}, expected v${this.panelReadiness.version})`);
            return accepted;
          }
        },
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
        SearchMusic: {
          in: {query:"s", category:"s", requestKey:"s", continuation:"s"},
          handler: ({query:raw,category,requestKey,continuation}: {query:string; category:string; requestKey:string; continuation:string}) => {
            if (!["all","songs","artists","albums"].includes(category) || requestKey.length > 64 || continuation.length > 4096) return;
            const query=raw.replace(/\s+/g," ").trim().slice(0,MAX_SEARCH_QUERY_LENGTH);
            const id=++this.searchRequestId;
            const emit=(data:object)=>{if(id===this.searchRequestId)this.definition?.emit.MusicSearchChanged(JSON.stringify({query,category,requestKey,append:Boolean(continuation),...data}));};
            if(!query){emit({status:"idle",results:[]});return;}
            emit({status:"loading"});
            void this.actions.searchMusic({query,category:category as MiniPlayerMusicCategory,continuation:continuation||null})
              .then(page=>emit({...page,status:"ready"}))
              .catch(error=>{log.error("Music search failed",error);emit({status:"error",message:"Music search failed"});});
          }
        },
        StartResultMix: {
          in:{videoId:"s"},
          handler:({videoId}:{videoId:string})=>{
            if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))return;
            const emit=(data:object)=>this.definition?.emit.MixResultChanged(JSON.stringify({videoId,...data}));
            if(this.queueBusy){emit({status:"error",message:"Another action is still running"});return;}
            this.queueBusy=true;
            emit({status:"loading"});
            void this.actions.startResultMix(videoId).then(result=>emit({...result,status:"ready"}))
              .catch(error=>{log.error("Result mix failed",error);emit({status:"error",message:error instanceof Error?error.message:"Could not start mix"});})
              .finally(()=>{this.queueBusy=false;});
          }
        },
        SearchByMode: {
          in: { query: "s", mode: "s" },
          handler: ({ query, mode }: { query: string; mode: string }) => {
            if (mode === "music" || mode === "video") this.startSearch(query, mode);
          }
        },
        AlbumBrowse: {
          in: { albumId: "s", continuation: "s" },
          handler: ({ albumId, continuation }: { albumId: string; continuation: string }) => {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(albumId) || continuation.length > 4096) return;
            const requestId = ++this.albumRequestId;
            const emit = (page: object) => {
              if (requestId === this.albumRequestId) this.definition?.emit.AlbumBrowseChanged(JSON.stringify({ albumId, ...page }));
            };
            emit({ status: "loading" });
            void this.actions
              .albumBrowse(albumId, continuation || null)
              .then(page => emit({ ...page, status: "ready" }))
              .catch(error => {
                log.error("Album browse failed", error);
                emit({ status: "error", message: "Could not load album" });
              });
          }
        },
        OpenAlbum: {
          in: { albumId: "s" },
          handler: ({ albumId }: { albumId: string }) => {
            if (/^[A-Za-z0-9_-]{1,128}$/.test(albumId)) this.actions.openAlbum(albumId);
          }
        },
        PlayNext: {
          in: { videoId: "s" },
          handler: ({ videoId }: { videoId: string }) => {
            if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
            const emit = (result: object) => this.definition?.emit.PlayNextChanged(JSON.stringify({ videoId, ...result }));
            if (this.queueBusy) {
              emit({ status: "error", message: "Another queue request is still running" });
              return;
            }
            this.queueBusy = true;
            emit({ status: "loading" });
            void this.actions
              .playNext(videoId)
              .then(result => emit({ ...result, status: "ready" }))
              .catch(error => {
                log.error("Play next failed", error);
                emit({ status: "error", message: error instanceof Error ? error.message : "Could not add next track" });
              })
              .finally(() => {
                this.queueBusy = false;
              });
          }
        },
        PlayResult: {
          in: { videoId: "s", action: "s" },
          handler: ({ videoId, action }: { videoId: string; action: string }) => {
            if (!videoId || action !== "now") return;
            this.actions.playResult(videoId);
          }
        },
        ArtistBrowse: {
          in: { artistId: "s", section: "s", continuation: "s" },
          handler: ({ artistId, section, continuation }: { artistId: string; section: string; continuation: string }) => {
            if (!BROWSE_ID_PATTERN.test(artistId)) return;
            if (!ARTIST_SECTIONS.has(section as MiniPlayerArtistSection)) return;
            if (continuation && !CONTINUATION_PATTERN.test(continuation)) return;
            this.startArtistBrowse(artistId, section as MiniPlayerArtistSection, continuation || null);
          }
        },
        OpenArtist: {
          in: { browseId: "s" },
          handler: ({ browseId }: { browseId: string }) => {
            if (!BROWSE_ID_PATTERN.test(browseId)) return;
            this.actions.openArtist(browseId);
          }
        }
      },
      signals: {
        MusicSearchChanged: {args:{resultJson:"s"}},
        MixResultChanged: {args:{resultJson:"s"}},
        StateChanged: { args: { stateJson: "s" } },
        AlbumBrowseChanged: { args: { pageJson: "s" } },
        PlayNextChanged: { args: { resultJson: "s" } },
        SearchResultsChanged: { args: { resultsJson: "s" } },
        ArtistBrowseChanged: { args: { artistBrowseJson: "s" } }
      }
    });

    this.panelReadiness.begin();
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
    this.panelReadiness.stop();
    this.searchRequestId += 1;
    this.artistRequestId += 1;
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

  private startSearch(rawQuery: string, mode: MiniPlayerSearchMode = "music") {
    const query = rawQuery.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const requestId = ++this.searchRequestId;

    if (!query) {
      this.emitSearch({ version: 1, mode, query: "", status: "idle", results: [], message: null });
      return;
    }

    this.emitSearch({ version: 1, mode, query, status: "loading", results: [], message: null });
    void this.actions
      .search(query, mode)
      .then(results => {
        if (requestId !== this.searchRequestId) return;
        this.emitSearch({
          version: 1,
          mode,
          query,
          status: "ready",
          results,
          message: results.length ? null : mode === "video" ? "No videos found" : "No songs found"
        });
      })
      .catch(error => {
        if (requestId !== this.searchRequestId) return;
        log.error("Linux mini-player search failed", error);
        this.emitSearch({
          version: 1,
          mode,
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

  // Its own request counter: the panel drops the artist view on a new search, so artist pages and
  // searches never need to invalidate each other.
  private startArtistBrowse(artistId: string, section: MiniPlayerArtistSection, continuation: string | null) {
    const requestId = ++this.artistRequestId;
    const base: Omit<MiniPlayerArtistBrowseSnapshot, "status"> = {
      version: 1,
      artistId,
      section,
      name: null,
      artworkUrl: null,
      songs: [],
      videos: [],
      songsNext: null,
      videosNext: null,
      message: null
    };

    this.emitArtistBrowse({ ...base, status: "loading" });
    void this.actions
      .artistBrowse({ artistId, section, continuation })
      .then(page => {
        if (requestId !== this.artistRequestId) return;
        const empty = !page.songs.length && !page.videos.length;
        this.emitArtistBrowse({ ...base, ...page, status: "ready", message: empty ? "Nothing found" : null });
      })
      .catch(error => {
        if (requestId !== this.artistRequestId) return;
        log.error("Linux mini-player artist browse failed", error);
        this.emitArtistBrowse({ ...base, status: "error", message: "Could not load artist" });
      });
  }

  private emitArtistBrowse(snapshot: MiniPlayerArtistBrowseSnapshot) {
    if (!this.definition) return;
    this.definition.emit.ArtistBrowseChanged(JSON.stringify(snapshot));
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
