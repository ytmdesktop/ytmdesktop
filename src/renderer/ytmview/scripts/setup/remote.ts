import ytmhook from "../ytmhook";
import protectedapimanager from "../protectedapimanager";
import { getYTMTextRun } from "../utils";

export default function init() {
  const remoteApi = protectedapimanager.createOrGetAPI("RemoteControl");

  remoteApi.addEventListener("execute", event => {
    const args = event.detail.args;
    const command = args.shift();

    const ytmStore = ytmhook.ytmStateStore.store;
    const playerApi = ytmhook.ytmPlayerController.playerApi;

    switch (command) {
      case "playPause": {
        // 1 = Playing
        if (playerApi.getPlayerState() === 1) {
          playerApi.pauseVideo();
        } else {
          playerApi.playVideo();
        }

        break;
      }

      case "play": {
        playerApi.playVideo();

        break;
      }

      case "pause": {
        playerApi.pauseVideo();

        break;
      }

      case "next": {
        playerApi.nextVideo();

        break;
      }

      case "previous": {
        playerApi.previousVideo();

        break;
      }

      case "toggleLike": {
        const state = ytmStore.getState();
        const videoId = playerApi.getPlayerResponse().videoDetails.videoId;

        let serviceEndpoint = null;
        let toggledServiceEndpoint = null;

        let defaultLikeStatus = "INDIFFERENT";
        if (state.playerPage.playerOverlay.playerOverlayRenderer.actions) {
          const buttonData = state.playerPage.playerOverlay.playerOverlayRenderer.actions[0];
          defaultLikeStatus = buttonData.likeButtonRenderer.likeStatus;

          for (const endpoint of buttonData.likeButtonRenderer.serviceEndpoints) {
            if (endpoint.likeEndpoint.status === "LIKE") {
              serviceEndpoint = endpoint;
            } else if (endpoint.likeEndpoint.status === "INDIFFERENT") {
              toggledServiceEndpoint = endpoint;
            }
          }
        } else if (state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar) {
          // New player bar
          const actionBar = state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar;
          const viewModel = actionBar.videoActionBarViewModel.buttons[0].buttonViewModel.segmentedLikeDislikeButtonViewModel;
          defaultLikeStatus = viewModel.likeButtonViewModel.likeButtonViewModel.likeStatusEntity.likeStatus;

          const toggleButtonViewModel = viewModel.likeButtonViewModel.likeButtonViewModel.toggleButtonViewModel.toggleButtonViewModel;
          serviceEndpoint = toggleButtonViewModel.defaultButtonViewModel.buttonViewModel.onTap.innertubeCommand;
          toggledServiceEndpoint = toggleButtonViewModel.toggledButtonViewModel.buttonViewModel.onTap.innertubeCommand;
        }

        const storeLikeStatus = state.likeStatus.videos[videoId];
        const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;

        let serviceEvent = null;

        const ytmusicAppElement = document.querySelector("ytmusic-app");
        if (likeStatus === "LIKE") {
          serviceEvent = {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [ytmusicAppElement, toggledServiceEndpoint],
              optionalAction: false,
              returnValue: []
            }
          };
        } else {
          serviceEvent = {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [ytmusicAppElement, serviceEndpoint],
              optionalAction: false,
              returnValue: []
            }
          };
        }

        if (serviceEvent) ytmusicAppElement.dispatchEvent(new CustomEvent("yt-action", serviceEvent));

        break;
      }

      case "toggleDislike": {
        const state = ytmStore.getState();
        const videoId = playerApi.getPlayerResponse().videoDetails.videoId;

        let serviceEndpoint = null;
        let toggledServiceEndpoint = null;

        let defaultLikeStatus = "INDIFFERENT";
        if (state.playerPage.playerOverlay.playerOverlayRenderer.actions) {
          const buttonData = state.playerPage.playerOverlay.playerOverlayRenderer.actions[0];
          defaultLikeStatus = buttonData.likeButtonRenderer.likeStatus;

          for (const endpoint of buttonData.likeButtonRenderer.serviceEndpoints) {
            if (endpoint.likeEndpoint.status === "DISLIKE") {
              serviceEndpoint = endpoint;
            } else if (endpoint.likeEndpoint.status === "INDIFFERENT") {
              toggledServiceEndpoint = endpoint;
            }
          }
        } else if (state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar) {
          // New player bar
          const actionBar = state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar;
          const viewModel = actionBar.videoActionBarViewModel.buttons[0].buttonViewModel.segmentedLikeDislikeButtonViewModel;
          defaultLikeStatus = viewModel.likeButtonViewModel.likeButtonViewModel.likeStatusEntity.likeStatus;

          const toggleButtonViewModel = viewModel.dislikeButtonViewModel.dislikeButtonViewModel.toggleButtonViewModel.toggleButtonViewModel;
          serviceEndpoint = toggleButtonViewModel.defaultButtonViewModel.buttonViewModel.onTap.innertubeCommand;
          toggledServiceEndpoint = toggleButtonViewModel.toggledButtonViewModel.buttonViewModel.onTap.innertubeCommand;
        }

        const storeLikeStatus = state.likeStatus.videos[videoId];
        const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;

        let serviceEvent = null;

        const ytmusicAppElement = document.querySelector("ytmusic-app");
        if (likeStatus === "DISLIKE") {
          serviceEvent = {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [ytmusicAppElement, toggledServiceEndpoint],
              optionalAction: false,
              returnValue: []
            }
          };
        } else {
          serviceEvent = {
            bubbles: true,
            cancelable: false,
            composed: true,
            detail: {
              actionName: "yt-service-request",
              args: [ytmusicAppElement, serviceEndpoint],
              optionalAction: false,
              returnValue: []
            }
          };
        }

        if (serviceEvent) ytmusicAppElement.dispatchEvent(new CustomEvent("yt-action", serviceEvent));

        break;
      }

      case "volumeUp": {
        const currentVolumeUp = playerApi.getVolume();

        let newVolumeUp = currentVolumeUp + 10;
        if (currentVolumeUp > 100) {
          newVolumeUp = 100;
        }

        playerApi.setVolume(newVolumeUp);
        ytmStore.dispatch({ type: "SET_VOLUME", payload: newVolumeUp });

        break;
      }

      case "volumeDown": {
        const currentVolumeDown = playerApi.getVolume();

        let newVolumeDown = currentVolumeDown - 10;
        if (currentVolumeDown < 0) {
          newVolumeDown = 0;
        }

        playerApi.setVolume(newVolumeDown);
        ytmStore.dispatch({ type: "SET_VOLUME", payload: newVolumeDown });

        break;
      }

      case "setVolume": {
        const valueInt: number = parseInt(args[0]);
        // Check if Volume is a number and between 0 and 100
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
          return;
        }

        playerApi.setVolume(valueInt);
        ytmStore.dispatch({ type: "SET_VOLUME", payload: valueInt });

        break;
      }

      case "mute": {
        playerApi.mute();
        ytmStore.dispatch({ type: "SET_MUTED", payload: true });

        break;
      }

      case "unmute": {
        playerApi.unMute();
        ytmStore.dispatch({ type: "SET_MUTED", payload: false });

        break;
      }

      case "toggleMute": {
        const isMuted = playerApi.isMuted();
        if (isMuted) {
          playerApi.unMute();
          ytmStore.dispatch({ type: "SET_MUTED", payload: false });
        } else {
          playerApi.mute();
          ytmStore.dispatch({ type: "SET_MUTED", payload: true });
        }

        break;
      }

      case "repeatMode": {
        ytmStore.dispatch({ type: "SET_REPEAT", payload: args[0] });

        break;
      }

      case "cycleRepeatMode": {
        const currentRepeatMode = ytmStore.getState().queue.repeatMode;

        if (currentRepeatMode === "NONE") {
          ytmStore.dispatch({ type: "SET_REPEAT", payload: "ALL" });
        }

        if (currentRepeatMode === "ALL") {
          ytmStore.dispatch({ type: "SET_REPEAT", payload: "ONE" });
        }

        if (currentRepeatMode === "ONE") {
          ytmStore.dispatch({ type: "SET_REPEAT", payload: "NONE" });
        }

        break;
      }

      case "seekTo": {
        playerApi.seekTo(args[0]);

        break;
      }

      case "shuffle": {
        ytmhook.ytmPlayerController.queue.shuffle();

        break;
      }

      case "playQueueIndex": {
        let index = args[0];

        const state = ytmStore.getState();
        const queue = state.queue;

        const maxQueueIndex = state.queue.items.length - 1;
        //const maxAutoMixQueueIndex = Math.max(state.queue.automixItems.length - 1, 0);

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

        break;
      }

      case "navigate": {
        const endpoint = args[0];
        document.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: {
              endpoint
            }
          })
        );

        break;
      }

      case "queueAdd": {
        const videoId = args[0].videoId;
        const playlistId = args[0].playlistId;
        const index = args[0].index;

        const ytmusicAppElement = document.querySelector("ytmusic-app");
        const returnValue = [];
        const serviceRequestEvent = {
          bubbles: true,
          cancelable: false,
          composed: true,
          detail: {
            actionName: "yt-service-request",
            args: [
              ytmusicAppElement,
              {
                queueAddEndpoint: {
                  queueTarget: {
                    videoId: videoId,
                    playlistId: playlistId
                  }
                }
              }
            ],
            optionalAction: false,
            returnValue
          }
        };
        ytmusicAppElement.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
        returnValue[0].ajaxPromise.then(
          response => {
            const items = response.data.queueDatas.map(data => data.content);
            ytmStore.dispatch({
              type: "ADD_ITEMS",
              payload: {
                nextQueueItemId: ytmStore.getState().queue.nextQueueItemId,
                index,
                items,
                shuffleEnabled: ytmStore.getState().queue.shuffleEnabled,
                shouldAssignIds: true
              }
            });
          },
          () => {}
        );

        break;
      }

      case "queueRemove": {
        const index: number = parseInt(args[0]);

        ytmStore.dispatch({
          type: "REMOVE_ITEM",
          payload: index
        });
        break;
      }

      case "queueMove": {
        const fromIndex: number = parseInt(args[0].fromIndex);
        const toIndex: number = parseInt(args[0].toIndex);

        ytmStore.dispatch({
          type: "MOVE_ITEM",
          payload: {
            fromIndex,
            toIndex
          }
        });
        break;
      }
    }
  });

  remoteApi.handleMessage("getPlaylists", () => {
    const playerApi = ytmhook.ytmPlayerController.playerApi;

    return new Promise((resolve, reject) => {
      const ytmusicAppElement = document.querySelector("ytmusic-app");
      const returnValue = [];
      const serviceRequestEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            ytmusicAppElement,
            {
              addToPlaylistEndpoint: {
                videoId: playerApi.getPlayerResponse().videoDetails.videoId
              }
            }
          ],
          optionalAction: false,
          returnValue
        }
      };
      ytmusicAppElement.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
      returnValue[0].ajaxPromise.then(
        response => {
          try {
            const rawPlaylists = response.data.contents[0].addToPlaylistRenderer.playlists;
            const playlists = [];
            if (rawPlaylists) {
              for (const rawPlaylist of rawPlaylists) {
                const playlist = rawPlaylist.playlistAddToOptionRenderer;
                playlists.push({
                  id: playlist.playlistId,
                  title: getYTMTextRun(playlist.title.runs)
                });
              }
            }
            resolve([playlists]);
          } catch (err) {
            console.log("[ytmd-err(getPlaylists)]", err);
            resolve([[]]);
          }
        },
        () => {
          reject();
        }
      );
    });
  });
}
