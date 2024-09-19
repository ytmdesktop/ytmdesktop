import { ipcRenderer, webFrame } from "electron";
import toggleLikeScript from "../scripts/togglelike.script";
import toggleDislikeScript from "../scripts/toggledislike.script";
import getPlaylistsScript from "../scripts/getplaylists.script";

function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

export function attachIPCListeners() {
  ipcRenderer.on("remoteControl:execute", async (_event, command, value) => {
    switch (command) {
      case "playPause": {
        (
          await webFrame.executeJavaScript(`
          (function() {
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playing ? document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.pauseVideo() : document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.playVideo();
          })
        `)
        )();
        break;
      }

      case "play": {
        (
          await webFrame.executeJavaScript(`
          (function() {
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.playVideo();
          })
        `)
        )();
        break;
      }

      case "pause": {
        (
          await webFrame.executeJavaScript(`
          (function() {
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.pauseVideo();
          })
        `)
        )();
        break;
      }

      case "next": {
        (
          await webFrame.executeJavaScript(`
          (function() {
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.nextVideo();
          })
        `)
        )();
        break;
      }

      case "previous": {
        (
          await webFrame.executeJavaScript(`
          (function() {
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.previousVideo();
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

  ipcRenderer.on("remoteControl:getPlaylists", async (_event, requestId) => {
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

  ipcRenderer.on("remoteControl:executeScript", async (_event, script) => {
    (await webFrame.executeJavaScript(script))();
  });
}
