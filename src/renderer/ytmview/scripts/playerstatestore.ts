import ytmhook from "./ytmhook";
import protectedapimanager from "./protectedapimanager";

function getLikeStatus() {
  try {
    const ytmStore = ytmhook.ytmStateStore.store;
    const state = ytmStore.getState();

    let status = "INDIFFERENT";
    if (state.playerPage && state.playerPage.playerOverlay && state.playerPage.playerOverlay.playerOverlayRenderer) {
      if (state.playerPage.playerOverlay.playerOverlayRenderer.actions) {
        status = state.playerPage.playerOverlay.playerOverlayRenderer.actions[0].likeButtonRenderer.likeStatus;
      } else if (state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar) {
        // New player bar
        const actionBar = state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar;
        const viewModel = actionBar.videoActionBarViewModel.buttons[0].buttonViewModel.segmentedLikeDislikeButtonViewModel;
        status = viewModel.likeButtonViewModel.likeButtonViewModel.likeStatusEntity.likeStatus;
      }
    }
    return status;
  } catch (err) {
    console.error("[ytmd-err(getLikeStatus)]", err);
    return null;
  }
}

async function remapThumbnailsToDataUrl(thumbnails: any[]) {
  for (const thumbnail of thumbnails) {
    if (thumbnail.url) {
      try {
        const response = await fetch(thumbnail.url, {
          credentials: "omit",
          referrerPolicy: "no-referrer"
        });
        if (response.ok) {
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          thumbnail.url = dataUrl;
        }
      } catch(err) {
        console.error("[ytmd-err(sendVideoData)] Could not update thumbnail url to data url", err);
      }
    }
  }
}

export default function init() {
  const playerStateApi = protectedapimanager.createOrGetAPI("PlayerState");
  const ytmStore = ytmhook.ytmStateStore.store;
  //const playerBar = ytmhook.ytmPlayerController;
  const playerApi = ytmhook.ytmPlayerController.playerApi;

  async function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();

    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const defaultLikeStatus = getLikeStatus() ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];

    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;
    
    // This feature which can remap queue item thumbnails into data url is extremely intensive both memory and for companion api responses
    // 
    // We opt for a tradeoff below of just remapping the currently playing videos thumbnails to data url
    /*
    const queue = structuredClone(state.queue);
    // Check if offline then convert the thumbnail url by requesting it
    const networkStatusManager = window["yt"]?.networkStatusManager?.instance?.sharedNetworkStatusManager;
    if (networkStatusManager && !networkStatusManager.isNetworkAvailable()) {
      for (const item of queue.items) {
        let playlistPanelVideoRenderer;
        if (item.playlistPanelVideoRenderer) {
          playlistPanelVideoRenderer = item.playlistPanelVideoRenderer;
        } else if (item.playlistPanelVideoWrapperRenderer) {
          playlistPanelVideoRenderer = item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer
        }
        await remapThumbnailsToDataUrl(playlistPanelVideoRenderer.thumbnail?.thumbnails ?? []);
      }
    }
    */

    playerStateApi.postMessage("updateFromStore", state.queue, likeStatus, volume, muted, adPlaying);
  }

  async function sendVideoData() {
    const state = ytmStore.getState();
    const videoDetails = structuredClone(playerApi.getPlayerResponse().videoDetails);
    const playlistId = playerApi.getPlaylistId();
    let album: any | null = null;
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
      videoDetails.thumbnail = structuredClone(currentItem.thumbnail); // Can contain more thumbnails than player response

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

    // Check if offline then convert the thumbnail url to data url if possible
    //
    // This provides a quality of life where at least when something is currently playing and we're offline the media service
    // or anything that may present the currently playing media thumbnail has something tangible to work with
    const networkStatusManager = window["yt"]?.networkStatusManager?.instance?.sharedNetworkStatusManager;
    if (networkStatusManager && !networkStatusManager.isNetworkAvailable()) {
      await remapThumbnailsToDataUrl(videoDetails.thumbnail?.thumbnails ?? []);
    }

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
      console.error("[ytmd-err(playerApi.onStateChange)]", err);
    }
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    try {
      if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
        sendVideoData();
      }
    } catch (err) {
      console.error("[ytmd-err(playerApi.onVideoDataChange)]", err);
    }
  });
  ytmStore.subscribe(() => {
    try {
      sendStoreState();
    } catch (err) {
      console.error("[ytmd-err(stateStore.subscribe)]", err);
    }
  });
  window.addEventListener("yt-action", (e: any) => {
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
