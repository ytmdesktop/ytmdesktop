import { describe, expect, it, vi } from "vitest";
import setupListenTogether, {
  AD_END_DEBOUNCE_MS,
  createAdObserver,
  extractAutoplayCandidatesFromNext,
  extractQueueCandidateFromResponse,
  extractQuickAddTargetFromEndpoint,
  extractQuickAddTargetFromRenderer,
  parseDurationTextToSec,
  shouldBlockHistoryTraversal,
} from "../setup/listentogether";

describe("listentogether pure helpers", () => {
  describe("parseDurationTextToSec", () => {
    it("parses M:SS and H:MM:SS formats", () => {
      expect(parseDurationTextToSec("0:45")).toBe(45);
      expect(parseDurationTextToSec("3:05")).toBe(185);
      expect(parseDurationTextToSec(" 12:34 ")).toBe(754);
      expect(parseDurationTextToSec("1:02:03")).toBe(3723);
    });

    it("rejects live, zero, malformed, and out-of-range durations", () => {
      expect(parseDurationTextToSec("")).toBeNull();
      expect(parseDurationTextToSec("LIVE")).toBeNull();
      expect(parseDurationTextToSec("--:--")).toBeNull();
      expect(parseDurationTextToSec("0:00")).toBeNull();
      expect(parseDurationTextToSec("1:60")).toBeNull();
      expect(parseDurationTextToSec("1:60:00")).toBeNull();
      expect(parseDurationTextToSec("-1:30")).toBeNull();
      expect(parseDurationTextToSec("45")).toBeNull();
      expect(parseDurationTextToSec("1:2:3:4")).toBeNull();
    });
  });

  describe("extractQueueCandidateFromResponse", () => {
    it("extracts metadata from wrapped playlistPanelVideoWrapperRenderer in queueDatas", () => {
      const response = {
        queueDatas: [
          {
            content: {
              playlistPanelVideoWrapperRenderer: {
                primaryRenderer: {
                  playlistPanelVideoRenderer: {
                    videoId: "dQw4w9WgXcQ",
                    title: { runs: [{ text: "Never Gonna Give You Up" }] },
                    longBylineText: {
                      runs: [
                        { text: "Rick Astley" },
                        { text: " • " },
                        { text: "Whenever You Need Somebody" },
                      ],
                    },
                    lengthText: { runs: [{ text: "3:33" }] },
                    thumbnail: {
                      thumbnails: [
                        {
                          url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg",
                          width: 120,
                          height: 90,
                        },
                        {
                          url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                          width: 480,
                          height: 360,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      };

      expect(extractQueueCandidateFromResponse(response)).toEqual({
        videoId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        author: "Rick Astley",
        durationSec: 213,
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      });
    });

    it("rejects live streams and unplayable items", () => {
      expect(
        extractQueueCandidateFromResponse({
          playlistPanelVideoRenderer: {
            videoId: "dQw4w9WgXcQ",
            isLive: true,
            title: { simpleText: "Live Stream" },
            lengthText: { simpleText: "LIVE" },
          },
        }),
      ).toBeNull();

      expect(
        extractQueueCandidateFromResponse({
          playlistPanelVideoRenderer: {
            videoId: "dQw4w9WgXcQ",
            title: { simpleText: "Blocked Song" },
            lengthText: { simpleText: "3:00" },
            unplayableText: { runs: [{ text: "Video unavailable" }] },
          },
        }),
      ).toBeNull();

      expect(
        extractQueueCandidateFromResponse({
          playabilityStatus: { status: "UNPLAYABLE" },
          playlistPanelVideoRenderer: {
            videoId: "dQw4w9WgXcQ",
            title: { simpleText: "Song" },
            lengthText: { simpleText: "3:00" },
          },
        }),
      ).toBeNull();
    });

    it("normalizes protocol-relative URLs and falls back to ytimg hqdefault when thumbnail is missing or untrusted", () => {
      const longTitle = "T".repeat(250);
      const longAuthor = "A".repeat(150);
      const result = extractQueueCandidateFromResponse({
        playlistPanelVideoRenderer: {
          videoId: "abcDEF12345",
          title: { simpleText: longTitle },
          shortBylineText: { simpleText: longAuthor },
          lengthText: { simpleText: "2:10" },
          thumbnail: {
            thumbnails: [
              {
                url: "https://evil.example.com/pic.jpg",
                width: 500,
                height: 500,
              },
            ],
          },
        },
      });

      expect(result).toEqual({
        videoId: "abcDEF12345",
        title: "T".repeat(200),
        author: "A".repeat(120),
        durationSec: 130,
        thumbnailUrl: "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
      });

      const protoRelative = extractQueueCandidateFromResponse({
        playlistPanelVideoRenderer: {
          videoId: "dQw4w9WgXcQ",
          title: { simpleText: "Song" },
          subtitle: { simpleText: "Artist Fallback" },
          lengthText: { simpleText: "3:00" },
          thumbnail: {
            thumbnails: [
              {
                url: "//lh3.googleusercontent.com/cover-art=w226-h226",
                width: 226,
                height: 226,
              },
            ],
          },
        },
      });

      expect(protoRelative).toEqual({
        videoId: "dQw4w9WgXcQ",
        title: "Song",
        author: "Artist Fallback",
        durationSec: 180,
        thumbnailUrl: "https://lh3.googleusercontent.com/cover-art=w226-h226",
      });
    });
  });

  describe("extractAutoplayCandidatesFromNext", () => {
    it("extracts deduplicated music candidates up to limit and excludes podcasts/live", () => {
      const nextResponse = {
        contents: {
          singleColumnMusicWatchNextResultsRenderer: {
            tabbedRenderer: {
              watchNextTabbedResultsRenderer: {
                tabs: [
                  {
                    tabRenderer: {
                      content: {
                        musicQueueRenderer: {
                          content: {
                            playlistPanelRenderer: {
                              contents: [
                                {
                                  playlistPanelVideoRenderer: {
                                    videoId: "podCast1234",
                                    title: { simpleText: "Podcast Ep" },
                                    shortBylineText: {
                                      simpleText: "Podcaster",
                                    },
                                    lengthText: { simpleText: "45:00" },
                                    navigationEndpoint: {
                                      watchEndpoint: {
                                        watchEndpointMusicSupportedConfigs: {
                                          watchEndpointMusicConfig: {
                                            musicVideoType:
                                              "MUSIC_VIDEO_TYPE_PODCAST_EPISODE",
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                                {
                                  playlistPanelVideoRenderer: {
                                    videoId: "songOne1234",
                                    title: { simpleText: "Song One" },
                                    shortBylineText: { simpleText: "Artist 1" },
                                    lengthText: { simpleText: "3:20" },
                                    navigationEndpoint: {
                                      watchEndpoint: {
                                        watchEndpointMusicSupportedConfigs: {
                                          watchEndpointMusicConfig: {
                                            musicVideoType:
                                              "MUSIC_VIDEO_TYPE_ATV",
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                                {
                                  playlistPanelVideoRenderer: {
                                    videoId: "songOne1234",
                                    title: { simpleText: "Song One Duplicate" },
                                    shortBylineText: { simpleText: "Artist 1" },
                                    lengthText: { simpleText: "3:20" },
                                  },
                                },
                                {
                                  playlistPanelVideoWrapperRenderer: {
                                    primaryRenderer: {
                                      playlistPanelVideoRenderer: {
                                        videoId: "songTwo1234",
                                        title: { simpleText: "Song Two" },
                                        shortBylineText: {
                                          simpleText: "Artist 2",
                                        },
                                        lengthText: { simpleText: "4:00" },
                                      },
                                    },
                                  },
                                },
                                {
                                  playlistPanelVideoRenderer: {
                                    videoId: "songThree12",
                                    title: { simpleText: "Song Three" },
                                    shortBylineText: { simpleText: "Artist 3" },
                                    lengthText: { simpleText: "2:50" },
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      };

      const candidates = extractAutoplayCandidatesFromNext(nextResponse, 2);
      expect(candidates).toHaveLength(2);
      expect(candidates.map((c) => c.videoId)).toEqual([
        "songOne1234",
        "songTwo1234",
      ]);
    });
  });

  describe("createAdObserver (Rule 0 750ms debounce)", () => {
    it("debounces true->false by 750ms and cancels if Ad 2 begins", () => {
      vi.useFakeTimers();
      try {
        const onAdStarted = vi.fn();
        const onAdBreakEnded = vi.fn();
        const observer = createAdObserver({ onAdStarted, onAdBreakEnded });

        observer.onAdStateUpdate(true);
        expect(onAdStarted).toHaveBeenCalledTimes(1);
        expect(observer.isInAdBreak()).toBe(true);

        // Ad 1 finishes -> debounce starts
        observer.onAdStateUpdate(false);
        vi.advanceTimersByTime(AD_END_DEBOUNCE_MS - 100);
        expect(onAdBreakEnded).not.toHaveBeenCalled();

        // Ad 2 starts before 750ms expires -> timer cancelled, no duplicate adStarted
        observer.onAdStateUpdate(true);
        vi.advanceTimersByTime(200);
        expect(onAdBreakEnded).not.toHaveBeenCalled();
        expect(onAdStarted).toHaveBeenCalledTimes(1);

        // Ad 2 finishes -> full 750ms debounce runs
        observer.onAdStateUpdate(false);
        vi.advanceTimersByTime(AD_END_DEBOUNCE_MS - 1);
        expect(onAdBreakEnded).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onAdBreakEnded).toHaveBeenCalledTimes(1);
        expect(observer.isInAdBreak()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("shouldBlockHistoryTraversal", () => {
    it("blocks /watch destinations when locked and allows browse/search or unlocked", () => {
      expect(
        shouldBlockHistoryTraversal(
          "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
          true,
        ),
      ).toBe(true);
      expect(
        shouldBlockHistoryTraversal(
          "https://music.youtube.com/search?q=test",
          true,
        ),
      ).toBe(false);
      expect(
        shouldBlockHistoryTraversal(
          "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
          true,
          "local",
        ),
      ).toBe(false);
      expect(
        shouldBlockHistoryTraversal(
          "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
          false,
        ),
      ).toBe(false);
    });
  });

  describe("setupListenTogether DI hooks and diagnostics", () => {
    function createSetupHarness(
      options: {
        adPlaying?: boolean;
        initialMuted?: boolean;
        currentTime?: number;
        ytcfgValues?: Record<string, unknown> | null;
        fetchFn?: typeof fetch;
        videoElement?: { paused: boolean; play: () => Promise<unknown> } | null;
        ytmusicAppElement?: { dispatchEvent: (event: Event) => boolean } | null;
        mediaElementPlay?: (...args: unknown[]) => unknown;
        timers?: {
          setTimeout: (
            fn: () => void,
            ms: number,
          ) => ReturnType<typeof setTimeout>;
          clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
        };
        forwardViewLogs?: boolean;
      } = {},
    ) {
      const windowListeners = new Map<
        string,
        Array<{ fn: (event: any) => void; capture: boolean }>
      >();
      const handlers = new Map<string, (event: any) => Promise<unknown[]>>();
      const posted: Array<{ name: string; args: unknown[] }> = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const fakeApi = {
        postMessage: (name: string, ...args: unknown[]) => {
          posted.push({ name, args });
        },
        handleMessage: (
          name: string,
          handler: (event: any) => Promise<unknown[]>,
        ) => {
          handlers.set(name, handler);
        },
      };

      let adPlaying = options.adPlaying ?? false;
      const storeSubscribers = new Set<() => void>();
      const dispatchedActions: unknown[] = [];
      const fakeStore = {
        getState: () => ({ player: { adPlaying } }),
        dispatch: vi.fn((action: unknown) => {
          dispatchedActions.push(action);
        }),
        subscribe: (fn: () => void) => {
          storeSubscribers.add(fn);
          return () => storeSubscribers.delete(fn);
        },
      };

      let muted = options.initialMuted ?? false;
      let currentTime = options.currentTime ?? 0;
      let playerResponse: Record<string, unknown> = {
        videoDetails: { videoId: "dQw4w9WgXcQ" },
        playabilityStatus: { status: "OK" },
      };
      const playerEventListeners = new Map<
        string,
        Array<(payload: any) => void>
      >();

      const origIsMuted = vi.fn(() => muted);
      const origMute = vi.fn(() => {
        muted = true;
      });
      const origUnMute = vi.fn(() => {
        muted = false;
      });
      const origLoadVideoById = vi.fn();
      const origLoadVideoByPlayerVars = vi.fn();
      const origPauseVideo = vi.fn();
      const origPlayVideo = vi.fn();
      const origSeekTo = vi.fn((sec: number) => {
        currentTime = sec;
      });
      const origPlayerNextVideo = vi.fn();
      const origPlayerPreviousVideo = vi.fn();

      const fakePlayerApi = {
        isMuted: origIsMuted,
        mute: origMute,
        unMute: origUnMute,
        loadVideoById: origLoadVideoById,
        loadVideoByPlayerVars: origLoadVideoByPlayerVars,
        pauseVideo: origPauseVideo,
        playVideo: origPlayVideo,
        seekTo: origSeekTo,
        nextVideo: origPlayerNextVideo,
        previousVideo: origPlayerPreviousVideo,
        getCurrentTime: () => currentTime,
        getPlayerResponse: () => playerResponse,
        addEventListener: vi.fn((name: string, fn: (payload: any) => void) => {
          const list = playerEventListeners.get(name) ?? [];
          list.push(fn);
          playerEventListeners.set(name, list);
        }),
      };

      const origCtrlNextVideo = vi.fn();
      const origCtrlPreviousVideo = vi.fn();
      const fakeController = {
        nextVideo: origCtrlNextVideo,
        previousVideo: origCtrlPreviousVideo,
        playerApi: fakePlayerApi,
      };

      const registeredMediaHandlers = new Map<
        string,
        MediaSessionActionHandler | null
      >();
      const origSetActionHandler = vi.fn(
        (action: string, handler: MediaSessionActionHandler | null) => {
          registeredMediaHandlers.set(action, handler);
        },
      );
      const fakeMediaSession = {
        setActionHandler: origSetActionHandler,
      };

      const origMediaPlay = vi.fn(
        options.mediaElementPlay ?? (() => Promise.resolve()),
      );
      const fakeMediaElementProto = {
        play: origMediaPlay,
      };

      const avToggleEl = {
        attrs: new Map<string, string>(),
        style: { pointerEvents: "" },
        setAttribute(k: string, v: string) {
          this.attrs.set(k, v);
        },
        removeAttribute(k: string) {
          this.attrs.delete(k);
        },
      };

      const ytcfgValues =
        options.ytcfgValues === undefined
          ? { INNERTUBE_CONTEXT: { client: {} }, INNERTUBE_API_KEY: "api-key" }
          : options.ytcfgValues;

      const fakeWindow = {
        addEventListener: vi.fn((type: string, fn: any, opts?: any) => {
          const capture =
            typeof opts === "boolean" ? opts : Boolean(opts?.capture);
          const list = windowListeners.get(type) ?? [];
          list.push({ fn, capture });
          windowListeners.set(type, list);
        }),
        removeEventListener: vi.fn((type: string, fn: any, opts?: any) => {
          const capture =
            typeof opts === "boolean" ? opts : Boolean(opts?.capture);
          const list = windowListeners.get(type) ?? [];
          windowListeners.set(
            type,
            list.filter((item) => item.fn !== fn || item.capture !== capture),
          );
        }),
        ytcfg: ytcfgValues
          ? { get: (key: string) => ytcfgValues[key] }
          : undefined,
      };

      const handle = setupListenTogether({
        listenTogetherApi: fakeApi as any,
        ytmStore: fakeStore as any,
        ytmPlayerController: fakeController as any,
        windowObj: fakeWindow as any,
        documentObj: {
          querySelector: (selector: string) => {
            if (selector === "video") {
              return (options.videoElement ?? null) as any;
            }
            if (selector === "ytmusic-app") {
              return (options.ytmusicAppElement ?? null) as any;
            }
            return null;
          },
          querySelectorAll: (selector: string) =>
            (selector === "ytmusic-av-toggle" ? [avToggleEl] : []) as any,
        },
        fetchFn:
          options.fetchFn ??
          vi.fn(async () => ({ ok: false, status: 503 }) as Response),
        mediaSession: fakeMediaSession as any,
        mediaElementProto: fakeMediaElementProto,
        timers: options.timers,
        logger,
        forwardViewLogs: options.forwardViewLogs,
      });

      const invoke = async <T = unknown>(
        name: string,
        ...args: unknown[]
      ): Promise<T> => {
        const handler = handlers.get(name);
        if (!handler) {
          throw new Error(`Missing handler ${name}`);
        }
        const [result] = await handler({ detail: { args } });
        return result as T;
      };

      const dispatchWindowEvent = (type: string, detailOrEvent: any) => {
        const event = {
          preventDefault: vi.fn(),
          stopImmediatePropagation: vi.fn(),
          ...detailOrEvent,
        };
        for (const entry of windowListeners.get(type) ?? []) {
          entry.fn(event);
        }
        return event;
      };

      return {
        handle,
        posted,
        logger,
        windowListeners,
        fakeWindow,
        fakeStore,
        dispatchedActions,
        storeSubscribers,
        fakePlayerApi,
        fakeController,
        fakeMediaSession,
        registeredMediaHandlers,
        fakeMediaElementProto,
        avToggleEl,
        playerEventListeners,
        invoke,
        dispatchWindowEvent,
        setAdPlaying: (value: boolean) => {
          adPlaying = value;
          for (const sub of storeSubscribers) sub();
        },
        setPlayerResponse: (next: Record<string, unknown>) => {
          playerResponse = next;
        },
        setCurrentTime: (next: number) => {
          currentTime = next;
        },
        isMutedState: () => muted,
        originals: {
          origIsMuted,
          origMute,
          origUnMute,
          origLoadVideoById,
          origLoadVideoByPlayerVars,
          origPauseVideo,
          origPlayVideo,
          origSeekTo,
          origPlayerNextVideo,
          origPlayerPreviousVideo,
          origCtrlNextVideo,
          origCtrlPreviousVideo,
          origSetActionHandler,
          origMediaPlay,
        },
      };
    }

    it("preserves Redux queue (does not dispatch CLEAR), mutes during barrier, unmutes on syncPlayback('play'), and ignores self-caused yt-navigate", async () => {
      const h = createSetupHarness({ initialMuted: false, currentTime: 0 });
      try {
        h.originals.origLoadVideoById.mockImplementation(() => {
          const selfNav = h.dispatchWindowEvent("yt-navigate", {
            detail: { endpoint: { watchEndpoint: { videoId: "dQw4w9WgXcQ" } } },
          });
          expect(selfNav.preventDefault).not.toHaveBeenCalled();
          expect(selfNav.stopImmediatePropagation).not.toHaveBeenCalled();
        });

        await h.invoke("setSessionLock", {
          locked: true,
          isHost: false,
          currentRoomVideoId: null,
        });
        expect(h.avToggleEl.attrs.get("disabled")).toBeUndefined();

        const loadRes = await h.invoke("loadExactVideo", {
          videoId: "dQw4w9WgXcQ",
          startPosSec: 12,
          pausedForBarrier: true,
        });
        expect(loadRes).toEqual({ ok: true, deferredForAd: false });
        expect(h.dispatchedActions).not.toContainEqual({ type: "CLEAR" });
        expect(h.originals.origMute).toHaveBeenCalledTimes(1);
        expect(h.isMutedState()).toBe(true);
        expect(h.originals.origLoadVideoById).toHaveBeenCalledWith(
          "dQw4w9WgXcQ",
          12,
        );
        expect(h.originals.origPauseVideo).toHaveBeenCalledTimes(1);
        expect(h.posted).toEqual([]);

        // Playing state during barrier re-pauses while awaitingSyncAnchor is active
        for (const fn of h.playerEventListeners.get("onStateChange") ?? []) {
          fn(1);
        }
        expect(h.originals.origPauseVideo).toHaveBeenCalledTimes(2);

        // Track ready emits when player response matches expected video
        for (const fn of h.playerEventListeners.get("onVideoDataChange") ??
          []) {
          fn({ playertype: 1, type: "dataloaded" });
        }
        expect(h.posted).toContainEqual({
          name: "trackReady",
          args: [{ videoId: "dQw4w9WgXcQ" }],
        });

        // syncPlayback("play") unmutes, seeks if outside 0.35s tolerance, and plays
        const syncRes = await h.invoke("syncPlayback", {
          action: "play",
          posSec: 15,
        });
        expect(syncRes).toEqual({ ok: true });
        expect(h.originals.origUnMute).toHaveBeenCalledTimes(1);
        expect(h.isMutedState()).toBe(false);
        expect(h.originals.origSeekTo).toHaveBeenCalledWith(15);
        expect(h.originals.origPlayVideo).toHaveBeenCalledTimes(1);
      } finally {
        h.handle.cleanup();
      }
    });

    it("preserves user pre-existing mute across loadExactVideo barrier and syncPlayback", async () => {
      const h = createSetupHarness({ initialMuted: true });
      try {
        await h.invoke("setSessionLock", { locked: true, isHost: false });
        await h.invoke("loadExactVideo", {
          videoId: "dQw4w9WgXcQ",
          startPosSec: 0,
        });
        expect(h.originals.origMute).not.toHaveBeenCalled();

        await h.invoke("syncPlayback", { action: "play", posSec: 0 });
        expect(h.originals.origUnMute).not.toHaveBeenCalled();
        expect(h.isMutedState()).toBe(true);
      } finally {
        h.handle.cleanup();
      }
    });

    it("suppresses YTM auto-advance at end of room track instead of routing to local mode", async () => {
      const h = createSetupHarness({ initialMuted: false, currentTime: 0 });
      try {
        await h.invoke("setSessionLock", {
          locked: true,
          isHost: true,
          currentRoomVideoId: "dQw4w9WgXcQ",
        });

        // Simulate track finishing (onStateChange(0)) then YTM auto-advancing to another video
        for (const fn of h.playerEventListeners.get("onStateChange") ?? []) {
          fn(0);
        }
        h.setPlayerResponse({
          videoDetails: {
            videoId: "9bZkp7q19f0",
            title: "Auto Next",
            author: "YTM",
            lengthSeconds: "200",
          },
          playabilityStatus: { status: "OK" },
        });
        for (const fn of h.playerEventListeners.get("onVideoDataChange") ??
          []) {
          fn({ playertype: 1, type: "dataloaded" });
        }

        expect(
          h.posted.some((m) => m.name === "localPlaybackStarted"),
        ).toBe(false);
        expect(h.originals.origPauseVideo).toHaveBeenCalled();
      } finally {
        h.handle.cleanup();
      }
    });

    it("allows clicking tracks and playlists to play locally without blocking and resolves local metadata", async () => {
      const fetchFn = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          queueDatas: [
            {
              content: {
                playlistPanelVideoWrapperRenderer: {
                  primaryRenderer: {
                    playlistPanelVideoRenderer: {
                      videoId: "9bZkp7q19f0",
                      title: { simpleText: "Gangnam Style" },
                      shortBylineText: { simpleText: "PSY" },
                      lengthText: { simpleText: "3:39" },
                    },
                  },
                },
              },
            },
          ],
        }),
      })) as unknown as typeof fetch;

      const h = createSetupHarness({ fetchFn });
      try {
        expect(h.windowListeners.get("yt-navigate")?.[0]?.capture).toBe(true);

        await h.invoke("setSessionLock", { locked: true, isHost: false });

        // watchPlaylistEndpoint -> allowed through (no preventDefault), enters local playback mode
        const playlistEvent = h.dispatchWindowEvent("yt-navigate", {
          detail: {
            endpoint: { watchPlaylistEndpoint: { playlistId: "PL1" } },
          },
        });
        expect(playlistEvent.preventDefault).not.toHaveBeenCalled();
        expect(playlistEvent.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(h.posted).toContainEqual({
          name: "localPlaybackStarted",
          args: [{ kind: "playlist", playlistId: "PL1", videoId: null }],
        });

        // Re-lock to room mode, then click a watchEndpoint -> allowed through and enters local mode
        await h.invoke("setSessionLock", {
          locked: true,
          isHost: false,
          listeningMode: "room",
        });
        h.posted.length = 0;

        const watchEvent = h.dispatchWindowEvent("yt-navigate", {
          detail: {
            endpoint: { watchEndpoint: { videoId: "9bZkp7q19f0" } },
          },
        });
        expect(watchEvent.preventDefault).not.toHaveBeenCalled();
        expect(watchEvent.stopImmediatePropagation).not.toHaveBeenCalled();
        expect(h.posted).toContainEqual({
          name: "localPlaybackStarted",
          args: [{ kind: "track", videoId: "9bZkp7q19f0", playlistId: null }],
        });
        await vi.waitFor(() => {
          expect(h.posted).toContainEqual({
            name: "localTrackMetaResolved",
            args: [
              {
                videoId: "9bZkp7q19f0",
                title: "Gangnam Style",
                author: "PSY",
                durationSec: 219,
                thumbnailUrl:
                  "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
              },
            ],
          });
        });

        // Native player calls pass right through when in local listening mode
        h.fakePlayerApi.playVideo();
        h.fakePlayerApi.pauseVideo();
        expect(h.originals.origPlayVideo).toHaveBeenCalledTimes(1);
        expect(h.originals.origPauseVideo).toHaveBeenCalledTimes(1);
      } finally {
        h.handle.cleanup();
      }
    });

    it("enters local listening mode on first playerApi.loadVideoByPlayerVars and onVideoDataChange user switch without reloading room track, and forwards logs when enabled", async () => {
      const h1 = createSetupHarness({ forwardViewLogs: true });
      try {
        await h1.invoke("setSessionLock", {
          locked: true,
          isHost: true,
          currentRoomVideoId: "dQw4w9WgXcQ",
          listeningMode: "room",
        });
        h1.posted.length = 0;

        (h1.fakePlayerApi as any).loadVideoByPlayerVars({
          videoId: "9bZkp7q19f0",
          list: "PLLocal99",
        });
        expect(h1.originals.origLoadVideoByPlayerVars).toHaveBeenCalledWith({
          videoId: "9bZkp7q19f0",
          list: "PLLocal99",
        });
        expect(h1.posted).toContainEqual({
          name: "localPlaybackStarted",
          args: [{ kind: "track", videoId: "9bZkp7q19f0", playlistId: "PLLocal99" }],
        });
        expect(
          h1.posted.some((p) => p.name === "ytmViewLog"),
        ).toBe(true);
      } finally {
        h1.handle.cleanup();
      }

      // Now test onVideoDataChange switching directly to a different video after room track was already settled
      const h2 = createSetupHarness({ forwardViewLogs: true });
      try {
        await h2.invoke("setSessionLock", {
          locked: true,
          isHost: true,
          currentRoomVideoId: null,
          listeningMode: "room",
        });
        await h2.invoke("loadExactVideo", {
          videoId: "dQw4w9WgXcQ",
          startPosSec: 0,
          pausedForBarrier: false,
        });
        // Settle the room track first
        for (const fn of h2.playerEventListeners.get("onVideoDataChange") ?? []) {
          fn({ playertype: 1, type: "dataloaded" });
        }
        h2.originals.origLoadVideoById.mockClear();
        h2.posted.length = 0;

        // Now YTM switches to another track via Polymer without yt-navigate or loadVideoById
        h2.setPlayerResponse({
          videoDetails: {
            videoId: "kJQP7kiw5Fk",
            title: "Machine",
            author: "FLAMEBOY",
            lengthSeconds: "190",
          },
          playabilityStatus: { status: "OK" },
        });
        for (const fn of h2.playerEventListeners.get("onVideoDataChange") ?? []) {
          fn({ playertype: 1, type: "dataloaded" });
        }

        // Must NOT reload the old room track; must enter local mode with Machine metadata
        expect(h2.originals.origLoadVideoById).not.toHaveBeenCalled();
        expect(h2.posted).toContainEqual({
          name: "localPlaybackStarted",
          args: [{ kind: "track", videoId: "kJQP7kiw5Fk" }],
        });
        expect(h2.posted).toContainEqual({
          name: "localTrackUpdated",
          args: [
            {
              videoId: "kJQP7kiw5Fk",
              title: "Machine",
              author: "FLAMEBOY",
              durationSec: 190,
              thumbnailUrl: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
            },
          ],
        });
      } finally {
        h2.handle.cleanup();
      }
    });

    it("enters local listening mode on first playerApi.loadVideoById for a non-room video and does not emit hostTransportRequested('pause')", async () => {
      const h = createSetupHarness();
      try {
        await h.invoke("setSessionLock", {
          locked: true,
          isHost: true,
          currentRoomVideoId: "dQw4w9WgXcQ",
          listeningMode: "room",
        });
        h.posted.length = 0;

        // First click triggers loadVideoById directly with a different videoId
        h.fakePlayerApi.loadVideoById("9bZkp7q19f0", 0);
        // Immediate internal pauseVideo during transition must NOT pause remote room
        h.fakePlayerApi.pauseVideo();

        expect(h.originals.origLoadVideoById).toHaveBeenCalledWith(
          "9bZkp7q19f0",
          0,
        );
        expect(h.originals.origPauseVideo).toHaveBeenCalledTimes(1);
        expect(h.posted).toContainEqual({
          name: "localPlaybackStarted",
          args: [{ kind: "track", videoId: "9bZkp7q19f0" }],
        });
        expect(
          h.posted.some((p) => p.name === "hostTransportRequested"),
        ).toBe(false);
      } finally {
        h.handle.cleanup();
      }
    });

    it("intercepts capture-phase yt-action queueAddEndpoint for tracks and playlists", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        expect(url).toContain("/youtubei/v1/music/get_queue");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            playlistPanelVideoRenderer: {
              videoId: "abcDEF12345",
              title: { simpleText: "Queued Song" },
              shortBylineText: { simpleText: "Artist" },
              lengthText: { simpleText: "2:45" },
            },
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const h = createSetupHarness({ fetchFn });
      try {
        expect(h.windowListeners.get("yt-action")?.[0]?.capture).toBe(true);
        await h.invoke("setSessionLock", { locked: true, isHost: true });

        // Track queueAddEndpoint -> resolves and emits trackSelectedCandidate
        const trackAction = h.dispatchWindowEvent("yt-action", {
          detail: {
            actionName: "yt-service-request",
            args: [
              {},
              { queueAddEndpoint: { queueTarget: { videoId: "abcDEF12345" } } },
            ],
          },
        });
        expect(trackAction.preventDefault).toHaveBeenCalledTimes(1);
        expect(trackAction.stopImmediatePropagation).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
          expect(h.posted).toContainEqual({
            name: "trackSelectedCandidate",
            args: [
              {
                videoId: "abcDEF12345",
                title: "Queued Song",
                author: "Artist",
                durationSec: 165,
                thumbnailUrl:
                  "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
              },
            ],
          });
        });

        // Playlist queueAddEndpoint -> emits blockedAction: playlist
        const playlistAction = h.dispatchWindowEvent("yt-action", {
          detail: {
            actionName: "yt-service-request",
            args: [
              {},
              { queueAddEndpoint: { queueTarget: { playlistId: "PL999" } } },
            ],
          },
        });
        expect(playlistAction.preventDefault).toHaveBeenCalledTimes(1);
        expect(playlistAction.stopImmediatePropagation).toHaveBeenCalledTimes(
          1,
        );
        expect(h.posted).toContainEqual({
          name: "blockedAction",
          args: [{ action: "playlist" }],
        });

        // Non-queueAddEndpoint yt-action is allowed
        const unrelatedAction = h.dispatchWindowEvent("yt-action", {
          detail: { actionName: "yt-like-action", args: [{}] },
        });
        expect(unrelatedAction.preventDefault).not.toHaveBeenCalled();
      } finally {
        h.handle.cleanup();
      }
    });

    it("blocks locked playerApi and mediaSession handlers for Guests, forwards Host transport, and restores on cleanup", async () => {
      const h = createSetupHarness();
      try {
        const guestMediaPlay = vi.fn();
        const guestMediaPause = vi.fn();
        const guestMediaNext = vi.fn();
        const guestMediaPrev = vi.fn();
        const guestMediaSeek = vi.fn();
        h.fakeMediaSession.setActionHandler("play", guestMediaPlay);
        h.fakeMediaSession.setActionHandler("pause", guestMediaPause);
        h.fakeMediaSession.setActionHandler("nexttrack", guestMediaNext);
        h.fakeMediaSession.setActionHandler("previoustrack", guestMediaPrev);
        h.fakeMediaSession.setActionHandler("seekto", guestMediaSeek);

        // Guest lock: every transport call and mediaSession action is blocked
        await h.invoke("setSessionLock", { locked: true, isHost: false });

        h.fakePlayerApi.playVideo();
        h.fakePlayerApi.pauseVideo();
        h.fakePlayerApi.seekTo(33);
        h.fakePlayerApi.nextVideo();
        h.fakePlayerApi.previousVideo();
        h.fakeController.nextVideo();
        h.fakeController.previousVideo();

        expect(h.originals.origPlayVideo).not.toHaveBeenCalled();
        expect(h.originals.origPauseVideo).not.toHaveBeenCalled();
        expect(h.originals.origSeekTo).not.toHaveBeenCalled();
        expect(h.originals.origPlayerNextVideo).not.toHaveBeenCalled();
        expect(h.originals.origPlayerPreviousVideo).not.toHaveBeenCalled();
        expect(h.originals.origCtrlNextVideo).not.toHaveBeenCalled();
        expect(h.originals.origCtrlPreviousVideo).not.toHaveBeenCalled();

        h.registeredMediaHandlers.get("play")?.({} as any);
        h.registeredMediaHandlers.get("pause")?.({} as any);
        h.registeredMediaHandlers.get("nexttrack")?.({} as any);
        h.registeredMediaHandlers.get("previoustrack")?.({} as any);
        h.registeredMediaHandlers.get("seekto")?.({ seekTime: 44 } as any);

        expect(guestMediaPlay).not.toHaveBeenCalled();
        expect(guestMediaPause).not.toHaveBeenCalled();
        expect(guestMediaNext).not.toHaveBeenCalled();
        expect(guestMediaPrev).not.toHaveBeenCalled();
        expect(guestMediaSeek).not.toHaveBeenCalled();

        expect(h.posted.filter((m) => m.name === "blockedAction").length).toBe(
          12,
        );

        // Host lock: play/pause/seek/next forward hostTransportRequested, previous stays blocked
        h.posted.length = 0;
        await h.invoke("setSessionLock", { locked: true, isHost: true });

        h.fakePlayerApi.playVideo();
        h.fakePlayerApi.pauseVideo();
        h.fakePlayerApi.seekTo(42);
        h.fakePlayerApi.nextVideo();
        h.fakePlayerApi.previousVideo();
        h.registeredMediaHandlers.get("play")?.({} as any);
        h.registeredMediaHandlers.get("seekto")?.({ seekTime: 55 } as any);
        h.registeredMediaHandlers.get("previoustrack")?.({} as any);

        expect(h.originals.origPlayVideo).not.toHaveBeenCalled();
        expect(h.posted).toEqual([
          {
            name: "hostTransportRequested",
            args: [{ action: "play", posSec: undefined }],
          },
          {
            name: "hostTransportRequested",
            args: [{ action: "pause", posSec: undefined }],
          },
          {
            name: "hostTransportRequested",
            args: [{ action: "seek", posSec: 42 }],
          },
          {
            name: "hostTransportRequested",
            args: [{ action: "skip", posSec: undefined }],
          },
          { name: "blockedAction", args: [{ action: "previous" }] },
          {
            name: "hostTransportRequested",
            args: [{ action: "play", posSec: undefined }],
          },
          {
            name: "hostTransportRequested",
            args: [{ action: "seek", posSec: 55 }],
          },
          { name: "blockedAction", args: [{ action: "previous" }] },
        ]);

        // Unlocked: originals run directly
        await h.invoke("setSessionLock", { locked: false });
        h.fakePlayerApi.playVideo();
        h.registeredMediaHandlers.get("play")?.({} as any);
        expect(h.originals.origPlayVideo).toHaveBeenCalledTimes(1);
        expect(guestMediaPlay).toHaveBeenCalledTimes(1);
      } finally {
        h.handle.cleanup();
        expect(h.fakePlayerApi.playVideo).toBe(h.originals.origPlayVideo);
        expect(h.fakePlayerApi.pauseVideo).toBe(h.originals.origPauseVideo);
        expect(h.fakePlayerApi.seekTo).toBe(h.originals.origSeekTo);
        expect(h.fakePlayerApi.nextVideo).toBe(h.originals.origPlayerNextVideo);
        expect(h.fakePlayerApi.previousVideo).toBe(
          h.originals.origPlayerPreviousVideo,
        );
        expect(h.fakeMediaSession.setActionHandler).toBe(
          h.originals.origSetActionHandler,
        );
        expect(h.fakeMediaElementProto.play).toBe(h.originals.origMediaPlay);
        expect(h.windowListeners.get("yt-navigate")).toEqual([]);
        expect(h.windowListeners.get("yt-action")).toEqual([]);
      }
    });

    it("emits audioBlocked on NotAllowedError from HTMLMediaElement.play and recovers via resumeBlockedAudio()", async () => {
      const videoPlay = vi.fn(async () => {});
      const videoElement = { paused: true, play: videoPlay };
      const notAllowed = Object.assign(new Error("Autoplay blocked"), {
        name: "NotAllowedError",
      });
      let shouldRejectPlay = true;

      const h = createSetupHarness({
        videoElement,
        mediaElementPlay: () =>
          shouldRejectPlay ? Promise.reject(notAllowed) : Promise.resolve(),
      });
      try {
        // Unlocked NotAllowedError does not emit audioBlocked
        await expect(h.fakeMediaElementProto.play()).rejects.toThrow(
          "Autoplay blocked",
        );
        expect(h.posted).toEqual([]);

        // Locked NotAllowedError emits audioBlocked
        await h.invoke("setSessionLock", { locked: true, isHost: false });
        await h.invoke("loadExactVideo", {
          videoId: "dQw4w9WgXcQ",
          startPosSec: 0,
        });
        await expect(h.fakeMediaElementProto.play()).rejects.toThrow(
          "Autoplay blocked",
        );
        expect(h.posted).toContainEqual({ name: "audioBlocked", args: [] });

        // Recovery via resumeBlockedAudio()
        shouldRejectPlay = false;
        const resumeRes = await h.invoke("resumeBlockedAudio");
        expect(resumeRes).toEqual({ ok: true });
        expect(h.originals.origUnMute).toHaveBeenCalledTimes(1);
        expect(h.originals.origPlayVideo).toHaveBeenCalledTimes(1);
        expect(videoPlay).toHaveBeenCalledTimes(1);

        // Failure inside videoEl.play() returns { ok: false, error } without rejecting
        videoPlay.mockRejectedValueOnce(new Error("Still blocked"));
        const failRes = await h.invoke("resumeBlockedAudio");
        expect(failRes).toEqual({ ok: false, error: "Still blocked" });
      } finally {
        h.handle.cleanup();
      }
    });

    it("resolves metadata via fetch and ajaxPromise fallback, rejects live tracks, and never rejects", async () => {
      // 1) Fetch path with wrapper renderer, lengthText, and live rejection
      const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const videoId = body.videoIds?.[0];
        if (videoId === "liveVid1234") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              playlistPanelVideoRenderer: {
                videoId: "liveVid1234",
                isLive: true,
                title: { simpleText: "24/7 Radio" },
                lengthText: { simpleText: "LIVE" },
              },
            }),
          } as Response;
        }
        if (videoId === "netErr12345") {
          throw new Error("Network down");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            queueDatas: [
              {
                content: {
                  playlistPanelVideoWrapperRenderer: {
                    primaryRenderer: {
                      playlistPanelVideoRenderer: {
                        videoId: "dQw4w9WgXcQ",
                        title: { runs: [{ text: "Wrapped Song" }] },
                        shortBylineText: { simpleText: "Wrapped Artist" },
                        lengthText: { simpleText: "4:12" },
                      },
                    },
                  },
                },
              },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const hFetch = createSetupHarness({ fetchFn });
      try {
        const okRes = await hFetch.invoke("resolveVideoMeta", "dQw4w9WgXcQ");
        expect(okRes).toEqual({
          ok: true,
          meta: {
            videoId: "dQw4w9WgXcQ",
            title: "Wrapped Song",
            author: "Wrapped Artist",
            durationSec: 252,
            thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          },
        });

        const liveRes = await hFetch.invoke("resolveVideoMeta", "liveVid1234");
        expect(liveRes).toEqual({ ok: false, error: "UNAVAILABLE_OR_LIVE" });

        const invalidRes = await hFetch.invoke("resolveVideoMeta", "bad");
        expect(invalidRes).toEqual({ ok: false, error: "INVALID_VIDEO_ID" });

        const netRes = await hFetch.invoke("resolveVideoMeta", "netErr12345");
        expect(netRes).toEqual({ ok: false, error: "Network down" });
      } finally {
        hFetch.handle.cleanup();
      }

      // 2) ajaxPromise fallback when ytcfg is unavailable
      const ytmusicAppElement = {
        dispatchEvent: vi.fn((event: Event) => {
          const custom = event as CustomEvent;
          // Ensure capture-phase yt-action interceptor is bypassed for internal service requests
          for (const entry of hFallback.windowListeners.get("yt-action") ??
            []) {
            entry.fn(custom);
          }
          custom.detail.returnValue.push({
            ajaxPromise: Promise.resolve({
              data: {
                playlistPanelVideoRenderer: {
                  videoId: "9bZkp7q19f0",
                  title: { simpleText: "Fallback Song" },
                  shortBylineText: { simpleText: "Fallback Artist" },
                  lengthText: { simpleText: "1:05" },
                },
              },
            }),
          });
          return true;
        }),
      };

      const hFallback = createSetupHarness({
        ytcfgValues: null,
        ytmusicAppElement,
      });
      try {
        await hFallback.invoke("setSessionLock", {
          locked: true,
          isHost: false,
        });
        const fallbackRes = await hFallback.invoke("resolveVideoMeta", {
          videoId: "9bZkp7q19f0",
        });
        expect(fallbackRes).toEqual({
          ok: true,
          meta: {
            videoId: "9bZkp7q19f0",
            title: "Fallback Song",
            author: "Fallback Artist",
            durationSec: 65,
            thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
          },
        });
        expect(ytmusicAppElement.dispatchEvent).toHaveBeenCalledTimes(1);
        expect(hFallback.posted).toEqual([]);
      } finally {
        hFallback.handle.cleanup();
      }
    });

    it("fetches autoplay candidates using RDAMVM playlistId and clamps limit", async () => {
      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain("/youtubei/v1/next?prettyPrint=false");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          context: { client: {} },
          playlistId: "RDAMVMdQw4w9WgXcQ",
          isAudioOnly: true,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            playlistPanelRenderer: {
              contents: [
                {
                  playlistPanelVideoRenderer: {
                    videoId: "songOne1234",
                    title: { simpleText: "One" },
                    shortBylineText: { simpleText: "A1" },
                    lengthText: { simpleText: "2:00" },
                  },
                },
                {
                  playlistPanelVideoRenderer: {
                    videoId: "songTwo1234",
                    title: { simpleText: "Two" },
                    shortBylineText: { simpleText: "A2" },
                    lengthText: { simpleText: "2:30" },
                  },
                },
                {
                  playlistPanelVideoRenderer: {
                    videoId: "songThree12",
                    title: { simpleText: "Three" },
                    shortBylineText: { simpleText: "A3" },
                    lengthText: { simpleText: "3:00" },
                  },
                },
              ],
            },
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const h = createSetupHarness({ fetchFn });
      try {
        const res = await h.invoke<{
          ok: boolean;
          candidates?: Array<{ videoId: string }>;
        }>("fetchAutoplayCandidates", {
          videoId: "dQw4w9WgXcQ",
          limit: 2,
        });
        expect(res.ok).toBe(true);
        expect(res.candidates?.map((c) => c.videoId)).toEqual([
          "songOne1234",
          "songTwo1234",
        ]);
      } finally {
        h.handle.cleanup();
      }
    });

    it("logs HTTP failures from fetchAutoplayCandidates without throwing", async () => {
      const h = createSetupHarness();
      try {
        const autoplayRes = await h.invoke("fetchAutoplayCandidates", {
          videoId: "dQw4w9WgXcQ",
          limit: 3,
        });
        expect(autoplayRes).toEqual({ ok: false, error: "HTTP_503" });
        expect(h.logger.warn).toHaveBeenCalledWith(
          "[ListenTogether][YTMView] fetchAutoplayCandidates HTTP error",
          { videoId: "dQw4w9WgXcQ", status: 503 },
        );
      } finally {
        h.handle.cleanup();
      }
    });
  });

  describe("quick-add targets and YTMView button injection", () => {
    it("extracts tracks and playlists from endpoints and YTM renderer elements", () => {
      expect(
        extractQuickAddTargetFromEndpoint({
          watchEndpoint: { videoId: "dQw4w9WgXcQ" },
        }),
      ).toEqual({ kind: "track", videoId: "dQw4w9WgXcQ" });

      expect(
        extractQuickAddTargetFromEndpoint({
          watchPlaylistEndpoint: { playlistId: "PL_TEST_1234" },
        }),
      ).toEqual({ kind: "playlist", playlistId: "PL_TEST_1234" });

      // Home album/playlist card (browseEndpoint + thumbnailOverlay playlist)
      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-TWO-ROW-ITEM-RENDERER",
          data: {
            navigationEndpoint: { browseEndpoint: { browseId: "MPRE123" } },
            thumbnailOverlay: {
              musicItemThumbnailOverlayRenderer: {
                content: {
                  musicPlayButtonRenderer: {
                    playNavigationEndpoint: {
                      watchPlaylistEndpoint: { playlistId: "OLAK5uy_abc123" },
                    },
                  },
                },
              },
            },
          },
        }),
      ).toEqual({ kind: "playlist", playlistId: "OLAK5uy_abc123" });

      // Search / playlist song row (playlistItemData.videoId)
      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-RESPONSIVE-LIST-ITEM-RENDERER",
          data: {
            playlistItemData: { videoId: "9bZkp7q19f0" },
          },
        }),
      ).toEqual({ kind: "track", videoId: "9bZkp7q19f0" });

      // Playlist header from window location
      expect(
        extractQuickAddTargetFromRenderer(
          { tagName: "YTMUSIC-RESPONSIVE-HEADER-RENDERER" },
          "https://music.youtube.com/playlist?list=PLHeader999",
        ),
      ).toEqual({ kind: "playlist", playlistId: "PLHeader999" });

      // Anchor fallback
      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-TWO-ROW-ITEM-RENDERER",
          querySelectorAll: () => [
            { getAttribute: () => "watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk" },
          ],
        }),
      ).toEqual({ kind: "track", videoId: "kJQP7kiw5Fk" });

      // Polymer __data.data and nested ytmusic-play-button-renderer fallback
      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-TWO-ROW-ITEM-RENDERER",
          __data: {
            data: { navigationEndpoint: { watchEndpoint: { videoId: "dQw4w9WgXcQ" } } },
          },
        }),
      ).toEqual({ kind: "track", videoId: "dQw4w9WgXcQ" });

      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-RESPONSIVE-LIST-ITEM-RENDERER",
          querySelector: (sel: string) =>
            sel === "ytmusic-play-button-renderer"
              ? {
                  playNavigationEndpoint: {
                    watchEndpoint: { videoId: "9bZkp7q19f0" },
                  },
                }
              : null,
        }),
      ).toEqual({ kind: "track", videoId: "9bZkp7q19f0" });

      // Search album row fallback via menu.menuRenderer.items queueAddEndpoint
      expect(
        extractQuickAddTargetFromRenderer({
          tagName: "YTMUSIC-RESPONSIVE-LIST-ITEM-RENDERER",
          data: {
            navigationEndpoint: { browseEndpoint: { browseId: "MPREb_album1" } },
            menu: {
              menuRenderer: {
                items: [
                  {
                    menuServiceItemRenderer: {
                      serviceEndpoint: {
                        queueAddEndpoint: {
                          queueTarget: { playlistId: "OLAK5uy_searchAlbum1" },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      ).toEqual({ kind: "playlist", playlistId: "OLAK5uy_searchAlbum1" });
    });

    it("injects player-bar, card, row, and playlist-header buttons without innerHTML (Trusted Types safe) and removes them when locked off", async () => {
      type FakeNode = {
        tagName: string;
        id: string;
        type?: string;
        textContent?: string;
        data?: any;
        __data?: { data?: any };
        href?: string;
        attrs: Map<string, string>;
        classes: Set<string>;
        children: FakeNode[];
        readonly firstChild: FakeNode | null;
        parent: FakeNode | null;
        listeners: Map<string, Array<(e: any) => void>>;
        classList: { add: (c: string) => void; remove: (c: string) => void };
        setAttribute: (k: string, v: string) => void;
        getAttribute: (k: string) => string | null;
        addEventListener: (t: string, fn: (e: any) => void) => void;
        dispatchClick: () => void;
        appendChild: (c: FakeNode) => FakeNode;
        insertBefore: (c: FakeNode, ref: FakeNode) => FakeNode;
        removeChild: (c: FakeNode) => FakeNode;
        replaceChildren: (...nodes: FakeNode[]) => void;
        remove: () => void;
        querySelector: (sel: string) => FakeNode | null;
        querySelectorAll: (sel: string) => FakeNode[];
      };

      const makeNode = (tag: string, extra: Partial<FakeNode> = {}): FakeNode => {
        const attrs = new Map<string, string>();
        const classes = new Set<string>();
        const listeners = new Map<string, Array<(e: any) => void>>();
        const node: FakeNode = {
          tagName: tag.toUpperCase(),
          id: "",
          attrs,
          classes,
          children: [],
          get firstChild() {
            return node.children[0] ?? null;
          },
          parent: null,
          listeners,
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
          },
          setAttribute: (k: string, v: string) => {
            attrs.set(k, v);
            if (k === "id") node.id = v;
          },
          getAttribute: (k: string) => attrs.get(k) ?? null,
          addEventListener: (t: string, fn: (e: any) => void) => {
            const arr = listeners.get(t) ?? [];
            arr.push(fn);
            listeners.set(t, arr);
          },
          dispatchClick: () => {
            for (const evType of ["pointerdown", "mousedown", "click"]) {
              const ev = {
                preventDefault: vi.fn(),
                stopPropagation: vi.fn(),
                stopImmediatePropagation: vi.fn(),
              };
              for (const fn of listeners.get(evType) ?? []) fn(ev);
              expect(ev.preventDefault).toHaveBeenCalled();
              expect(ev.stopPropagation).toHaveBeenCalled();
            }
          },
          appendChild: (c: FakeNode) => {
            c.parent = node;
            node.children.push(c);
            return c;
          },
          insertBefore: (c: FakeNode, ref: FakeNode) => {
            c.parent = node;
            const idx = node.children.indexOf(ref);
            if (idx >= 0) node.children.splice(idx, 0, c);
            else node.children.push(c);
            return c;
          },
          removeChild: (c: FakeNode) => {
            node.children = node.children.filter((ch) => ch !== c);
            c.parent = null;
            return c;
          },
          replaceChildren: (...nodes: FakeNode[]) => {
            for (const ch of node.children) ch.parent = null;
            node.children = [];
            for (const n of nodes) node.appendChild(n);
          },
          remove: () => {
            if (!node.parent) return;
            node.parent.children = node.parent.children.filter(
              (ch) => ch !== node,
            );
            node.parent = null;
          },
          querySelector: (sel: string) => node.querySelectorAll(sel)[0] ?? null,
          querySelectorAll: (sel: string) => {
            const selectors = sel.split(",").map((s) => s.trim());
            const out: FakeNode[] = [];
            const visit = (cur: FakeNode) => {
              for (const ch of cur.children) {
                for (const s of selectors) {
                  if (s === "a[href]" && ch.tagName === "A" && ch.href) {
                    out.push(ch);
                    break;
                  }
                  if (s.includes(">")) {
                    const parts = s.split(">").map((p) => p.trim().toUpperCase());
                    if (
                      parts.length === 2 &&
                      cur.tagName === parts[0] &&
                      ch.tagName === parts[1]
                    ) {
                      out.push(ch);
                      break;
                    }
                  }
                  if (s.startsWith("#") && ch.id === s.slice(1)) {
                    out.push(ch);
                    break;
                  }
                  if (s.startsWith(".") && ch.classes.has(s.slice(1))) {
                    out.push(ch);
                    break;
                  }
                  const attrMatch = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
                  if (attrMatch) {
                    const val = ch.attrs.get(attrMatch[1]);
                    if (
                      val !== undefined &&
                      (attrMatch[2] === undefined || val === attrMatch[2])
                    ) {
                      out.push(ch);
                      break;
                    }
                  }
                  if (ch.tagName === s.toUpperCase()) {
                    out.push(ch);
                    break;
                  }
                }
                visit(ch);
              }
            };
            visit(node);
            return out;
          },
          ...extra,
        };
        // Guard against Trusted Types CSP violations (no innerHTML assignment)
        Object.defineProperty(node, "innerHTML", {
          set() {
            throw new TypeError("TrustedHTML assignment is forbidden");
          },
          get() {
            return "";
          },
        });
        return node;
      };

      const root = makeNode("html");
      const head = makeNode("head");
      const body = makeNode("body");
      root.appendChild(head);
      root.appendChild(body);

      const playerBar = makeNode("ytmusic-player-bar");
      const middleButtons = makeNode("div");
      middleButtons.classes.add("middle-controls-buttons");
      const playerMenu = makeNode("ytmusic-menu-renderer");
      middleButtons.appendChild(playerMenu);
      playerBar.appendChild(middleButtons);
      body.appendChild(playerBar);

      const homeCard = makeNode("ytmusic-two-row-item-renderer", {
        data: { navigationEndpoint: { watchEndpoint: { videoId: "dQw4w9WgXcQ" } } },
      });
      const imageWrapper = makeNode("div");
      imageWrapper.classes.add("image-wrapper");
      homeCard.appendChild(imageWrapper);
      body.appendChild(homeCard);

      const searchRow = makeNode("ytmusic-responsive-list-item-renderer", {
        data: { playlistItemData: { videoId: "9bZkp7q19f0" } },
      });
      searchRow.appendChild(makeNode("ytmusic-menu-renderer"));
      body.appendChild(searchRow);

      const playlistHeader = makeNode("ytmusic-responsive-header-renderer");
      const actionsContainer = makeNode("div");
      actionsContainer.classes.add("actions-container");
      playlistHeader.appendChild(actionsContainer);
      body.appendChild(playlistHeader);

      const handlers = new Map<string, (e: any) => Promise<unknown>>();
      const posted: Array<{ channel: string; payload: unknown }> = [];
      const fakeWindow = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        location: { href: "https://music.youtube.com/playlist?list=PLDomTest123" },
      };

      const handle = setupListenTogether({
        listenTogetherApi: {
          handleMessage: (ch: string, fn: any) => {
            handlers.set(ch, fn);
          },
          postMessage: (ch: string, payload?: unknown) => {
            posted.push({ channel: ch, payload });
          },
        } as any,
        ytmStore: {
          getState: () => ({ player: { adPlaying: false } }),
          subscribe: () => () => {},
        } as any,
        ytmPlayerController: {
          nextVideo: vi.fn(),
          previousVideo: vi.fn(),
          playerApi: {
            addEventListener: vi.fn(),
            loadVideoById: vi.fn(),
            playVideo: vi.fn(),
            pauseVideo: vi.fn(),
            seekTo: vi.fn(),
            getPlayerResponse: () => ({
              videoDetails: { videoId: "kJQP7kiw5Fk" },
            }),
          },
        } as any,
        windowObj: fakeWindow as any,
        documentObj: {
          head: head as any,
          body: body as any,
          createElement: ((tag: string) => makeNode(tag)) as any,
          createElementNS: ((_ns: string, tag: string) => makeNode(tag)) as any,
          querySelector: (sel: string) => root.querySelector(sel) as any,
          querySelectorAll: (sel: string) => root.querySelectorAll(sel) as any,
        },
      });

      try {
        await handlers.get("setSessionLock")!({
          detail: { args: [{ locked: true, isHost: true, canAddSongs: true }] },
        });

        const btns = root.querySelectorAll("[data-lt-add-btn]");
        expect(btns).toHaveLength(4);
        expect(btns.every((b) => b.querySelector("svg") !== null)).toBe(true);

        middleButtons.querySelector('[data-lt-add-btn="player-bar"]')!.dispatchClick();
        imageWrapper.querySelector('[data-lt-add-btn="card"]')!.dispatchClick();
        searchRow.querySelector('[data-lt-add-btn="row"]')!.dispatchClick();
        actionsContainer.querySelector('[data-lt-add-btn="playlist-header"]')!.dispatchClick();

        expect(posted).toEqual([
          { channel: "quickAddTrack", payload: { videoId: "kJQP7kiw5Fk" } },
          { channel: "quickAddTrack", payload: { videoId: "dQw4w9WgXcQ" } },
          { channel: "quickAddTrack", payload: { videoId: "9bZkp7q19f0" } },
          {
            channel: "quickAddPlaylist",
            payload: { playlistId: "PLDomTest123" },
          },
        ]);

        // Demoting to listener removes all injected buttons immediately
        await handlers.get("setSessionLock")!({
          detail: { args: [{ locked: true, isHost: false, canAddSongs: false }] },
        });
        expect(root.querySelectorAll("[data-lt-add-btn]")).toHaveLength(0);
      } finally {
        handle.cleanup();
      }
    });
  });
});
