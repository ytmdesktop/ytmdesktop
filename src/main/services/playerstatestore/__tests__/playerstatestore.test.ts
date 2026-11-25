import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LikeStatus,
  PlayerSignal,
  RepeatMode,
  VideoState,
  VideoType,
} from "~shared/playerstatestore/types";

vi.mock("electron", () => ({
  ipcMain: {
    on: vi.fn(),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../windowmanager", () => ({
  default: class MockAppWindowManager {},
}));

vi.mock("../../statemanager", () => ({
  default: class MockStateManager {},
}));

import PlayerStateStore, { type PlayerStateStoreLogger } from "..";
import { ProtectedAPI } from "../../protectedapimanager";

function createLogger(): PlayerStateStoreLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("PlayerStateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createStore(options?: { now?: () => number }) {
    const logger = createLogger();
    const stateApi = new ProtectedAPI("PlayerState", logger);
    const mainWindow = { setTitle: vi.fn() };
    const miniplayerWindow = {
      setTitle: vi.fn(),
      ipcBroadcast: vi.fn(),
    };
    const windowManager = {
      hasWindow: vi.fn(
        (name: string) => name === "Main" || name === "Miniplayer",
      ),
      getWindow: vi.fn((name: string) =>
        name === "Miniplayer" ? miniplayerWindow : mainWindow,
      ),
    };
    const stateManager = {
      updateState: vi.fn(),
    };

    const store = new PlayerStateStore().setDependencies({
      protectedApiManager: {
        createOrGetAPI: vi.fn(() => stateApi),
      },
      windowManager: windowManager as any,
      stateManager: stateManager as any,
      logger,
      now: options?.now,
    });
    store.onInitialized();

    return {
      store,
      stateApi,
      logger,
      mainWindow,
      miniplayerWindow,
      stateManager,
    };
  }

  it("stamps progressCapturedAtMs monotonically on updateVideoProgress", () => {
    let currentTime = 100;
    const { store, stateManager, miniplayerWindow } = createStore({
      now: () => currentTime,
    });
    const onStateChanged = vi.fn();
    store.on("state-changed", onStateChanged);

    store.updateVideoProgress(12.5);
    const first = store.getState();
    expect(first.videoProgress).toBe(12.5);
    expect(first.progressCapturedAtMs).toBe(100);

    currentTime = 275;
    store.updateVideoProgress(15.25);
    const second = store.getState();
    expect(second.videoProgress).toBe(15.25);
    expect(second.progressCapturedAtMs).toBe(275);
    expect(second.progressCapturedAtMs).toBeGreaterThan(
      first.progressCapturedAtMs,
    );

    expect(onStateChanged).toHaveBeenCalledTimes(2);
    expect(stateManager.updateState).toHaveBeenCalledWith({
      lastVideoId: "",
      lastPlaylistId: "",
    });
    expect(miniplayerWindow.ipcBroadcast).toHaveBeenCalledWith(
      "playerStateStore:stateChanged",
      second,
    );
  });

  it("emits PlayerSignal.TrackEnded and PlayerSignal.NewPlayback and ignores unknown signals", () => {
    const { store, logger } = createStore();
    const signalSpy = vi.fn();
    store.on("player-signal", signalSpy);

    store.emitPlayerSignal("TRACK_ENDED", "vid-123");
    expect(signalSpy).toHaveBeenNthCalledWith(1, PlayerSignal.TrackEnded);

    store.emitPlayerSignal("NEW_PLAYBACK", "vid-456");
    expect(signalSpy).toHaveBeenNthCalledWith(2, PlayerSignal.NewPlayback);

    store.emitPlayerSignal("UNKNOWN_SIGNAL" as any);
    expect(signalSpy).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "playerstatestore: ignored unknown player signal 'UNKNOWN_SIGNAL'",
    );
  });

  it("emits track-unavailable with videoId and reason", () => {
    const { store, logger } = createStore();
    const unavailableSpy = vi.fn();
    store.on("track-unavailable", unavailableSpy);

    store.trackUnavailable("vid-unplayable", "UNPLAYABLE");
    expect(unavailableSpy).toHaveBeenNthCalledWith(
      1,
      "vid-unplayable",
      "UNPLAYABLE",
    );

    store.trackUnavailable(null, 150);
    expect(unavailableSpy).toHaveBeenNthCalledWith(2, null, 150);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("wires ProtectedAPI events during onInitialized", () => {
    const { store, stateApi } = createStore({ now: () => 500 });
    const signalSpy = vi.fn();
    const unavailableSpy = vi.fn();
    const playlistCreatedSpy = vi.fn();
    const playlistDeletedSpy = vi.fn();

    store.on("player-signal", signalSpy);
    store.on("track-unavailable", unavailableSpy);
    store.on("playlist-created", playlistCreatedSpy);
    store.on("playlist-deleted", playlistDeletedSpy);

    stateApi.emit("updateVideoProgress", 42);
    expect(store.getState().videoProgress).toBe(42);
    expect(store.getState().progressCapturedAtMs).toBe(500);

    stateApi.emit("playerSignal", "TRACK_ENDED", "vid-99");
    expect(signalSpy).toHaveBeenCalledWith(PlayerSignal.TrackEnded);

    stateApi.emit("trackUnavailable", "vid-99", "LOGIN_REQUIRED");
    expect(unavailableSpy).toHaveBeenCalledWith("vid-99", "LOGIN_REQUIRED");

    stateApi.emit("playlistCreated", { title: "Mix", id: "PL1" });
    expect(playlistCreatedSpy).toHaveBeenCalledWith({
      title: "Mix",
      id: "PL1",
    });

    stateApi.emit("playlistDeleted", "PL1");
    expect(playlistDeletedSpy).toHaveBeenCalledWith("PL1");
  });

  it("warns and stays safe when initialized without ProtectedAPIManager", () => {
    const logger = createLogger();
    const store = new PlayerStateStore().setDependencies({ logger });

    expect(() => store.onInitialized()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      "playerstatestore: initialized without ProtectedAPIManager dependency",
    );
  });

  it("maps video state, details, titles, and store queue metadata", () => {
    const { store, mainWindow, miniplayerWindow } = createStore();

    store.updateVideoState(1);
    expect(store.getState().trackState).toBe(VideoState.Playing);
    store.updateVideoState(2);
    expect(store.getState().trackState).toBe(VideoState.Paused);
    store.updateVideoState(3);
    expect(store.getState().trackState).toBe(VideoState.Buffering);
    store.updateVideoState(0);
    expect(store.getState().trackState).toBe(VideoState.Unknown);

    store.updateVideoDetails(
      {
        album: "Album",
        author: "Artist",
        channelId: "ch-1",
        lengthSeconds: "180",
        thumbnail: {
          thumbnails: [{ url: "https://img", width: 64, height: 64 }],
        },
        title: "Song Title",
        videoId: "vid-1",
        isLive: false,
        musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
      },
      "pl-1",
      { id: "alb-1", text: "Album Name" },
      "LIKE",
      true,
    );

    expect(mainWindow.setTitle).toHaveBeenLastCalledWith(
      "Song Title - Artist | YTMDesktop",
    );
    expect(miniplayerWindow.setTitle).toHaveBeenLastCalledWith(
      "Song Title - Artist | YTMDesktop - Miniplayer",
    );
    expect(store.getState().videoDetails).toEqual({
      author: "Artist",
      channelId: "ch-1",
      title: "Song Title",
      album: "Album Name",
      albumId: "alb-1",
      likeStatus: LikeStatus.Like,
      thumbnails: [{ url: "https://img", width: 64, height: 64 }],
      durationSeconds: 180,
      id: "vid-1",
      videoType: VideoType.MusicAudio,
      isLive: false,
    });

    store.updateFromStore(
      {
        autoplay: true,
        isGenerating: false,
        isInfinite: false,
        repeatMode: "ALL",
        shuffleEnabled: true,
        automixItems: [],
        items: [
          {
            playlistPanelVideoRenderer: null,
            playlistPanelVideoWrapperRenderer: {
              primaryRenderer: {
                playlistPanelVideoRenderer: {
                  videoId: "vid-1",
                  selected: true,
                  title: { runs: [{ text: "Song Title" }] },
                  shortBylineText: { runs: [{ text: "Artist" }] },
                  lengthText: { runs: [{ text: "3:00" }] },
                  thumbnail: { thumbnails: [] },
                },
              },
              counterpart: [],
            },
          },
        ],
      },
      "DISLIKE",
      75,
      false,
      true,
    );

    const updated = store.getState();
    expect(updated.adPlaying).toBe(true);
    expect(updated.muted).toBe(false);
    expect(updated.volume).toBe(75);
    expect(updated.videoDetails?.likeStatus).toBe(LikeStatus.Dislike);
    expect(updated.queue?.repeatMode).toBe(RepeatMode.All);
    expect(updated.queue?.selectedItemIndex).toBe(0);
  });
});
