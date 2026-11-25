import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ytmhook", () => ({
  default: {},
}));

vi.mock("../protectedapimanager", () => ({
  default: {
    createOrGetAPI: vi.fn(),
  },
}));

import { createTrackLifecycleTracker } from "../playerstatestore";

describe("createTrackLifecycleTracker", () => {
  it("emits TRACK_ENDED once for Playing -> Ended when not playing an ad", () => {
    const tracker = createTrackLifecycleTracker();

    expect(
      tracker.onStateChange(1, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();

    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });

    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();
  });

  it("emits TRACK_ENDED once for Paused -> Ended and blocks duplicate Paused -> Ended for same videoId", () => {
    const tracker = createTrackLifecycleTracker();

    expect(
      tracker.onStateChange(2, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();

    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });

    expect(
      tracker.onStateChange(2, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();
  });

  it("does not emit TRACK_ENDED from Unstarted or Buffering", () => {
    const tracker = createTrackLifecycleTracker();

    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();

    expect(
      tracker.onStateChange(3, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toBeNull();
  });

  it("suppresses TRACK_ENDED while adPlaying is true or videoId is missing", () => {
    const tracker = createTrackLifecycleTracker();

    tracker.onStateChange(1, { currentVideoId: "vid-1", adPlaying: true });
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: true }),
    ).toBeNull();

    tracker.onStateChange(1, { currentVideoId: null, adPlaying: false });
    expect(
      tracker.onStateChange(0, { currentVideoId: null, adPlaying: false }),
    ).toBeNull();

    tracker.onStateChange(1, { currentVideoId: "vid-1", adPlaying: false });
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });
  });

  it("resets ended tracking on Playing state or newdata onVideoDataChange", () => {
    const tracker = createTrackLifecycleTracker();

    tracker.onStateChange(1, { currentVideoId: "vid-1", adPlaying: false });
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });

    tracker.onStateChange(1, { currentVideoId: "vid-1", adPlaying: false });
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });

    expect(
      tracker.onVideoDataChange({ playertype: 1, type: "newdata" }),
    ).toEqual({
      emitNewPlayback: true,
      shouldSendVideoData: false,
    });

    tracker.onStateChange(2, { currentVideoId: "vid-1", adPlaying: false });
    expect(
      tracker.onStateChange(0, { currentVideoId: "vid-1", adPlaying: false }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-1",
    });
  });

  it("handles onVideoDataChange playertype and data event filtering", () => {
    const tracker = createTrackLifecycleTracker();

    expect(
      tracker.onVideoDataChange({ playertype: 2, type: "newdata" }),
    ).toEqual({
      emitNewPlayback: false,
      shouldSendVideoData: false,
    });

    expect(
      tracker.onVideoDataChange({ playertype: 1, type: "dataloaded" }),
    ).toEqual({
      emitNewPlayback: false,
      shouldSendVideoData: true,
    });

    expect(
      tracker.onVideoDataChange({ playertype: 1, type: "dataupdated" }),
    ).toEqual({
      emitNewPlayback: false,
      shouldSendVideoData: true,
    });
  });

  it("uses hydrated initial state to detect immediate transition to Ended", () => {
    const tracker = createTrackLifecycleTracker();
    tracker.setHydratedState(1);

    expect(
      tracker.onStateChange(0, {
        currentVideoId: "vid-hydrated",
        adPlaying: false,
      }),
    ).toEqual({
      type: "TRACK_ENDED",
      videoId: "vid-hydrated",
    });
  });

  it("detects UNPLAYABLE, LOGIN_REQUIRED, and ERROR playability statuses", () => {
    const tracker = createTrackLifecycleTracker();

    for (const status of ["UNPLAYABLE", "LOGIN_REQUIRED", "ERROR"]) {
      expect(
        tracker.checkPlayabilityStatus(
          {
            playabilityStatus: { status },
            videoDetails: { videoId: "vid-bad" },
          },
          "vid-fallback",
        ),
      ).toEqual({
        type: "TRACK_UNAVAILABLE",
        videoId: "vid-bad",
        reason: status,
      });
    }

    expect(
      tracker.checkPlayabilityStatus(
        { playabilityStatus: { status: "UNPLAYABLE" } },
        "vid-fallback",
      ),
    ).toEqual({
      type: "TRACK_UNAVAILABLE",
      videoId: "vid-fallback",
      reason: "UNPLAYABLE",
    });

    expect(
      tracker.checkPlayabilityStatus(
        {
          playabilityStatus: { status: "OK" },
          videoDetails: { videoId: "ok" },
        },
        null,
      ),
    ).toBeNull();

    expect(tracker.checkPlayabilityStatus(null, "vid-fallback")).toBeNull();
  });

  it("maps onError events to TRACK_UNAVAILABLE signals", () => {
    const tracker = createTrackLifecycleTracker();

    expect(tracker.onError(150, "vid-err")).toEqual({
      type: "TRACK_UNAVAILABLE",
      videoId: "vid-err",
      reason: 150,
    });

    expect(tracker.onError("MEDIA_ERR_SRC_NOT_SUPPORTED", null)).toEqual({
      type: "TRACK_UNAVAILABLE",
      videoId: null,
      reason: "MEDIA_ERR_SRC_NOT_SUPPORTED",
    });
  });
});

describe("ytmview playerstatestore init & waitForYTMPlayerApiReady", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("hydrates state, forwards player events, store updates, and playlist actions", async () => {
    vi.resetModules();
    const posted: Array<{ name: string; args: unknown[] }> = [];
    const playerListeners = new Map<string, ((...a: any[]) => void)[]>();
    const storeSubscribers: Array<() => void> = [];
    const windowListeners = new Map<string, ((e: any) => void)[]>();

    let ready = false;
    const playerApi = {
      isReady: vi.fn(() => ready),
      getProgressState: vi.fn(() => ({ current: 12 })),
      getPlayerState: vi.fn(() => 1),
      getPlaylistId: vi.fn(() => "PL-1"),
      getPlayerResponse: vi.fn(() => ({
        playabilityStatus: { status: "OK" },
        videoDetails: { videoId: "vid-1", title: "Base Title" },
      })),
      addEventListener: vi.fn((ev: string, fn: (...a: any[]) => void) => {
        const list = playerListeners.get(ev) ?? [];
        list.push(fn);
        playerListeners.set(ev, list);
      }),
    };

    const ytmStore = {
      getState: vi.fn(() => ({
        playerPage: {
          playerOverlay: {
            playerOverlayRenderer: {
              actions: [{ likeButtonRenderer: { likeStatus: "LIKE" } }],
            },
          },
        },
        likeStatus: { videos: {} },
        player: { volume: 70, adPlaying: false, muted: false },
        queue: {
          items: [
            {
              playlistPanelVideoRenderer: {
                selected: true,
                videoId: "vid-1",
                title: { runs: [{ text: "Full Track Title" }] },
                thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/1.jpg" }] },
                longBylineText: {
                  runs: [
                    {
                      text: "Album Name",
                      navigationEndpoint: {
                        browseEndpoint: {
                          browseId: "MPREb_1",
                          browseEndpointContextSupportedConfigs: {
                            browseEndpointContextMusicConfig: {
                              pageType: "MUSIC_PAGE_TYPE_ALBUM",
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      })),
      subscribe: vi.fn((fn: () => void) => storeSubscribers.push(fn)),
    };

    vi.doMock("../ytmhook", () => ({
      default: {
        ytmStateStore: { store: ytmStore },
        ytmPlayerController: { playerApi },
      },
    }));
    vi.doMock("../protectedapimanager", () => ({
      default: {
        createOrGetAPI: vi.fn(() => ({
          postMessage: vi.fn((name: string, ...args: unknown[]) =>
            posted.push({ name, args }),
          ),
        })),
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: vi.fn((ev: string, fn: (e: any) => void) => {
        const list = windowListeners.get(ev) ?? [];
        list.push(fn);
        windowListeners.set(ev, list);
      }),
    });

    const mod = await import("../playerstatestore");
    mod.default();

    expect(posted.some((m) => m.name === "updateFromStore")).toBe(true);
    expect(posted.some((m) => m.name === "updateVideoDetails")).toBe(true);
    expect(posted.some((m) => m.name === "updateVideoProgress")).toBe(true);
    expect(posted.some((m) => m.name === "updateVideoState")).toBe(true);

    for (const fn of playerListeners.get("onVideoProgress") ?? []) fn(25);
    for (const fn of playerListeners.get("onStateChange") ?? []) fn(0);
    for (const fn of playerListeners.get("onError") ?? []) fn(150);
    for (const fn of playerListeners.get("onVideoDataChange") ?? []) {
      fn({ playertype: 1, type: "newdata" });
      fn({ playertype: 1, type: "dataloaded" });
    }
    for (const fn of storeSubscribers) fn();

    expect(posted.some((m) => m.name === "trackUnavailable")).toBe(true);
    expect(
      posted.some(
        (m) => m.name === "playerSignal" && m.args[0] === "TRACK_ENDED",
      ),
    ).toBe(true);
    expect(
      posted.some(
        (m) => m.name === "playerSignal" && m.args[0] === "NEW_PLAYBACK",
      ),
    ).toBe(true);

    // Playlist create/delete window yt-action events
    for (const fn of windowListeners.get("yt-action") ?? []) {
      fn({
        detail: {
          actionName: "yt-service-request",
          args: [null, { createPlaylistServiceEndpoint: true }, { create_playlist_title: "New PL" }],
          returnValue: [{ ajaxPromise: Promise.resolve({ data: { playlistId: "PL-NEW" } }) }],
        },
      });
      fn({
        detail: {
          actionName: "yt-handle-playlist-deletion-command",
          args: [{ handlePlaylistDeletionCommand: { playlistId: "PL-DEL" } }],
        },
      });
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(posted.some((m) => m.name === "playlistCreated")).toBe(true);
    expect(posted.some((m) => m.name === "playlistDeleted")).toBe(true);

    // waitForYTMPlayerApiReady resolves once isReady() flips true
    vi.useFakeTimers();
    const readyPromise = mod.waitForYTMPlayerApiReady();
    ready = true;
    await vi.advanceTimersByTimeAsync(250);
    await expect(readyPromise).resolves.toBeUndefined();
  });
});
