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

import { ipcRenderer, webFrame } from "electron";
import Store from "../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";

import scriptsRaw from "./scripts?raw";

const store = new Store<StoreSchema>();

let protectedApiBound = false;
window.addEventListener("message", async event => {
  if (event.data === "protected-api-port" && !protectedApiBound) {
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

  if (event.data.op && event.data.op === "ytmd-errored") {
    ipcRenderer.send("ytmView:errored", event.data.error);
  }
});

webFrame.executeJavaScript(scriptsRaw);