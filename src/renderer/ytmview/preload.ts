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
import RendererSentryIntegration from "../integrations/sentry";

import playerBarControlsScript from "./scripts/playerbarcontrols.script?raw";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script?raw";
import getPlaylistsScript from "./scripts/getplaylists.script?raw";
import toggleLikeScript from "./scripts/togglelike.script?raw";
import toggleDislikeScript from "./scripts/toggledislike.script?raw";

const store = new Store<StoreSchema>();

// Initialize Sentry integration (only once, through the integration class)
const sentryIntegration = new RendererSentryIntegration();
sentryIntegration.enable();

// #region agent log (debug instrumentation)
let __ytmdIngestEnabled = true; // Default to true for active debug sessions; will be updated by async check
// Check setting asynchronously, but don't block logging (logs will be sent even if setting check hasn't completed)
ipcRenderer
  .invoke("settings:get", "developer.debugLoggingEnabled")
  .then(v => {
    __ytmdIngestEnabled = Boolean(v);
  })
  .catch(() => {
    // If setting check fails, keep logging enabled for debug sessions
    __ytmdIngestEnabled = true;
  });

const __ytmdDbgPlay = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void => {
  try {
    if (!__ytmdIngestEnabled) return;
    fetch("http://127.0.0.1:7244/ingest/0a7fc512-60ca-4a36-8768-23f664c122af", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "debug-session", runId: "vinyl-play-1", hypothesisId, location, message, data, timestamp: Date.now() })
    }).catch((): void => undefined);
  } catch {
    // ignore
  }
};
// #endregion agent log (debug instrumentation)

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) => {
    // #region agent log (debug instrumentation)
    try {
      if (__ytmdIngestEnabled) {
        fetch("http://127.0.0.1:7244/ingest/0a7fc512-60ca-4a36-8768-23f664c122af", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "debug-session",
            runId: "resume-2",
            hypothesisId: "R2",
            location: "ytmview/preload.ts:sendVideoData",
            message: "sendVideoData called",
            data: {
              hasVideoId: typeof videoDetails === "object" && videoDetails !== null && "videoId" in videoDetails,
              playlistId: String(playlistId || ""),
              hasAlbum: Boolean(album?.id),
              hasFullMetadata: Boolean(hasFullMetadata)
            },
            timestamp: Date.now()
          })
        }).catch((): void => undefined);
      }
    } catch {
      // ignore
    }
    // #endregion agent log (debug instrumentation)
    ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata);
  },
  sendStoreUpdate: (queueState: unknown, likeStatus: string, volume: number, muted: boolean, adPlaying: boolean) =>
    ipcRenderer.send("ytmView:storeStateChanged", queueState, likeStatus, volume, muted, adPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmView:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmView:deletePlaylistObserved", playlistId)
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

      /* Fix for storage access permission errors */
      yt-button-shape, tp-yt-paper-icon-button {
        pointer-events: auto !important;
      }

      /* Fix for CORS issues */
      * {
        --ytmd-cors-fix: none;
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
  const result: unknown = await webFrame.executeJavaScript(hookPlayerApiEventsScript);

  // The injected script may either:
  // - return a callable function (legacy pattern), or
  // - self-invoke and return `undefined` (current pattern).
  if (typeof result === "function") {
    (result as () => void)();
  }
}

function overrideHistoryButtonDisplay() {
  const historyButton = document.querySelector<HTMLElement>("#history-link .history-button");
  if (historyButton) {
    historyButton.setAttribute("style", "display: inline-block !important;");
  }
}

function handleStorageAccessPermissions() {
  // Override requestStorageAccessFor to prevent permission denied errors
  if (window.requestStorageAccessFor) {
    window.requestStorageAccessFor = function (origin) {
      console.debug(`Storage access requested for ${origin}, auto-granting`);
      return Promise.resolve();
    };
  }

  // Override fetch to handle CORS issues for problematic domains
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Handle CORS issues for specific domains that are failing
    if (url && (url.includes("googleads.g.doubleclick.net") || url.includes("youtube.com/pagead"))) {
      console.debug(`Intercepting fetch request for ${url}`);

      // Return a resolved promise to prevent the request from failing
      return Promise.resolve(
        new Response("", {
          status: 200,
          statusText: "OK",
          headers: new Headers({
            "access-control-allow-origin": "*",
            "access-control-allow-credentials": "true"
          })
        })
      );
    }

    return originalFetch.call(this, input, init);
  };
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
      let ytmdHookedObjects = [];
      
      let decorate = null;
      Object.defineProperty(Reflect, "decorate", {
        set: (value) => {
          decorate = value;
        },
        get: () => {
          return (...args) => {
            if (!window.__YTMD_HOOK__) {
              let obj = args[1];
              if (typeof obj === "object") {
                ytmdHookedObjects.push(obj);
              }
            }

            return decorate(...args);
          }
        }
      });

      window.__YTMD_HOOK_OBJS__ = ytmdHookedObjects;
    })
  `)
  )();
})();

window.addEventListener("load", async () => {
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:loaded");
    }
    return;
  }

  // Add timeout to prevent infinite waiting
  let hookInterval: NodeJS.Timeout | null = null;
  let intervalCleared = false;

  const hookTimeout = setTimeout(() => {
    if (!intervalCleared && hookInterval) {
      intervalCleared = true;
      clearInterval(hookInterval);
    }
    console.warn("YouTube Music hook setup timed out, proceeding anyway");
    ipcRenderer.send("ytmView:loaded");
  }, 15000); // 15 second timeout for hook setup

  try {
    await new Promise<void>(resolve => {
      hookInterval = setInterval(async () => {
        // Prevent memory leak by checking if already cleared
        if (intervalCleared) {
          return;
        }

        try {
          const hooked = (
            await webFrame.executeJavaScript(`
            (function() {
              for (const hookedObj of window.__YTMD_HOOK_OBJS__) {
                if (hookedObj.is) {
                  if (hookedObj.is === "ytmusic-app") {
                    if (hookedObj.provide) {
                      for (const provider of hookedObj.provide) {
                        if (provider.useValue) {
                          if (provider.useValue.store) {
                            let ytmdHook = {
                              ytmStore: provider.useValue.store
                            };
                            Object.freeze(ytmdHook);
                            window.__YTMD_HOOK__ = ytmdHook;
                            break;
                          }
                        }
                      }
                    }

                    if (window.__YTMD_HOOK__) {
                      delete window.__YTMD_HOOK_OBJS__;
                      return true;
                    }
                  }
                }
              }
              
              return false;
            })
          `)
          )();

          if (hooked) {
            intervalCleared = true;
            clearInterval(hookInterval);
            clearTimeout(hookTimeout);
            resolve();
          }
        } catch (error) {
          console.error("Error in hook setup:", error);
          intervalCleared = true;
          clearInterval(hookInterval);
          clearTimeout(hookTimeout);
          resolve(); // Continue even if hook setup fails
        }
      }, 250);
    });
  } catch (error) {
    console.error("Hook setup failed:", error);
    clearTimeout(hookTimeout);
  }

  let materialSymbolsLoaded = false;

  const materialSymbols = createMaterialSymbolsLink();
  materialSymbols.onload = () => {
    materialSymbolsLoaded = true;
  };
  materialSymbols.onerror = () => {
    console.warn("Material symbols failed to load, proceeding anyway");
    materialSymbolsLoaded = true; // Treat as loaded to prevent infinite waiting
  };
  document.head.appendChild(materialSymbols);

  // Add timeout for material symbols and player API
  let apiInterval: NodeJS.Timeout | null = null;
  let apiIntervalCleared = false;

  const apiTimeout = setTimeout(() => {
    if (!apiIntervalCleared && apiInterval) {
      apiIntervalCleared = true;
      clearInterval(apiInterval);
    }
    console.warn("Player API setup timed out, proceeding anyway");
    ipcRenderer.send("ytmView:loaded");
  }, 10000); // 10 second timeout for API setup

  try {
    await new Promise<void>(resolve => {
      apiInterval = setInterval(async () => {
        // Prevent memory leak by checking if already cleared
        if (apiIntervalCleared) {
          return;
        }

        try {
          const playerApiReady: boolean = (
            await webFrame.executeJavaScript(`
              (function() {
                const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
                return playerBar && playerBar.playerApi && playerBar.playerApi.isReady();
              })
            `)
          )();

          if (materialSymbolsLoaded && playerApiReady) {
            apiIntervalCleared = true;
            clearInterval(apiInterval);
            clearTimeout(apiTimeout);
            resolve();
          }
        } catch (error) {
          console.error("Error checking player API:", error);
          // Continue anyway if API check fails
          if (materialSymbolsLoaded) {
            apiIntervalCleared = true;
            clearInterval(apiInterval);
            clearTimeout(apiTimeout);
            resolve();
          }
        }
      }, 250);
    });
  } catch (error) {
    console.error("Player API setup failed:", error);
    clearTimeout(apiTimeout);
  }

  try {
    createStyleSheet();
    handleStorageAccessPermissions();
    createNavigationMenuArrows();
    createKeyboardNavigation();
    await createAdditionalPlayerBarControls();
    await hideChromecastButton();
    await hookPlayerApiEvents();
    overrideHistoryButtonDisplay();

    // #region agent log (debug instrumentation)
    const __ytmdDbg = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
      try {
        fetch("http://127.0.0.1:7244/ingest/0a7fc512-60ca-4a36-8768-23f664c122af", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: "debug-session", runId: "resume-1", hypothesisId, location, message, data, timestamp: Date.now() })
        }).catch(() => undefined);
      } catch {
        // swallow
      }
    };
    // #endregion agent log (debug instrumentation)

    const integrationScripts: { [integrationName: string]: { [scriptName: string]: string } } = await ipcRenderer.invoke("ytmView:getIntegrationScripts");

    const state = await store.get("state");
    const continueWhereYouLeftOff = (await store.get("playback")).continueWhereYouLeftOff;

    // #region agent log (debug instrumentation)
    __ytmdDbg("R1", "ytmview/preload.ts:resume", "resume check", {
      continueWhereYouLeftOff: Boolean(continueWhereYouLeftOff),
      lastUrl: String(state.lastUrl || ""),
      lastVideoId: String(state.lastVideoId || ""),
      lastPlaylistId: String(state.lastPlaylistId || "")
    });
    // #endregion agent log (debug instrumentation)

    if (continueWhereYouLeftOff) {
      // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
      if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
        if (state.lastVideoId) {
          // #region agent log (debug instrumentation)
          __ytmdDbg("R2", "ytmview/preload.ts:resume", "dispatching yt-navigate to last video", {
            lastVideoId: String(state.lastVideoId),
            lastPlaylistId: String(state.lastPlaylistId || "")
          });
          // #endregion agent log (debug instrumentation)
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
        // #region agent log (debug instrumentation)
        __ytmdDbg("R3", "ytmview/preload.ts:resume", "lastUrl is watch page; sending videoData snapshot", {});
        // #endregion agent log (debug instrumentation)
        (
          await webFrame.executeJavaScript(`
          (function() {
            window.ytmd.sendVideoData(document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails, document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlaylistId());
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
          // #region agent log (debug instrumentation)
          __ytmdDbgPlay("VP3", "ytmview/preload.ts:remoteControl:playPause", "received", { value: value ?? null });
          // #endregion agent log (debug instrumentation)

          // Snapshot before attempting the action (in main world)
          const before = (await webFrame.executeJavaScript(`
            (function() {
              try {
                const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
                return {
                  hasBar: Boolean(bar),
                  hasApi: Boolean(bar && bar.playerApi),
                  playing: Boolean(bar && bar.playing),
                  userActivation: (navigator.userActivation ? { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive } : null)
                };
              } catch (e) {
                return { error: String(e) };
              }
            })()
          `)) as unknown;

          // #region agent log (debug instrumentation)
          __ytmdDbgPlay("VP3", "ytmview/preload.ts:remoteControl:playPause", "before", { before });
          // #endregion agent log (debug instrumentation)

          const actionResult = await webFrame.executeJavaScript(
            `
            (function() {
              try {
                const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
                if (!bar || !bar.playerApi) return { ok: false, reason: "no-bar-or-api" };
                if (bar.playing) {
                  bar.playerApi.pauseVideo();
                } else {
                  bar.playerApi.playVideo();
                }
                return { ok: true };
              } catch (e) {
                return { ok: false, error: String(e) };
              }
            })()
          `,
            true
          );

          // #region agent log (debug instrumentation)
          __ytmdDbgPlay("VP3", "ytmview/preload.ts:remoteControl:playPause", "actionResult", { actionResult });
          // #endregion agent log (debug instrumentation)

          // Wait a brief moment for player state to update (YTM player API is asynchronous)
          await new Promise(resolve => setTimeout(resolve, 100));

          // Snapshot after attempting the action
          const after = (await webFrame.executeJavaScript(`
            (function() {
              try {
                const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
                return {
                  hasBar: Boolean(bar),
                  hasApi: Boolean(bar && bar.playerApi),
                  playing: Boolean(bar && bar.playing),
                  userActivation: (navigator.userActivation ? { isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive } : null)
                };
              } catch (e) {
                return { error: String(e) };
              }
            })()
          `)) as unknown;

          // #region agent log (debug instrumentation)
          __ytmdDbgPlay("VP3", "ytmview/preload.ts:remoteControl:playPause", "after", { after });
          // #endregion agent log (debug instrumentation)

          break;
        }

        case "play": {
          await webFrame.executeJavaScript(
            `
            (function() {
              const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
              if (bar && bar.playerApi) bar.playerApi.playVideo();
            })()
          `,
            true
          );
          break;
        }

        case "pause": {
          await webFrame.executeJavaScript(
            `
            (function() {
              const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
              if (bar && bar.playerApi) bar.playerApi.pauseVideo();
            })()
          `,
            true
          );
          break;
        }

        case "next": {
          await webFrame.executeJavaScript(
            `
            (function() {
              const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
              if (bar && bar.playerApi) bar.playerApi.nextVideo();
            })()
          `,
            true
          );
          break;
        }

        case "previous": {
          await webFrame.executeJavaScript(
            `
            (function() {
              const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
              if (bar && bar.playerApi) bar.playerApi.previousVideo();
            })()
          `,
            true
          );
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
              return document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getVolume();
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
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.setVolume(newVolumeUp);
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
              return document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getVolume();
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
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.setVolume(newVolumeDown);
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
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.setVolume(valueInt);
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
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.mute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: true });
            })
          `)
          )();
          break;

        case "unmute":
          (
            await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.unMute();
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
              document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(value);
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

    store.onDidAnyChange(newState => {
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
  } catch (error) {
    console.error("Error during YouTube Music initialization:", error);
  } finally {
    // Always send the loaded signal, even if initialization fails
    ipcRenderer.send("ytmView:loaded");
  }
});
