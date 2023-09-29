// IMPORTANT NOTES ABOUT THIS FILE
//
// This file contains all logic related to interacting with YTM itself and works under the assumption of a trusted environment and data.
// Anything passed to this file does not necessarily need to be or will be validated.
//
// If adding new things to this file ensure best security practices are followed.
// - executeJavaScript is used to enter the main world when you need to interact with YTM APIs or anything from YTM that would otherwise need the prototypes or events from YTM.
//   - Always wrap your executeJavaScript code in brackets to scope it so you don't accidentally make variables or other data global
// - Add functions to exposeInMainWorld when you need to call back to the main program. By nature you should not trust data coming from this.

import { contextBridge, ipcRenderer, webFrame } from "electron";
import Store from "../shared/store/renderer";
import { StoreSchema } from "../shared/store/schema";

import playerBarControlsScript from "./scripts/playerbarcontrols.script";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script";
import getPlaylistsScript from "./scripts/getplaylists.script";
import toggleLikeScript from "./scripts/togglelike.script";
import toggleDislikeScript from "./scripts/toggledislike.script";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string) => ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId),
  sendAdState: (adRunning: boolean) => ipcRenderer.send("ytmView:adStateChanged", adRunning),
  sendStoreUpdate: (queueState: unknown, album: unknown, likeStatus: string) => ipcRenderer.send("ytmView:storeStateChanged", queueState, album, likeStatus),
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

      .ytmd-history-forward {
        transform: rotate(180deg);
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
  historyBackElement.innerText = "keyboard_backspace";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward", "disabled");
  historyForwardElement.innerText = "keyboard_backspace";

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

function createAdditionalPlayerBarControls() {
  webFrame.executeJavaScript(playerBarControlsScript);
}

function hideChromecastButton() {
  webFrame.executeJavaScript(`
    {
      document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
    }  
  `);
}

function hookPlayerApiEvents() {
  webFrame.executeJavaScript(hookPlayerApiEventsScript);
}

function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

window.addEventListener("load", async () => {
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:loaded");
    }
    return;
  }

  let materialSymbolsLoaded = false;

  const materialSymbols = createMaterialSymbolsLink();
  materialSymbols.onload = () => {
    materialSymbolsLoaded = true;
  };
  document.head.appendChild(materialSymbols);

  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const playerApiReady: boolean = await webFrame.executeJavaScript(`
        {
          document.querySelector("ytmusic-player-bar").playerApi_.isReady();
        }
      `);

      if (materialSymbolsLoaded && playerApiReady) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });

  createStyleSheet();
  createNavigationMenuArrows();
  createKeyboardNavigation();
  createAdditionalPlayerBarControls();
  hideChromecastButton();
  hookPlayerApiEvents();

  const state = await store.get("state");
  const continueWhereYouLeftOff = (await store.get("playback")).continueWhereYouLeftOff;

  if (continueWhereYouLeftOff) {
    // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
    if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
      if (state.lastVideoId) {
        // This height transition check is a hack to fix the `Start playback` hint from not being in the correct position https://github.com/ytmdesktop/ytmdesktop/issues/1159
        let heightTransitionCount = 0;
        const transitionEnd = (e: TransitionEvent) => {
          if (e.target === document.querySelector("ytmusic-player-bar")) {
            if (e.propertyName === "height") {
              webFrame.executeJavaScript(`
                {
                  document.querySelector("ytmusic-popup-container").refitPopups_();
                }
              `)
              heightTransitionCount++;
              if (heightTransitionCount >= 2) {
                document.querySelector("ytmusic-player-bar").removeEventListener("transitionend", transitionEnd);
              }
            }
          }
        }
        document.querySelector("ytmusic-player-bar").addEventListener("transitionend", transitionEnd);

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
      webFrame.executeJavaScript(`
        {
          window.ytmd.sendVideoData(document.querySelector("ytmusic-player-bar").playerApi_.getPlayerResponse().videoDetails, document.querySelector("ytmusic-player-bar").playerApi_.getPlaylistId());
        }
      `);
    }
  }

  const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
  if (alwaysShowVolumeSlider) {
    document.querySelector("#volume-slider").classList.add("ytmd-persist-volume-slider");
  }

  ipcRenderer.on("remoteControl:execute", async (_event, command, value) => {
    switch (command) {
      case "playPause": {
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playing_ ? document.querySelector("ytmusic-player-bar").playerApi_.pauseVideo() : document.querySelector("ytmusic-player-bar").playerApi_.playVideo();
          }
        `);
        break;
      }

      case "play": {
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.playVideo();
          }
        `);
        break;
      }

      case "pause": {
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.pauseVideo();
          }
        `);
        break;
      }

      case "next": {
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.nextVideo();
          }
        `);
        break;
      }

      case "previous": {
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.previousVideo();
          }
        `);
        break;
      }

      case "toggleLike": {
        webFrame.executeJavaScript(toggleLikeScript);
        break;
      }

      case "toggleDislike": {
        webFrame.executeJavaScript(toggleDislikeScript);
        break;
      }

      case "volumeUp": {
        const currentVolumeUp: number = await webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.getVolume();
          }
        `);

        let newVolumeUp = currentVolumeUp + 10;
        if (currentVolumeUp > 100) {
          newVolumeUp = 100;
        }
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.setVolume(${newVolumeUp});
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: ${newVolumeUp} });
          }
        `);
        break;
      }

      case "volumeDown": {
        const currentVolumeDown: number = await webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.getVolume();
          }
        `);

        let newVolumeDown = currentVolumeDown - 10;
        if (currentVolumeDown < 0) {
          newVolumeDown = 0;
        }
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.setVolume(${newVolumeDown});
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: ${newVolumeDown} });
          }
        `);
        break;
      }

      case "setVolume": {
        const valueInt: number = parseInt(value);
        // Check if Volume is a number and between 0 and 100
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
          return;
        }

        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.setVolume(${valueInt});
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: ${valueInt} });
          }
        `);
        break;
      }

      case "mute":
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.mute();
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_MUTED', payload: true });
          }
        `);
        break;

      case "unmute":
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.unMute();
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_MUTED', payload: false });
          }
        `);
        break;

      case "repeatMode":
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_REPEAT', payload: "${value}" });
          }
        `);
        break;

      case "seekTo":
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").playerApi_.seekTo(${value});
          }
        `);
        break;
      
      case "shuffle":
        webFrame.executeJavaScript(`
          {
            document.querySelector("ytmusic-player-bar").queue_.shuffle();
          }
        `);
        break;

      case "playQueueIndex": {
        const index: number = parseInt(value);

        webFrame.executeJavaScript(`
          {
            let index = ${index};
            const state = document.querySelector("ytmusic-player-bar").store.getState();
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
          }
        `);

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
    const rawPlaylists = await webFrame.executeJavaScript(getPlaylistsScript);

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

  ipcRenderer.on("ytmView:refitPopups", () => {
    webFrame.executeJavaScript(`
      {
        document.querySelector("ytmusic-popup-container").refitPopups_();
      }
    `);
  });

  ipcRenderer.send("ytmView:loaded");
});
