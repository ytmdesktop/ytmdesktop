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

import { ChromecastSetup, EarlySetup, ExtraControlsSetup, ExtrasSetup, HooksSetup, NavigationSetup, RemoteSetup, StylesSetup } from "./setup.ts";

import { YTMViewSetupCompletionFlags } from "~shared/types";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmApi:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmApi:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) =>
    ipcRenderer.send("ytmApi:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata),
  sendStoreUpdate: (queueState: unknown, likeStatus: string, volume: number, muted: boolean, adPlaying: boolean) =>
    ipcRenderer.send("ytmApi:storeStateChanged", queueState, likeStatus, volume, muted, adPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmApi:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmApi:deletePlaylistObserved", playlistId)
});

/*function createKeyboardNavigation() {
  const keyboardNavigation = document.createElement("div");
  keyboardNavigation.tabIndex = 32767;
  keyboardNavigation.onfocus = () => {
    keyboardNavigation.blur();
    ipcRenderer.send("ytmView:switchFocus", "main");
  };
  document.body.appendChild(keyboardNavigation);
}*/

// YTM internalizes itself so we can't call into it. This runs before YTM does and allows us to hook into it.
EarlySetup.hookYTMObjects();

window.addEventListener("load", async () => {
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:ready");
    }
    return;
  }

  // TODO: This is not currently fully utilized yet
  let setupCompletions = YTMViewSetupCompletionFlags.None;
  try {
    {
      EarlySetup.waitForYTMObjectHooks();

      setupCompletions |= YTMViewSetupCompletionFlags.Early;
    }

    {
      StylesSetup.createStyleSheet();

      const materialSymbols = StylesSetup.createMaterialSymbolsLink();
      let materialSymbolsLoaded = false;
      materialSymbols.onload = () => {
        materialSymbolsLoaded = true;
      };
      document.head.appendChild(materialSymbols);

      await new Promise<void>(resolve => {
        const interval = setInterval(async () => {
          if (materialSymbolsLoaded) {
            clearInterval(interval);
            resolve();
          }
        }, 250);
      });

      setupCompletions |= YTMViewSetupCompletionFlags.Styles;
    }

    {
      NavigationSetup.createNavigationMenuArrows();

      setupCompletions |= YTMViewSetupCompletionFlags.Navigation;
    }

    {
      ChromecastSetup.hideChromecastButton();

      setupCompletions |= YTMViewSetupCompletionFlags.Chromecast;
    }

    {
      await HooksSetup.waitForReady();
      await HooksSetup.hookPlayerApiEvents();

      setupCompletions |= YTMViewSetupCompletionFlags.Hooks;
    }

    {
      await ExtraControlsSetup.createAdditionalPlayerBarControls();

      setupCompletions |= YTMViewSetupCompletionFlags.ExtraControls;
    }

    {
      await ExtrasSetup.overrideHistoryButtonDisplay();

      setupCompletions |= YTMViewSetupCompletionFlags.Extras;
    }

    {
      RemoteSetup.attachIPCListeners();

      setupCompletions |= YTMViewSetupCompletionFlags.Remote;
    }

    //createKeyboardNavigation();

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
            const playerApi = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi;
            if (playerApi.getPlayerResponse()) window.ytmd.sendVideoData(playerApi.getPlayerResponse().videoDetails, playerApi.getPlaylistId());
          })
        `)
        )();
      }
    }

    const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
    if (alwaysShowVolumeSlider) {
      document.querySelector("ytmusic-app-layout>ytmusic-player-bar #volume-slider").classList.add("ytmd-persist-volume-slider");
    }

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

    ipcRenderer.send("ytmView:ready", setupCompletions);
  } catch (error) {
    ipcRenderer.send("ytmView:errored", error);
    ipcRenderer.send("ytmView:ready", setupCompletions);
  }
});
