// IMPORTANT NOTES ABOUT THIS FILE
//
// This file contains all logic related to interacting with YTM itself and works under the assumption of a trusted environment and data.
// Anything passed to this file does not necessarily need to be or will be validated.
//
// If adding new things to this file ensure best security practices are followed.
// - executeJavaScript is used to enter the main world when you need to interact with YTM APIs or anything from YTM that would otherwise need the prototypes or events from YTM.
//   - Always wrap your executeJavaScript code in an IIFE calling it from outside executeJavaScript when it returns
// - Add functions to exposeInMainWorld when you need to call back to the main program. By nature you should not trust data coming from this.

import { contextBridge, ipcRenderer, webFrame } from "electron";
import Store from "../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";

import playerBarControlsScript from "./scripts/playerbarcontrols.script?raw";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script?raw";
import getPlaylistsScript from "./scripts/getplaylists.script?raw";
import toggleLikeScript from "./scripts/togglelike.script?raw";
import toggleDislikeScript from "./scripts/toggledislike.script?raw";
import skipSilenceScript from "./scripts/skipsilence.script?raw";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) =>
    ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata),
  sendStoreUpdate: (queueState: unknown, likeStatus: string, volume: number, muted: boolean, adPlaying: boolean) =>
    ipcRenderer.send("ytmView:storeStateChanged", queueState, likeStatus, volume, muted, adPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmView:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmView:deletePlaylistObserved", playlistId),
  downloadCurrentTrack: (trackInfo?: unknown) => ipcRenderer.send("ytmView:downloadTrack", trackInfo)
});

window.addEventListener("ytmd:downloadCurrentTrack", ((event: CustomEvent) => {
  ipcRenderer.send("ytmView:downloadTrack", event.detail);
}) as EventListener);

ipcRenderer.on("downloader:status", (event, data) => {
  window.dispatchEvent(new CustomEvent("ytmd:downloadStatus", { detail: data }));
});

function createStyleSheet() {
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(`
      .ytmd-history-back, .ytmd-history-forward {
        cursor: pointer;
        margin: 0 18px 0 2px;
        font-size: 24px;
        color: rgba(255, 255, 255, 0.5);
      }

      .ytmd-history-back.pivotbar, .ytmd-history-forward.pivotbar {
        padding-top: 12px;
      }

      .ytmd-history-back.disabled, .ytmd-history-forward.disabled {
        cursor: not-allowed;
      }

      .ytmd-history-back:hover:not(.disabled), .ytmd-history-forward:hover:not(.disabled) {
        color: #FFFFFF;
      }

      .ytmd-hidden {
        display: none;
      }

      .ytmd-persist-volume-slider {
        opacity: 1 !important;
        pointer-events: initial !important;
      }
      
      .ytmd-player-bar-control.library-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.library-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.playlist-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.playlist-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.sleep-timer-button.active {
        color: #FFFFFF;
      }

      .ytmd-player-bar-control.download-button {
        margin-left: 4px;
        color: rgba(255, 255, 255, 0.7);
        transition: color 0.2s ease, transform 0.2s ease;
      }

      .ytmd-player-bar-control.download-button:hover {
        color: #FFFFFF;
        transform: scale(1.1);
      }

      .ytmd-player-bar-control.download-button.downloading {
        color: #3ea6ff;
        animation: ytmd-spin 1s linear infinite;
      }

      @keyframes ytmd-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .ytmd-player-bar-control.download-button.completed {
        color: #2ba640;
      }
    `)
  );
  document.head.appendChild(css);
}

function createMaterialSymbolsLink() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0";
  return link;
}

function createNavigationMenuArrows() {
  // Go back in history
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add("material-symbols-outlined", "ytmd-history-back", "disabled");
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward", "disabled");
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.classList.contains("disabled")) {
      history.forward();
    }
  });

  ipcRenderer.on("ytmView:navigationStateChanged", (event, state) => {
    if (state.canGoBack) {
      historyBackElement.classList.remove("disabled");
    } else {
      historyBackElement.classList.add("disabled");
    }

    if (state.canGoForward) {
      historyForwardElement.classList.remove("disabled");
    } else {
      historyForwardElement.classList.add("disabled");
    }
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    // New YTM UI
    const searchBar = document.querySelector("ytmusic-search-box");
    const navBar = searchBar.parentNode;
    navBar.insertBefore(historyForwardElement, searchBar);
    navBar.insertBefore(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}

function createKeyboardNavigation() {
  const keyboardNavigation = document.createElement("div");
  keyboardNavigation.tabIndex = 32767;
  keyboardNavigation.onfocus = () => {
    keyboardNavigation.blur();
    ipcRenderer.send("ytmView:switchFocus", "main");
  };
  document.body.appendChild(keyboardNavigation);
}

async function createAdditionalPlayerBarControls() {
  (await webFrame.executeJavaScript(playerBarControlsScript))();
}

async function hideChromecastButton() {
  (
    await webFrame.executeJavaScript(`
      (function() {
        window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
      })
    `)
  )();
}

async function hookPlayerApiEvents() {
  (await webFrame.executeJavaScript(hookPlayerApiEventsScript))();
}

async function hookSkipSilence() {
  try {
    const isEnabled = (await store.get("playback")).skipSilence ?? true;
    await webFrame.executeJavaScript(skipSilenceScript);
    await webFrame.executeJavaScript(`
      (function() {
        window.dispatchEvent(new CustomEvent("ytmd:skipsilence:toggle", { detail: { enabled: ${isEnabled} } }));
      })();
    `);
  } catch (err) {
    console.error("[YTMD] Failed to initialize SkipSilence:", err);
  }
}

function overrideHistoryButtonDisplay() {
  // @ts-expect-error Style is reported as readonly but this still works
  document.querySelector<HTMLElement>("#history-link .history-button").style = "display: inline-block !important;";
}

function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

// This function helps hook YTM
(async function () {
  (
    await webFrame.executeJavaScript(`
    (function() {
      window.__YTMD_HOOK__ = {};

      let fakeBaseClass = function() {
        try {
          if (window.__YTMD_HOOK__) {
            if (this.hostElement && this.hostElement.nodeName === "YTMUSIC-PLAYER-BAR") {
              window.__YTMD_HOOK__.ytmPlayerBar = this
            }

            if (this.store && !!this.store.getState && !!this.store.dispatch && !!this.store.subscribe) {
              window.__YTMD_HOOK__.ytmStore = this.store
            }
          }
        } catch {}
      }
      Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
        set: (value) => {},
        get: () => {
          return fakeBaseClass
        }
      })
    })
  `)
  )();
})();

function setupAdBlockerAndSkipper() {
  const injectStyle = () => {
    if (document.getElementById("ytmd-adblock-styles")) return;
    const adStyle = document.createElement("style");
    adStyle.id = "ytmd-adblock-styles";
    adStyle.textContent = `
      .video-ads,
      .ytp-ad-module,
      .ytp-ad-player-overlay,
      .ytp-ad-player-overlay-layout,
      .ytp-ad-overlay-container,
      .ytp-ad-image-overlay,
      .ytp-ad-text-overlay,
      ytmusic-mealbar-promo-renderer,
      ytmusic-upsell-dialog-renderer,
      #mealbar,
      .mealbar-promo-renderer,
      ytmusic-popup-container ytmusic-mealbar-promo-renderer {
        display: none !important;
      }
    `;
    (document.head || document.documentElement)?.appendChild(adStyle);
  };

  injectStyle();

  const skipAds = () => {
    try {
      injectStyle();

      // Dismiss promo popups ("Try Music Premium", etc.)
      const promo = document.querySelector<HTMLElement>("ytmusic-mealbar-promo-renderer");
      if (promo) {
        const dismissBtn = promo.querySelector<HTMLElement>("#dismiss-button button, yt-button-renderer#dismiss-button");
        if (dismissBtn) {
          dismissBtn.click();
        } else {
          promo.remove();
        }
      }

      // Auto-confirm "Are you still listening?"
      const youThere = document.querySelector<HTMLElement>("ytmusic-you-there-renderer");
      if (youThere) {
        const confirmBtn = youThere.querySelector<HTMLElement>("button, yt-button-renderer");
        if (confirmBtn) {
          confirmBtn.click();
        }
      }

      // Check if video is playing an ad
      const player = document.querySelector<HTMLElement>("#movie_player, .html5-video-player");
      const isAdShowing = player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting");
      const video = document.querySelector<HTMLVideoElement>("video");

      if (isAdShowing) {
        if (video) {
          video.muted = true;
          video.playbackRate = 16.0;
          if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
            video.currentTime = video.duration;
          }
        }

        const skipButtons = document.querySelectorAll<HTMLElement>(
          ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button, button[class*='skip-button']"
        );
        skipButtons.forEach(btn => btn.click());

        const closeOverlayButtons = document.querySelectorAll<HTMLElement>(".ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container");
        closeOverlayButtons.forEach(btn => btn.click());
      }
    } catch {
      // Ignore
    }
  };

  setInterval(skipAds, 200);

  const observer = new MutationObserver(() => {
    skipAds();
  });

  const attachObserver = () => {
    const target = document.querySelector("#movie_player") || document.body;
    if (target) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"]
      });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachObserver);
  } else {
    attachObserver();
  }
}

const initializeYTMView = async () => {
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:loaded");
    }
    return;
  }

  setupAdBlockerAndSkipper();

  try {
    const materialSymbols = createMaterialSymbolsLink();
    document.head.appendChild(materialSymbols);
  } catch {
    // Ignore error
  }

  await new Promise<void>(resolve => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      let hooked = false;
      try {
        hooked = await webFrame.executeJavaScript(`
            (function() {
              return !!(window.__YTMD_HOOK__ && window.__YTMD_HOOK__.ytmStore && window.__YTMD_HOOK__.ytmPlayerBar && window.__YTMD_HOOK__.ytmPlayerBar.playerApi);
            })()
          `);
      } catch {
        // Ignore error
      }

      if (hooked || attempts > 20) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });

  await new Promise<void>(resolve => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      let playerApiReady = false;
      try {
        playerApiReady = await webFrame.executeJavaScript(`
            (function() {
              try {
                return window.__YTMD_HOOK__?.ytmPlayerBar?.playerApi?.isReady() ?? true;
              } catch (e) {
                return true;
              }
            })()
          `);
      } catch {
        // Ignore error
      }

      if (playerApiReady || attempts > 20) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });

  // Signal loaded to dismiss splash screen immediately
  ipcRenderer.send("ytmView:loaded");

  try {
    createStyleSheet();
  } catch (e) {
    console.error("[YTMD] createStyleSheet error:", e);
  }
  try {
    createNavigationMenuArrows();
  } catch (e) {
    console.error("[YTMD] createNavigationMenuArrows error:", e);
  }
  try {
    createKeyboardNavigation();
  } catch (e) {
    console.error("[YTMD] createKeyboardNavigation error:", e);
  }
  try {
    await createAdditionalPlayerBarControls();
  } catch (e) {
    console.error("[YTMD] createAdditionalPlayerBarControls error:", e);
  }
  try {
    await hideChromecastButton();
  } catch (e) {
    console.error("[YTMD] hideChromecastButton error:", e);
  }
  try {
    await hookPlayerApiEvents();
  } catch (e) {
    console.error("[YTMD] hookPlayerApiEvents error:", e);
  }
  try {
    await hookSkipSilence();
  } catch (e) {
    console.error("[YTMD] hookSkipSilence error:", e);
  }
  try {
    overrideHistoryButtonDisplay();
  } catch (e) {
    console.error("[YTMD] overrideHistoryButtonDisplay error:", e);
  }

  const integrationScripts: { [integrationName: string]: { [scriptName: string]: string } } = await ipcRenderer.invoke("ytmView:getIntegrationScripts");

  const state = await store.get("state");
  const continueWhereYouLeftOff = (await store.get("playback")).continueWhereYouLeftOff;

  if (continueWhereYouLeftOff) {
    // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
    if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
      if (state.lastVideoId) {
        // This height transition check is a hack to fix the `Start playback` hint from not being in the correct position https://github.com/ytmdesktop/ytmdesktop/issues/1159
        let heightTransitionCount = 0;
        const transitionEnd = async (e: TransitionEvent) => {
          if (e.target === document.querySelector("ytmusic-app-layout>ytmusic-player-bar")) {
            if (e.propertyName === "height") {
              (
                await webFrame.executeJavaScript(`
                  (function() {
                    document.querySelector("ytmusic-popup-container").refitPopups_();
                  })
                `)
              )();
              heightTransitionCount++;
              if (heightTransitionCount >= 2) {
                document.querySelector("ytmusic-app-layout>ytmusic-player-bar").removeEventListener("transitionend", transitionEnd);
              }
            }
          }
        };
        document.querySelector("ytmusic-app-layout>ytmusic-player-bar").addEventListener("transitionend", transitionEnd);

        document.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: {
              endpoint: {
                watchEndpoint: {
                  videoId: state.lastVideoId,
                  playlistId: state.lastPlaylistId
                }
              }
            }
          })
        );
      }
    } else {
      (
        await webFrame.executeJavaScript(`
          (function() {
            let playerResponse = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse();
            if (playerResponse) {
              window.ytmd.sendVideoData(playerResponse.videoDetails, window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlaylistId());
            }
          })
        `)
      )();
    }
  }

  const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
  if (alwaysShowVolumeSlider) {
    document.querySelector("ytmusic-app-layout>ytmusic-player-bar #volume-slider").classList.add("ytmd-persist-volume-slider");
  }

  ipcRenderer.on("remoteControl:execute", async (_event, command, value) => {
    switch (command) {
      case "playPause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playing ? window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo() : window.__YTMD_HOOK__.ytmPlayerBar.playerApi.playVideo();
            })
          `)
        )();
        break;
      }

      case "play": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.playVideo();
            })
          `)
        )();
        break;
      }

      case "pause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.pauseVideo();
            })
          `)
        )();
        break;
      }

      case "next": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.nextVideo();
            })
          `)
        )();
        break;
      }

      case "previous": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.previousVideo();
            })
          `)
        )();
        break;
      }

      case "toggleLike": {
        (await webFrame.executeJavaScript(toggleLikeScript))();
        break;
      }

      case "toggleDislike": {
        (await webFrame.executeJavaScript(toggleDislikeScript))();
        break;
      }

      case "volumeUp": {
        const currentVolumeUp: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getVolume();
            })
          `)
        )();

        let newVolumeUp = currentVolumeUp + 10;
        if (currentVolumeUp > 100) {
          newVolumeUp = 100;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeUp) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(newVolumeUp);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeUp });
            })
          `)
        )(newVolumeUp);
        break;
      }

      case "volumeDown": {
        const currentVolumeDown: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getVolume();
            })
          `)
        )();

        let newVolumeDown = currentVolumeDown - 10;
        if (currentVolumeDown < 0) {
          newVolumeDown = 0;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeDown) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(newVolumeDown);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeDown });
            })
          `)
        )(newVolumeDown);
        break;
      }

      case "setVolume": {
        const valueInt: number = parseInt(value);
        // Check if Volume is a number and between 0 and 100
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
          return;
        }

        (
          await webFrame.executeJavaScript(`
            (function(valueInt) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(valueInt);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: valueInt });
            })
          `)
        )(valueInt);
        break;
      }

      case "mute":
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.mute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: true });
            })
          `)
        )();
        break;

      case "unmute":
        (
          await webFrame.executeJavaScript(`
            (function() {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.unMute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: false });
            })
          `)
        )();
        break;

      case "repeatMode":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_REPEAT', payload: value });
            })
          `)
        )(value);
        break;

      case "seekTo":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              window.__YTMD_HOOK__.ytmPlayerBar.playerApi.seekTo(value);
            })
          `)
        )(value);
        break;

      case "shuffle":
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").queue.shuffle();
            })
          `)
        )();
        break;

      case "playQueueIndex": {
        const index: number = parseInt(value);

        (
          await webFrame.executeJavaScript(`
            (function(index) {
              const state = window.__YTMD_HOOK__.ytmStore.getState();
              const queue = state.queue;

              const maxQueueIndex = state.queue.items.length - 1;
              const maxAutoMixQueueIndex = Math.max(state.queue.automixItems.length - 1, 0);

              let useAutoMix = false;
              if (index > maxQueueIndex) {
                index = index - state.queue.items.length;
                useAutoMix = true;
              }

              let song = null;
              if (!useAutoMix) {
                song = queue.items[index];
              } else {
                song = queue.automixItems[index];
              }

              let playlistPanelVideoRenderer;
              if (song.playlistPanelVideoRenderer) {
                playlistPanelVideoRenderer = song.playlistPanelVideoRenderer;
              } else if (song.playlistPanelVideoWrapperRenderer) {
                playlistPanelVideoRenderer = song.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
              }

              document.dispatchEvent(
                new CustomEvent("yt-navigate", {
                  detail: {
                    endpoint: {
                      watchEndpoint: playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint
                    }
                  }
                })
              );
            })
          `)
        )(index);

        break;
      }

      case "navigate": {
        const endpoint = value;
        document.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: {
              endpoint
            }
          })
        );
        break;
      }
    }
  });

  ipcRenderer.on("ytmView:getPlaylists", async (_event, requestId) => {
    const rawPlaylists = await (await webFrame.executeJavaScript(getPlaylistsScript))();

    const playlists = [];
    for (const rawPlaylist of rawPlaylists) {
      const playlist = rawPlaylist.playlistAddToOptionRenderer;
      playlists.push({
        id: playlist.playlistId,
        title: getYTMTextRun(playlist.title.runs)
      });
    }
    ipcRenderer.send(`ytmView:getPlaylists:response:${requestId}`, playlists);
  });

  store.onDidAnyChange(async (newState, oldState) => {
    if (newState.playback?.skipSilence !== oldState?.playback?.skipSilence) {
      await webFrame.executeJavaScript(`
        (function() {
          window.dispatchEvent(new CustomEvent("ytmd:skipsilence:toggle", { detail: { enabled: ${newState.playback.skipSilence} } }));
        })()
      `);
    }

    if (newState.appearance.alwaysShowVolumeSlider) {
      const volumeSlider = document.querySelector("#volume-slider");
      if (!volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.add("ytmd-persist-volume-slider");
      }
    } else {
      const volumeSlider = document.querySelector("#volume-slider");
      if (volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.remove("ytmd-persist-volume-slider");
      }
    }
  });

  ipcRenderer.on("ytmView:refitPopups", async () => {
    // Update 4/14/2024: Broken until a hook is provided for this
    /*
    (
      await webFrame.executeJavaScript(`
        (function() {
          document.querySelector("ytmusic-popup-container").refitPopups_();
        })
      `)
    )();
    */
  });

  ipcRenderer.on("ytmView:executeScript", async (_event, integrationName, scriptName) => {
    const scripts = integrationScripts[integrationName];
    if (scripts) {
      const script = scripts[scriptName];
      if (script) {
        (await webFrame.executeJavaScript(script))();
      }
    }
  });
};

if (document.readyState === "complete") {
  initializeYTMView();
} else {
  window.addEventListener("load", initializeYTMView);
}
