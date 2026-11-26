// IMPORTANT NOTES ABOUT THIS FILE
//
// This file contains all logic related to interacting with YTM itself and works under the assumption of a trusted environment and data.
// Anything passed to this file does not necessarily need to be or will be validated.
//
// If adding new things to this file ensure best security practices are followed.
// - executeJavaScript is used to enter the main world when you need to interact with YTM APIs or anything from YTM that would otherwise need the prototypes or events from YTM.
//   - Always wrap your executeJavaScript code in an IIFE calling it from outside executeJavaScript when it returns
// - Add functions to exposeInMainWorld when you need to call back to the main program. By nature you should not trust data coming from this.

// Early bail if the page isn't YTM. This could be an account login or something else
if (window.location.hostname !== "music.youtube.com") {
  throw new Error("[YTMDFastFail]: THIS IS NOT AN ERROR! Location not applicable bailing preload");
}

import { contextBridge, ipcRenderer, webFrame } from "electron";
import { installCastBridge } from "electron-cast/preload";
import Store from "../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";

import scriptsRaw from "./scripts?raw";

const store = new Store<StoreSchema>();

// Asked synchronously because the bridge has to be in place before YTM's scripts run. Main answers with what it is
// serving, so the page and main always agree (the setting only applies after a restart).
const castingEnabled = ipcRenderer.sendSync("castManager:isEnabled") !== false;

// Gives the Presentation API a backend before YTM's scripts run, so Google's Cast SDK (loaded by YTM) finds devices
// and its own cast button casts through the main process.
if (castingEnabled) installCastBridge({ contextBridge, ipcRenderer });

let protectedApiBound = false;
window.addEventListener("message", async event => {
  if (event.data === "ytmd-protected-api-port" && !protectedApiBound) {
    ipcRenderer.postMessage("protectedApi:bindPort", null, [...event.ports]);
    protectedApiBound = true;
  }

  if (event.data.op && event.data.op === "ytmd-ready") {
    ipcRenderer.send("ytmView:ready", event.data.completions);

    // TODO: Move all the below be part of the ProtectedAPI system within this block
    const state = await store.get("state");
    const continueWhereYouLeftOff = (await store.get("playback")).continueWhereYouLeftOff;

    if (continueWhereYouLeftOff) {
      // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
      if (!window.location.pathname.startsWith("/watch")) {
        if (state.lastVideoId) {
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
            const playerApi = window.__YTMD_HOOK__.ytmPlayerController.playerApi;
            if (playerApi.getPlayerResponse()) window.ytmd.sendVideoData(playerApi.getPlayerResponse().videoDetails, playerApi.getPlaylistId());
          })
        `)
        )();
      }
    }

    if (!castingEnabled) {
      // Without the bridge nothing answers Google's Cast SDK, so hide YTM's cast button. YTM sets it available again
      // from its own code, so keep overriding it.
      (
        await webFrame.executeJavaScript(`
          (function() {
            const ytmStore = window.__YTMD_HOOK__.ytmStateStore.store;
            const hide = () => {
              try {
                if (ytmStore.getState().castStatus.castAvailable) ytmStore.dispatch({ type: "SET_CAST_AVAILABLE", payload: false });
              } catch (err) {
                console.error("[ytmd-err(hideCastButton)]", err);
              }
            };
            hide();
            ytmStore.subscribe(hide);
          })
        `)
      )();
    }

    const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
    if (alwaysShowVolumeSlider) {
      document.querySelector("ytmusic-app-layout>ytmusic-player-bar #volume-slider")?.classList.add("ytmd-persist-volume-slider");
    }

    store.onDidAnyChange(newState => {
      if (newState.appearance.alwaysShowVolumeSlider) {
        const volumeSlider = document.querySelector("#volume-slider");
        if (volumeSlider && !volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
          volumeSlider.classList.add("ytmd-persist-volume-slider");
        }
      } else {
        const volumeSlider = document.querySelector("#volume-slider");
        if (volumeSlider && volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
          volumeSlider.classList.remove("ytmd-persist-volume-slider");
        }
      }
    });

    ipcRenderer.on("ytmView:executeScript", async (_event, script) => {
      (await webFrame.executeJavaScript(script))();
    });
  }

  // Cast session persistence (see scripts/setup/cast.ts). Nothing is answered or kept while casting is disabled.
  if (castingEnabled && event.source === window && event.data?.op) {
    if (event.data.op === "ytmd-cast-request-saved-session") {
      const session = ipcRenderer.sendSync("castManager:takeSavedSession");
      if (session) window.postMessage({ op: "ytmd-cast-saved-session", session }, "/");
    } else if (event.data.op === "ytmd-cast-session") {
      ipcRenderer.send("castManager:sessionChanged", event.data.session);
    }
  }

  if (event.data.op && event.data.op === "ytmd-errored") {
    ipcRenderer.send("ytmView:errored", event.data.error);
  }
});

webFrame.executeJavaScript(scriptsRaw);