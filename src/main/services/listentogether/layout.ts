import type { ListenTogetherLogger } from "~shared/listentogether/logger";
import type { AppViewOptions } from "../windowmanager/appview";

export const LISTEN_TOGETHER_PANEL_WIDTH = 340;
export const LISTEN_TOGETHER_NARROW_BREAKPOINT = 760;
export const LISTEN_TOGETHER_TITLEBAR_HEIGHT = 36;

export type ListenTogetherLayoutMode =
  | "fullscreen"
  | "closed"
  | "split"
  | "narrow";

export type ListenTogetherLayoutResult = {
  mode: ListenTogetherLayoutMode;
  listenTogetherVisible: boolean;
  ytmVisible: boolean;
  focusTarget: "ytm" | "listenTogether";
  listenTogetherAutoResize: NonNullable<
    AppViewOptions["viewState"]["autoResize"]
  >;
  ytmAutoResize: NonNullable<AppViewOptions["viewState"]["autoResize"]>;
};

export interface LayoutViewHandle {
  setAutoResize(
    autoResize: Partial<AppViewOptions["viewState"]["autoResize"]>,
  ): void;
  show(notifyWebContents?: boolean): void;
  hide(waitForWebContents?: boolean): Promise<void> | void;
}

/**
 * Computes responsive split/narrow/fullscreen bounds and focus routing for `listenTogetherView` and `ytmView`.
 */
export function computeListenTogetherLayout(
  windowWidth: number,
  panelOpen: boolean,
  inHtmlFullscreen: boolean,
): ListenTogetherLayoutResult {
  const defaultPanelAutoResize: NonNullable<
    AppViewOptions["viewState"]["autoResize"]
  > = {
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
  };
  const defaultYtmAutoResize: NonNullable<
    AppViewOptions["viewState"]["autoResize"]
  > = {
    width: true,
    height: true,
    offsetWidth: undefined,
    offsetHeight: {
      anchor: "Bottom",
      pixels: LISTEN_TOGETHER_TITLEBAR_HEIGHT,
    },
  };

  if (inHtmlFullscreen) {
    return {
      mode: "fullscreen",
      listenTogetherVisible: false,
      ytmVisible: true,
      focusTarget: "ytm",
      listenTogetherAutoResize: defaultPanelAutoResize,
      ytmAutoResize: {
        ...defaultYtmAutoResize,
        offsetHeight: {
          anchor: "Top",
          pixels: 0,
        },
      },
    };
  }

  if (!panelOpen) {
    return {
      mode: "closed",
      listenTogetherVisible: false,
      ytmVisible: true,
      focusTarget: "ytm",
      listenTogetherAutoResize: defaultPanelAutoResize,
      ytmAutoResize: defaultYtmAutoResize,
    };
  }

  if (windowWidth >= LISTEN_TOGETHER_NARROW_BREAKPOINT) {
    return {
      mode: "split",
      listenTogetherVisible: true,
      ytmVisible: true,
      focusTarget: "ytm",
      listenTogetherAutoResize: defaultPanelAutoResize,
      ytmAutoResize: {
        ...defaultYtmAutoResize,
        offsetWidth: {
          anchor: "Left",
          pixels: LISTEN_TOGETHER_PANEL_WIDTH,
        },
      },
    };
  }

  return {
    mode: "narrow",
    listenTogetherVisible: true,
    ytmVisible: false,
    focusTarget: "listenTogether",
    listenTogetherAutoResize: {
      ...defaultYtmAutoResize,
      fixedWidth: undefined,
    },
    ytmAutoResize: defaultYtmAutoResize,
  };
}

export type ApplyListenTogetherLayoutOptions = {
  logger?: ListenTogetherLogger;
  previousMode?: ListenTogetherLayoutMode | null;
};

/**
 * Applies a computed Listen Together layout to the panel and YTM views.
 */
export function applyListenTogetherLayout(
  layout: ListenTogetherLayoutResult,
  listenTogetherView: LayoutViewHandle | null | undefined,
  ytmView: LayoutViewHandle | null | undefined,
  options?: ApplyListenTogetherLayoutOptions,
): ListenTogetherLayoutMode {
  const logger = options?.logger;
  const previousMode = options?.previousMode ?? null;

  if (previousMode !== layout.mode) {
    logger?.info?.("Listen Together layout transitioned", {
      previousMode,
      mode: layout.mode,
      listenTogetherVisible: layout.listenTogetherVisible,
      ytmVisible: layout.ytmVisible,
      focusTarget: layout.focusTarget,
    });
  } else {
    logger?.debug?.("Listen Together layout applied", {
      mode: layout.mode,
      listenTogetherVisible: layout.listenTogetherVisible,
      ytmVisible: layout.ytmVisible,
      focusTarget: layout.focusTarget,
    });
  }

  if (!listenTogetherView || !ytmView) {
    logger?.debug?.("Listen Together layout missing view handle", {
      mode: layout.mode,
      hasListenTogetherView: Boolean(listenTogetherView),
      hasYtmView: Boolean(ytmView),
    });
  }

  if (listenTogetherView) {
    listenTogetherView.setAutoResize(layout.listenTogetherAutoResize);
    if (layout.listenTogetherVisible) {
      listenTogetherView.show();
    } else {
      void Promise.resolve(listenTogetherView.hide()).catch((err) => {
        logger?.warn?.("Failed to hide Listen Together view", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  if (ytmView) {
    ytmView.setAutoResize(layout.ytmAutoResize);
    if (layout.ytmVisible) {
      ytmView.show();
    } else {
      void Promise.resolve(ytmView.hide()).catch((err) => {
        logger?.warn?.("Failed to hide YTM view", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  return layout.mode;
}
