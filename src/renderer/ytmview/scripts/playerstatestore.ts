import ytmhook from "./ytmhook";
import protectedapimanager from "./protectedapimanager";

function getLikeStatus() {
  try {
    const ytmStore = ytmhook.ytmStateStore.store;
    const state = ytmStore.getState();

    let status = "INDIFFERENT";
    if (state.playerPage.playerOverlay.playerOverlayRenderer.actions) {
      status = state.playerPage.playerOverlay.playerOverlayRenderer.actions[0].likeButtonRenderer.likeStatus;
    } else if (state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar) {
      // New player bar
      const actionBar = state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar;
      const viewModel = actionBar.videoActionBarViewModel.buttons[0].buttonViewModel.segmentedLikeDislikeButtonViewModel;
      status = viewModel.likeButtonViewModel.likeButtonViewModel.likeStatusEntity.likeStatus;
    }
    return status;
  } catch (err) {
    console.log("[ytmd-err(getLikeStatus)]", err);
    return null;
  }
}

export default function init() {
  const playerStateApi = protectedapimanager.createOrGetAPI("PlayerState");
  const ytmStore = ytmhook.ytmStateStore.store;
  //const playerBar = ytmhook.ytmPlayerController;
  const playerApi = ytmhook.ytmPlayerController.playerApi;

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();

    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const defaultLikeStatus = getLikeStatus() ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];

    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    playerStateApi.postMessage("updateFromStore", state.queue, likeStatus, volume, muted, adPlaying);
  }

  function sendVideoData() {
    const state = ytmStore.getState();
    const videoDetails = playerApi.getPlayerResponse().videoDetails;
    const playlistId = playerApi.getPlaylistId();
    let album = null;
    let hasFullMetadata = false;

    const selectedItemIndex = state.queue.items.findIndex(item => {
      return item.playlistPanelVideoRenderer?.selected ?? item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer.selected;
    });
    let currentItem = state.queue.items[selectedItemIndex];
    currentItem = currentItem?.playlistPanelVideoRenderer ?? currentItem?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (currentItem !== null && currentItem !== undefined) {
      hasFullMetadata = true;

      // Fill out video details with better information
      videoDetails.title = currentItem.title.runs.map(v => v.text).join(""); // Can contain featuring text which isn't in player response
      videoDetails.thumbnail = currentItem.thumbnail; // Can contain more thumbnails than player response

      // Maybe obtain the album information from a text run
      for (let i = 0; i < currentItem.longBylineText.runs.length; i++) {
        const item = currentItem.longBylineText.runs[i];
        if (item.navigationEndpoint) {
          if (
            item.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType === "MUSIC_PAGE_TYPE_ALBUM"
          ) {
            album = {
              id: item.navigationEndpoint.browseEndpoint.browseId,
              text: item.text
            };
          }
        }
      }
    }

    const defaultLikeStatus = getLikeStatus() ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoDetails.videoId];

    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoDetails.videoId] : defaultLikeStatus;

    playerStateApi.postMessage("updateVideoDetails", videoDetails, playlistId, album, likeStatus, hasFullMetadata);
  }

  function hydrateApplicationState() {
    sendStoreState();

    const progressState = playerApi.getProgressState();
    playerStateApi.postMessage("updateVideoProgress", progressState.current);

    const videoState = playerApi.getPlayerState();
    playerStateApi.postMessage("updateVideoState", videoState);

    sendVideoData();
  }

  // It is mandatory that try catch be used within these so that we handle errors for YTMD and not throw them back to YTM
  playerApi.addEventListener("onVideoProgress", progress => {
    try {
      playerStateApi.postMessage("updateVideoProgress", progress);
    } catch (err) {
      console.error("[ytmd-err(playerApi.onVideoProgress)]", err);
    }
  });
  playerApi.addEventListener("onStateChange", state => {
    try {
      playerStateApi.postMessage("updateVideoState", state);
    } catch (err) {
      console.log("[ytmd-err(playerApi.onStateChange)]", err);
    }
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    try {
      if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
        sendVideoData();
      }
    } catch (err) {
      console.log("[ytmd-err(playerApi.onVideoDataChange)]", err);
    }
  });
  ytmStore.subscribe(() => {
    try {
      sendStoreState();
    } catch (err) {
      console.log("[ytmd-err(stateStore.subscribe)]", err);
    }
  });
  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        const title = e.detail.args[2].create_playlist_title;
        const returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then(response => {
          const id = response.data.playlistId;

          playerStateApi.postMessage("playlistCreated", {
            title,
            id
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      const playlistId = e.detail.args[0].handlePlaylistDeletionCommand.playlistId;
      playerStateApi.postMessage("playlistDeleted", playlistId);
    }
  });

  try {
    hydrateApplicationState();
  } catch {
    /* empty */
  }
}

export async function waitForYTMPlayerApiReady() {
  const playerApi = ytmhook.ytmPlayerController.playerApi;

  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const playerApiReady: boolean = playerApi.isReady();

      if (playerApiReady) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}
