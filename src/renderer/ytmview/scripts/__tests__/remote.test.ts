import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ytmview setup/remote.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes all RemoteControl commands and handles getPlaylists", async () => {
    const dispatchedStore: any[] = [];
    const docEvents: any[] = [];
    const appEvents: any[] = [];

    let playerStateNum = 1;
    let muted = false;
    let volume = 40;
    const playerApi = {
      getPlayerState: vi.fn(() => playerStateNum),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      nextVideo: vi.fn(),
      previousVideo: vi.fn(),
      getVolume: vi.fn(() => volume),
      setVolume: vi.fn((v: number) => {
        volume = v;
      }),
      isMuted: vi.fn(() => muted),
      mute: vi.fn(() => {
        muted = true;
      }),
      unMute: vi.fn(() => {
        muted = false;
      }),
      seekTo: vi.fn(),
      getPlayerResponse: vi.fn(() => ({
        videoDetails: { videoId: "vid-1" },
      })),
    };

    const ytmStore = {
      dispatch: vi.fn((a: any) => dispatchedStore.push(a)),
      getState: vi.fn(() => ({
        playerPage: {
          playerOverlay: {
            playerOverlayRenderer: {
              actions: [
                {
                  likeButtonRenderer: {
                    likeStatus: "INDIFFERENT",
                    serviceEndpoints: [
                      { likeEndpoint: { status: "LIKE" } },
                      { likeEndpoint: { status: "DISLIKE" } },
                      { likeEndpoint: { status: "INDIFFERENT" } },
                    ],
                  },
                },
              ],
            },
          },
        },
        likeStatus: { videos: {} },
        queue: {
          repeatMode: "NONE",
          shuffleEnabled: false,
          nextQueueItemId: 5,
          items: [
            {
              playlistPanelVideoRenderer: {
                navigationEndpoint: { watchEndpoint: { videoId: "q-0" } },
              },
            },
          ],
          automixItems: [
            {
              playlistPanelVideoWrapperRenderer: {
                primaryRenderer: {
                  playlistPanelVideoRenderer: {
                    navigationEndpoint: { watchEndpoint: { videoId: "am-0" } },
                  },
                },
              },
            },
          ],
        },
      })),
    };

    const shuffleFn = vi.fn();
    vi.doMock("../ytmhook", () => ({
      default: {
        ytmStateStore: { store: ytmStore },
        ytmPlayerController: {
          playerApi,
          queue: { shuffle: shuffleFn },
        },
      },
    }));

    const executeListeners: Array<(ev: any) => void> = [];
    let getPlaylistsHandler: (() => Promise<any>) | null = null;
    vi.doMock("../protectedapimanager", () => ({
      default: {
        createOrGetAPI: vi.fn(() => ({
          addEventListener: vi.fn((name: string, cb: (ev: any) => void) => {
            if (name === "execute") executeListeners.push(cb);
          }),
          handleMessage: vi.fn((name: string, cb: () => Promise<any>) => {
            if (name === "getPlaylists") getPlaylistsHandler = cb;
          }),
        })),
      },
    }));

    const fakeAppEl = {
      dispatchEvent: vi.fn((ev: any) => {
        appEvents.push(ev);
        const rv = ev.detail?.returnValue;
        const actionArgs = ev.detail?.args?.[1];
        if (rv && actionArgs?.queueAddEndpoint) {
          rv.push({
            ajaxPromise: Promise.resolve({
              data: { queueDatas: [{ content: { id: "added-1" } }] },
            }),
          });
        } else if (rv && actionArgs?.addToPlaylistEndpoint) {
          rv.push({
            ajaxPromise: Promise.resolve({
              data: {
                contents: [
                  {
                    addToPlaylistRenderer: {
                      playlists: [
                        {
                          playlistAddToOptionRenderer: {
                            playlistId: "PL-1",
                            title: { runs: [{ text: "My Mix" }] },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          });
        }
      }),
    };

    vi.stubGlobal("document", {
      querySelector: vi.fn(() => fakeAppEl),
      dispatchEvent: vi.fn((ev: any) => docEvents.push(ev)),
    });
    if (typeof CustomEvent === "undefined") {
      vi.stubGlobal(
        "CustomEvent",
        class FakeCustomEvent extends Event {
          public detail: any;
          constructor(type: string, init?: { detail?: any }) {
            super(type);
            this.detail = init?.detail;
          }
        },
      );
    }

    const { default: initRemote } = await import("../setup/remote");
    initRemote();

    const exec = (...args: unknown[]) => {
      for (const fn of executeListeners) {
        fn({ detail: { args: [...args] } });
      }
    };

    exec("playPause");
    expect(playerApi.pauseVideo).toHaveBeenCalledTimes(1);
    playerStateNum = 2;
    exec("playPause");
    expect(playerApi.playVideo).toHaveBeenCalledTimes(1);
    exec("play");
    exec("pause");
    exec("next");
    exec("previous");
    exec("toggleLike");
    exec("toggleDislike");
    exec("volumeUp");
    exec("volumeDown");
    exec("setVolume", 75);
    expect(volume).toBe(75);
    exec("mute");
    expect(muted).toBe(true);
    exec("unmute");
    expect(muted).toBe(false);
    exec("toggleMute");
    expect(muted).toBe(true);
    exec("repeatMode", "ONE");
    exec("cycleRepeatMode");
    exec("seekTo", 42);
    exec("shuffle");
    expect(shuffleFn).toHaveBeenCalled();
    exec("playQueueIndex", 0);
    exec("playQueueIndex", 1);
    exec("navigate", { watchEndpoint: { videoId: "nav-1" } });
    exec("queueAdd", { videoId: "v-1", index: 0 });
    exec("queueRemove", 0);
    exec("queueMove", { fromIndex: 0, toIndex: 1 });

    await new Promise((r) => setTimeout(r, 10));
    expect(docEvents.length).toBeGreaterThanOrEqual(3);
    expect(dispatchedStore.some((a) => a.type === "ADD_ITEMS")).toBe(true);
    expect(dispatchedStore.some((a) => a.type === "REMOVE_ITEM")).toBe(true);
    expect(dispatchedStore.some((a) => a.type === "MOVE_ITEM")).toBe(true);

    const playlistsResult = await getPlaylistsHandler!();
    expect(playlistsResult).toEqual([[{ id: "PL-1", title: "My Mix" }]]);
  });
});
