import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListenTogetherLogger } from "~shared/listentogether/logger";
import {
  LISTEN_TOGETHER_NARROW_BREAKPOINT,
  LISTEN_TOGETHER_PANEL_WIDTH,
  LISTEN_TOGETHER_TITLEBAR_HEIGHT,
  applyListenTogetherLayout,
  computeListenTogetherLayout,
  type LayoutViewHandle,
} from "../layout";

const { mockWebContentsViewCtor, mockViewInstances } = vi.hoisted(() => {
  const instances: Array<{
    getBounds: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    webContents: {
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      loadURL: ReturnType<typeof vi.fn>;
      loadFile: ReturnType<typeof vi.fn>;
      openDevTools: ReturnType<typeof vi.fn>;
      ipc: { once: ReturnType<typeof vi.fn> };
    };
  }> = [];

  const ctor = vi.fn().mockImplementation(() => {
    const instance = {
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        on: vi.fn(),
        send: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        openDevTools: vi.fn(),
        ipc: { once: vi.fn() },
      },
    };
    instances.push(instance);
    return instance;
  });

  return { mockWebContentsViewCtor: ctor, mockViewInstances: instances };
});

vi.mock("electron", () => ({
  app: { isPackaged: true },
  WebContentsView: mockWebContentsViewCtor,
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { AppView } from "../../windowmanager/appview";
import type { AppWindow, AppWindowType } from "../../windowmanager/appwindow";

function createMockViewHandle(): {
  handle: LayoutViewHandle;
  setAutoResize: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
} {
  const setAutoResize = vi.fn();
  const show = vi.fn();
  const hide = vi.fn();
  return {
    handle: {
      setAutoResize,
      show,
      hide,
    },
    setAutoResize,
    show,
    hide,
  };
}

function createSpyLogger(): {
  logger: ListenTogetherLogger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    logger: { debug, info, warn, error },
    debug,
    info,
    warn,
    error,
  };
}

describe("computeListenTogetherLayout", () => {
  it("returns fullscreen mode when inHtmlFullscreen is true regardless of panelOpen or width", () => {
    const layout = computeListenTogetherLayout(600, true, true);

    expect(layout.mode).toBe("fullscreen");
    expect(layout.listenTogetherVisible).toBe(false);
    expect(layout.ytmVisible).toBe(true);
    expect(layout.focusTarget).toBe("ytm");
    expect(layout.ytmAutoResize).toEqual({
      width: true,
      height: true,
      offsetWidth: undefined,
      offsetHeight: {
        anchor: "Top",
        pixels: 0,
      },
    });
  });

  it("returns closed mode when panelOpen is false", () => {
    const layout = computeListenTogetherLayout(1200, false, false);

    expect(layout.mode).toBe("closed");
    expect(layout.listenTogetherVisible).toBe(false);
    expect(layout.ytmVisible).toBe(true);
    expect(layout.focusTarget).toBe("ytm");
    expect(layout.ytmAutoResize).toEqual({
      width: true,
      height: true,
      offsetWidth: undefined,
      offsetHeight: {
        anchor: "Bottom",
        pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
      },
    });
  });

  it("returns split mode when panelOpen is true and windowWidth >= 760", () => {
    for (const width of [LISTEN_TOGETHER_NARROW_BREAKPOINT, 1200]) {
      const layout = computeListenTogetherLayout(width, true, false);

      expect(layout.mode).toBe("split");
      expect(layout.listenTogetherVisible).toBe(true);
      expect(layout.ytmVisible).toBe(true);
      expect(layout.focusTarget).toBe("ytm");
      expect(layout.listenTogetherAutoResize).toEqual({
        width: false,
        height: true,
        fixedWidth: {
          pixels: LISTEN_TOGETHER_PANEL_WIDTH,
          anchor: "Right",
        },
        offsetWidth: undefined,
        offsetHeight: {
          anchor: "Bottom",
          pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
        },
      });
      expect(layout.ytmAutoResize).toEqual({
        width: true,
        height: true,
        offsetWidth: {
          anchor: "Left",
          pixels: LISTEN_TOGETHER_PANEL_WIDTH,
        },
        offsetHeight: {
          anchor: "Bottom",
          pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
        },
      });
    }
  });

  it("returns narrow mode when panelOpen is true and windowWidth < 760", () => {
    for (const width of [LISTEN_TOGETHER_NARROW_BREAKPOINT - 1, 600, 156]) {
      const layout = computeListenTogetherLayout(width, true, false);

      expect(layout.mode).toBe("narrow");
      expect(layout.listenTogetherVisible).toBe(true);
      expect(layout.ytmVisible).toBe(false);
      expect(layout.focusTarget).toBe("listenTogether");
      expect(layout.listenTogetherAutoResize).toEqual({
        width: true,
        height: true,
        fixedWidth: undefined,
        offsetWidth: undefined,
        offsetHeight: {
          anchor: "Bottom",
          pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
        },
      });
    }
  });
});

describe("applyListenTogetherLayout", () => {
  it("logs info on mode transition and applies view visibility and autoResize", () => {
    const lt = createMockViewHandle();
    const ytm = createMockViewHandle();
    const spy = createSpyLogger();

    const layout = computeListenTogetherLayout(1200, true, false);
    const nextMode = applyListenTogetherLayout(layout, lt.handle, ytm.handle, {
      logger: spy.logger,
      previousMode: "closed",
    });

    expect(nextMode).toBe("split");
    expect(spy.info).toHaveBeenCalledTimes(1);
    expect(spy.info).toHaveBeenCalledWith(
      "Listen Together layout transitioned",
      {
        previousMode: "closed",
        mode: "split",
        listenTogetherVisible: true,
        ytmVisible: true,
        focusTarget: "ytm",
      },
    );
    expect(lt.setAutoResize).toHaveBeenCalledWith(
      layout.listenTogetherAutoResize,
    );
    expect(lt.show).toHaveBeenCalledTimes(1);
    expect(lt.hide).not.toHaveBeenCalled();
    expect(ytm.setAutoResize).toHaveBeenCalledWith(layout.ytmAutoResize);
    expect(ytm.show).toHaveBeenCalledTimes(1);
    expect(ytm.hide).not.toHaveBeenCalled();
  });

  it("logs debug instead of info when layout mode has not changed", () => {
    const lt = createMockViewHandle();
    const ytm = createMockViewHandle();
    const spy = createSpyLogger();

    const layout = computeListenTogetherLayout(1200, false, false);
    applyListenTogetherLayout(layout, lt.handle, ytm.handle, {
      logger: spy.logger,
      previousMode: "closed",
    });

    expect(spy.info).not.toHaveBeenCalled();
    expect(spy.debug).toHaveBeenCalledWith("Listen Together layout applied", {
      mode: "closed",
      listenTogetherVisible: false,
      ytmVisible: true,
      focusTarget: "ytm",
    });
    expect(lt.hide).toHaveBeenCalledTimes(1);
    expect(ytm.show).toHaveBeenCalledTimes(1);
  });

  it("logs warn if listenTogetherView.hide() rejects", async () => {
    const lt = createMockViewHandle();
    const ytm = createMockViewHandle();
    const spy = createSpyLogger();

    lt.hide.mockRejectedValue(new Error("panel hide failed"));

    const layout = computeListenTogetherLayout(1200, false, false);
    applyListenTogetherLayout(layout, lt.handle, ytm.handle, {
      logger: spy.logger,
      previousMode: "split",
    });

    await vi.waitFor(() => {
      expect(spy.warn).toHaveBeenCalledWith(
        "Failed to hide Listen Together view",
        { error: "panel hide failed" },
      );
    });
  });

  it("logs warn if ytmView.hide() rejects", async () => {
    const lt = createMockViewHandle();
    const ytm = createMockViewHandle();
    const spy = createSpyLogger();

    ytm.hide.mockRejectedValue("ytm hide string error");

    const layout = computeListenTogetherLayout(600, true, false);
    applyListenTogetherLayout(layout, lt.handle, ytm.handle, {
      logger: spy.logger,
      previousMode: "split",
    });

    await vi.waitFor(() => {
      expect(spy.warn).toHaveBeenCalledWith("Failed to hide YTM view", {
        error: "ytm hide string error",
      });
    });
  });

  it("handles missing view handles without throwing", () => {
    const spy = createSpyLogger();
    const layout = computeListenTogetherLayout(1200, false, false);

    const mode = applyListenTogetherLayout(layout, null, undefined, {
      logger: spy.logger,
      previousMode: null,
    });

    expect(mode).toBe("closed");
    expect(spy.debug).toHaveBeenCalledWith(
      "Listen Together layout missing view handle",
      {
        mode: "closed",
        hasListenTogetherView: false,
        hasYtmView: false,
      },
    );
  });
});

describe("AppView.parentWindowResize", () => {
  beforeEach(() => {
    mockWebContentsViewCtor.mockClear();
    mockViewInstances.length = 0;
  });

  it("positions fixedWidth Right view at x = 860, width = 340 for 1200px parent and clamps to x = 0, width = 200 for 200px parent", () => {
    let contentBounds = { x: 0, y: 0, width: 1200, height: 800 };
    const resizeListeners: Array<() => void> = [];

    const mockElectronWindow = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      getContentBounds: vi.fn(() => contentBounds),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "resize") {
          resizeListeners.push(listener);
        }
      }),
      off: vi.fn(),
    };

    const mockAppWindow = {
      name: "main",
      _getElectronWindow: () => mockElectronWindow,
      detachView: vi.fn(),
    } as unknown as AppWindow<AppWindowType>;

    const appView = new AppView({
      name: "listenTogether",
      autoRecreate: false,
      viewState: {
        autoResize: {
          width: false,
          height: true,
          fixedWidth: {
            pixels: LISTEN_TOGETHER_PANEL_WIDTH,
            anchor: "Right",
          },
          offsetHeight: {
            anchor: "Bottom",
            pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
          },
        },
      },
      electronOptions: {},
    });

    expect(mockViewInstances).toHaveLength(1);
    const electronView = mockViewInstances[0];

    appView._attachToWindow(mockAppWindow);

    expect(electronView.setBounds).toHaveBeenLastCalledWith({
      x: 860,
      y: 36,
      width: 340,
      height: 764,
    });

    contentBounds = { x: 0, y: 0, width: 200, height: 700 };
    expect(resizeListeners).toHaveLength(1);
    resizeListeners[0]();

    expect(electronView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 36,
      width: 200,
      height: 664,
    });
  });
});
