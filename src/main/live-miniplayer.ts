import { Rectangle } from "electron";
import log from "electron-log";
import { AppView } from "./services/windowmanager/appview";
import PlayerStateStore from "./services/playerstatestore";
import { VideoType } from "~shared/playerstatestore/types";

const TOP_CHROME = 36;
const BOTTOM_CHROME = 80;

type MiniplayerHost = {
  name: string;
  attachView(view: AppView, index?: number): void;
  closeWindow(): void;
};

type LiveMiniplayerController = {
  onOpened(): Promise<void>;
  onClose(event: Electron.Event): void;
};

function miniplayerVideoBounds(parent: Rectangle): Rectangle {
  return {
    x: 0,
    y: TOP_CHROME,
    width: parent.width,
    height: Math.max(0, parent.height - TOP_CHROME - BOTTOM_CHROME),
  };
}

function wantsLiveVideo(videoType: VideoType | undefined) {
  return (
    videoType === VideoType.MusicVideo || videoType === VideoType.MusicUploaded
  );
}

// Runs in the YouTube Music page. position:fixed is trapped by transforms on the player,
// so the live element is moved into a viewport-sized host. YouTube freezes frames when
// document.hidden is true, which happens if the owning window is hidden.
const MOUNT_LIVE_VIDEO = `(() => {
  const HOST_ID = "ytmd-live-miniplayer-host";

  function findVideo() {
    const videos = [];
    const collect = (root) => {
      root.querySelectorAll("video").forEach((video) => videos.push(video));
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) collect(element.shadowRoot);
      });
    };
    collect(document);
    return (
      videos.find((video) => video.readyState > 0 && video.videoWidth > 0 && !video.paused) ??
      videos.find((video) => video.readyState > 0 && video.videoWidth > 0) ??
      null
    );
  }

  function patchVisibility(state) {
    if (state.visibilityPatched) return;
    try {
      const hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
      const stateDesc = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
      if (!hiddenDesc?.configurable || !stateDesc?.configurable) return;
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "visible" });
      state.hiddenDesc = hiddenDesc;
      state.stateDesc = stateDesc;
      state.visibilityPatched = true;
      document.dispatchEvent(new Event("visibilitychange"));
    } catch (error) {}
  }

  function ensureState() {
    if (!window.__ytmdLiveMiniplayer) {
      window.__ytmdLiveMiniplayer = { adopted: [] };
    }
    return window.__ytmdLiveMiniplayer;
  }

  function adopt(video, state) {
    if (state.adopted.some((item) => item.video === video)) {
      if (video.isConnected && video.parentElement !== state.host) state.host.appendChild(video);
      return;
    }
    const parent = video.parentNode;
    if (!parent) return;
    const rect = video.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-ytmd-placeholder", "1");
    placeholder.style.cssText = "display:block;width:" + Math.max(rect.width, 1) + "px;height:" + Math.max(rect.height, 1) + "px;";
    const prevStyle = video.getAttribute("style");
    const wasPlaying = !video.paused && !video.ended;
    parent.insertBefore(placeholder, video);
    state.host.appendChild(video);
    video.style.setProperty("width", "100%", "important");
    video.style.setProperty("height", "100%", "important");
    video.style.setProperty("max-width", "none", "important");
    video.style.setProperty("max-height", "none", "important");
    video.style.setProperty("object-fit", "contain", "important");
    video.style.setProperty("background", "black", "important");
    state.adopted.push({ video, placeholder, prevStyle, parent, wasPlaying, adoptedAt: Date.now() });
    if (wasPlaying) video.play().catch(() => {});
  }

  const state = ensureState();
  patchVisibility(state);
  if (!state.host) {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center;";
    document.documentElement.appendChild(host);
    state.host = host;
  }
  const video = findVideo();
  if (video) adopt(video, state);
  if (!state.timer) {
    state.timer = setInterval(() => {
      const next = findVideo();
      if (next) adopt(next, state);
      for (const item of state.adopted) {
        if (!item.wasPlaying || !item.video.paused) continue;
        if (Date.now() - item.adoptedAt > 1500) continue;
        item.video.play().catch(() => {});
      }
    }, 1000);
  }
  const hosted = state.host.querySelector("video");
  return !!(hosted && hosted.videoWidth > 0);
})()`;

const RELEASE_LIVE_VIDEO = `(() => {
  const state = window.__ytmdLiveMiniplayer;
  if (!state) return true;
  if (state.timer) clearInterval(state.timer);
  for (const item of state.adopted) {
    const video = item.video;
    if (item.prevStyle) video.setAttribute("style", item.prevStyle);
    else video.removeAttribute("style");
    if (item.placeholder.isConnected) item.placeholder.replaceWith(video);
    else if (item.parent && item.parent.isConnected) item.parent.appendChild(video);
    else document.body.appendChild(video);
    item.placeholder.remove();
  }
  if (state.host) state.host.remove();
  if (state.visibilityPatched) {
    if (state.hiddenDesc) Object.defineProperty(Document.prototype, "hidden", state.hiddenDesc);
    if (state.stateDesc) Object.defineProperty(Document.prototype, "visibilityState", state.stateDesc);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  delete window.__ytmdLiveMiniplayer;
  return true;
})()`;

async function runInPage(view: AppView, script: string): Promise<unknown> {
  const contents = view.webContents;
  if (!contents || contents.isDestroyed()) return false;
  return await Promise.race([
    contents.executeJavaScript(script, true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
}

export function createLiveMiniplayerController(deps: {
  getYtmView: () => AppView | undefined;
  isMiniplayerOpen: () => boolean;
  getMiniplayer: () => MiniplayerHost | undefined;
  mainWindow: MiniplayerHost;
  playerStateStore: PlayerStateStore;
  rememberBoundsAndShowMain: () => void;
}): LiveMiniplayerController {
  let mountedId: string | null = null;
  let allowClose = false;
  let closing = false;
  let pending = Promise.resolve();

  const enqueue = (task: () => Promise<void>) => {
    pending = pending.then(task, task);
    return pending;
  };

  const attachedToMiniplayer = (view: AppView) =>
    view.getParentWindow()?.name === "Miniplayer";

  const release = async (view: AppView) => {
    if (mountedId === null && !attachedToMiniplayer(view)) return;
    try {
      await runInPage(view, RELEASE_LIVE_VIDEO);
    } catch (error) {
      log.warn("Failed to restore the YouTube Music video element", error);
    }
    if (attachedToMiniplayer(view)) {
      view.setBoundsCalculator(null, false);
      view.webContents?.setBackgroundThrottling(true);
      deps.mainWindow.attachView(view, 0);
    }
    mountedId = null;
  };

  const sync = async () => {
    if (closing || !deps.isMiniplayerOpen()) return;
    const view = deps.getYtmView();
    const miniplayer = deps.getMiniplayer();
    if (!view || !miniplayer) return;

    const state = deps.playerStateStore.getState();
    const live = wantsLiveVideo(state.videoDetails?.videoType);
    const id = state.videoDetails?.id ?? null;

    if (!live) {
      await release(view);
      return;
    }

    if (!attachedToMiniplayer(view)) {
      view.webContents?.setBackgroundThrottling(false);
      view.setBoundsCalculator(
        (parent) => miniplayerVideoBounds(parent),
        false,
      );
      miniplayer.attachView(view, 0);
    }

    if (mountedId === id) return;

    try {
      await runInPage(view, RELEASE_LIVE_VIDEO);
      const mounted = await runInPage(view, MOUNT_LIVE_VIDEO);
      mountedId = id;
      log.info(`Live miniplayer video ${mounted ? "mounted" : "waiting for a frame"} (${id})`);
    } catch (error) {
      mountedId = null;
      log.warn("Failed to mount the live miniplayer video", error);
    }
  };

  deps.playerStateStore.on("state-changed", state => {
    if (closing || !deps.isMiniplayerOpen()) return;
    const view = deps.getYtmView();
    if (!view) return;
    const live = wantsLiveVideo(state.videoDetails?.videoType);
    const id = state.videoDetails?.id ?? null;
    if (live && mountedId === id && attachedToMiniplayer(view)) return;
    if (!live && mountedId === null && !attachedToMiniplayer(view)) return;
    void enqueue(sync);
  });

  return {
    onOpened() {
      closing = false;
      return enqueue(sync);
    },
    onClose(event) {
      if (allowClose) {
        allowClose = false;
        deps.rememberBoundsAndShowMain();
        return;
      }

      const view = deps.getYtmView();
      if (!view || (mountedId === null && !attachedToMiniplayer(view))) {
        deps.rememberBoundsAndShowMain();
        return;
      }

      event.preventDefault();
      closing = true;
      void enqueue(async () => {
        try {
          await release(view);
        } finally {
          allowClose = true;
          deps.getMiniplayer()?.closeWindow();
        }
      });
    },
  };
}
