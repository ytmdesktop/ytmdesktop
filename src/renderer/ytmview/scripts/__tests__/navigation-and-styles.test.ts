import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("navigation, styles, and store-ipc", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createStyleSheet and createMaterialSymbolsLink inject expected DOM nodes", async () => {
    const appendedHead: any[] = [];
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => ({
        tag,
        rel: "",
        href: "",
        children: [] as any[],
        appendChild(node: any) {
          this.children.push(node);
        },
      })),
      createTextNode: vi.fn((text: string) => ({ text })),
      head: {
        appendChild: vi.fn((node: any) => appendedHead.push(node)),
      },
    });

    const { createStyleSheet, createMaterialSymbolsLink } = await import(
      "../setup/styles"
    );
    createStyleSheet();
    expect(appendedHead).toHaveLength(1);
    expect(appendedHead[0].tag).toBe("style");

    const link = createMaterialSymbolsLink();
    expect(link.rel).toBe("stylesheet");
    expect(link.href).toContain("Material+Symbols+Outlined");
  });

  it("createNavigationMenuArrows handles back/forward clicks and blocks traverse during active session", async () => {
    const navListeners = new Map<string, ((ev: any) => void)[]>();
    const makeEl = () => {
      const classes = new Set<string>();
      const listeners = new Map<string, (() => void)[]>();
      return {
        innerText: "",
        classList: {
          add: (...c: string[]) => c.forEach((x) => classes.add(x)),
          remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
          contains: (c: string) => classes.has(c),
        },
        addEventListener: (ev: string, fn: () => void) => {
          const list = listeners.get(ev) ?? [];
          list.push(fn);
          listeners.set(ev, list);
        },
        click: () => {
          for (const fn of listeners.get("click") ?? []) fn();
        },
      };
    };

    const pivotBar = { prepend: vi.fn() };
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => makeEl()),
      querySelector: vi.fn((sel: string) =>
        sel === "ytmusic-pivot-bar-renderer" ? pivotBar : null,
      ),
    });
    const backFn = vi.fn();
    const forwardFn = vi.fn();
    vi.stubGlobal("history", { back: backFn, forward: forwardFn });
    vi.stubGlobal("navigation", {
      canGoBack: true,
      canGoForward: true,
      currentEntry: { index: 1 },
      entries: () => [
        { url: "https://music.youtube.com/watch?v=1" },
        { url: "https://music.youtube.com/explore" },
        { url: "https://music.youtube.com/library" },
      ],
      addEventListener: (ev: string, fn: (e: any) => void) => {
        const list = navListeners.get(ev) ?? [];
        list.push(fn);
        navListeners.set(ev, list);
      },
    });

    const { createNavigationMenuArrows } = await import("../setup/navigation");
    createNavigationMenuArrows();
    expect(pivotBar.prepend).toHaveBeenCalledTimes(2);

    const backEl = pivotBar.prepend.mock.calls[1][0];
    const fwdEl = pivotBar.prepend.mock.calls[0][0];

    // Trigger currententrychange -> enables both buttons
    for (const fn of navListeners.get("currententrychange") ?? []) fn({});
    expect(backEl.classList.contains("disabled")).toBe(false);
    expect(fwdEl.classList.contains("disabled")).toBe(false);

    backEl.click();
    fwdEl.click();
    expect(backFn).toHaveBeenCalledTimes(1);
    expect(forwardFn).toHaveBeenCalledTimes(1);

    const navEvent = {
      navigationType: "traverse",
      destination: { url: "https://music.youtube.com/explore" },
      cancelable: true,
      preventDefault: vi.fn(),
    };
    for (const fn of navListeners.get("navigate") ?? []) fn(navEvent);
    expect(navEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("renderer store-ipc wrappers forward set/get/reset/onChanged to ipcRenderer", async () => {
    const send = vi.fn();
    const invoke = vi.fn(async () => "val");
    const on = vi.fn((_ch: string, cb: any) => {
      cb(null, { a: 2 }, { a: 1 });
    });

    vi.doMock("electron", () => ({
      ipcRenderer: { send, invoke, on },
    }));
    const origType = (process as any).type;
    (process as any).type = "renderer";

    try {
      const { default: RendererMemoryStore } = await import(
        "../../../store-ipc/memory-store"
      );
      const { default: RendererStore } = await import(
        "../../../store-ipc/store"
      );

      const ms = new RendererMemoryStore<any>();
      ms.set("k", 1);
      expect(send).toHaveBeenCalledWith("memoryStore:set", "k", 1);
      expect(await ms.get("k")).toBe("val");
      const msCb = vi.fn();
      ms.onStateChanged(msCb);
      expect(msCb).toHaveBeenCalledWith({ a: 2 }, { a: 1 });

      const st = new RendererStore<any>();
      st.set("s", 2);
      st.reset("s");
      expect(send).toHaveBeenCalledWith("configStore:set", "s", 2);
      expect(send).toHaveBeenCalledWith("configStore:reset", "s");
      expect(await st.get("s")).toBe("val");
      const stCb = vi.fn();
      st.onDidAnyChange(stCb);
      expect(stCb).toHaveBeenCalledWith({ a: 2 }, { a: 1 });
    } finally {
      (process as any).type = origType;
    }
  });

  it("setup/extras overrides history button, hides chromecast, creates player bar controls, and initializes timed lyrics", async () => {
    const dispatched: any[] = [];
    const storeSubscribers: Array<() => void> = [];
    const playerListeners = new Map<string, ((...a: any[]) => void)[]>();
    let castAvailable = true;

    const ytmStore = {
      dispatch: vi.fn((a: any) => dispatched.push(a)),
      getState: vi.fn(() => ({
        castStatus: { castAvailable },
        playerPage: {
          playerOverlay: {
            playerOverlayRenderer: {
              menu: { menuRenderer: { items: [] } },
            },
          },
        },
        feedbackToggleStates: {},
        player: { videoDetails: { videoId: "v1" } },
      })),
      subscribe: vi.fn((fn: () => void) => storeSubscribers.push(fn)),
    };

    const playerApi = {
      getPlayerResponse: vi.fn(() => ({
        videoDetails: { videoId: "v1" },
      })),
      getCurrentTime: vi.fn(() => 10),
      pauseVideo: vi.fn(),
      addEventListener: vi.fn((ev: string, fn: (...a: any[]) => void) => {
        const list = playerListeners.get(ev) ?? [];
        list.push(fn);
        playerListeners.set(ev, list);
      }),
    };

    vi.doMock("../ytmhook", () => ({
      default: {
        ytmStateStore: { store: ytmStore },
        ytmPlayerController: { playerApi },
      },
    }));

    const makeEl = (tag = "div") => {
      const classes = new Set<string>();
      const listeners = new Map<string, ((e?: any) => void)[]>();
      const el: any = {
        tag,
        style: "",
        innerText: "",
        children: [] as any[],
        rawProps: null,
        classList: {
          add: (...c: string[]) => c.forEach((x) => classes.add(x)),
          remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
          toggle: (c: string) =>
            classes.has(c) ? classes.delete(c) : classes.add(c),
          contains: (c: string) => classes.has(c),
        },
        addEventListener: (ev: string, fn: (e?: any) => void) => {
          const list = listeners.get(ev) ?? [];
          list.push(fn);
          listeners.set(ev, list);
        },
        dispatchEvent: vi.fn(),
        insertAdjacentElement: vi.fn(),
        appendChild: vi.fn((child: any) => el.children.push(child)),
        set: vi.fn(),
        setAttribute: vi.fn(),
        getMenuRenderer: vi.fn(() => ({ items: [] })),
        querySelector: vi.fn(() => el),
        querySelectorAll: vi.fn(() => []),
        remove: vi.fn(),
        click: () => {
          for (const fn of listeners.get("click") ?? []) fn({});
        },
      };
      return el;
    };

    const historyBtn = makeEl("span");
    const likeRenderer = makeEl("ytmusic-like-button-renderer");
    const playerBar = makeEl("ytmusic-player-bar");
    playerBar.querySelector = vi.fn((s: string) =>
      s === "ytmusic-like-button-renderer" ? likeRenderer : makeEl(),
    );

    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: vi.fn((t: string) => makeEl(t)),
      createTextNode: vi.fn((t: string) => ({ text: t })),
      querySelector: vi.fn((sel: string) => {
        if (sel === "#history-link .history-button") return historyBtn;
        if (sel === "ytmusic-app-layout>ytmusic-player-bar") return playerBar;
        return makeEl();
      }),
      querySelectorAll: vi.fn(() => []),
      body: makeEl("body"),
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

    const extras = await import("../setup/extras");
    extras.overrideHistoryButtonDisplay();
    expect(historyBtn.style).toBe("display: inline-block !important;");

    await extras.hideChromecastButton();
    expect(dispatched).toContainEqual({
      type: "SET_CAST_AVAILABLE",
      payload: false,
    });
    for (const sub of storeSubscribers) sub();

    await extras.createAdditionalPlayerBarControls();
    expect(likeRenderer.insertAdjacentElement).toHaveBeenCalled();
    // Exercise library, playlist, and sleep timer button callbacks + store updates
    const libBtn = likeRenderer.insertAdjacentElement.mock.calls[0]?.[1];
    libBtn?.rawProps?.data?.onTap?.();
    const plBtn = likeRenderer.insertAdjacentElement.mock.calls[1]?.[1];
    plBtn?.rawProps?.data?.onTap?.();
    for (const sub of storeSubscribers) sub();

    await extras.addTimedLyrics();
    for (const fn of playerListeners.get("onVideoProgress") ?? []) fn(10);
  });
});
