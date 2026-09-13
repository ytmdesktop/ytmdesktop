import polymerhook from "./polymerhook";
import protectedapimanager from "./protectedapimanager";

export default function init() {
  const playerStateApi = protectedapimanager.createOrGetAPI("PlayerState");
  const ytmStore = polymerhook.ytmStore;
  const playerApi = polymerhook.ytmPlayerBar.playerApi;

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();

    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const likeButtonData = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").querySelector("ytmusic-like-button-renderer").data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];

    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    playerStateApi.postMessage("updateFromStore", state.queue, likeStatus, volume, muted, adPlaying);
  }

  function sendVideoData() {
    const videoDetails = playerApi.getPlayerResponse().videoDetails;
    const playlistId = playerApi.getPlaylistId();
    let album = null;
    let hasFullMetadata = false;

    // If playing from online sources this usually is filled out with the first dataupdated which is followed after dataloaded. While offline this is always filled
    const currentItem = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").currentItem;
    if (currentItem !== null && currentItem !== undefined) {
      hasFullMetadata = true;

      // Fill out video details with better information
      videoDetails.title = currentItem.title.runs.map(v => v.text).join(""); // Can contain featuring text which isn't in player response
      videoDetails.thumbnail = currentItem.thumbnail; // Can contain more thumbnails than player response

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

    const state = ytmStore.getState();
    const likeButtonData = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").querySelector("ytmusic-like-button-renderer").data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
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

  playerApi.addEventListener("onVideoProgress", progress => {
    playerStateApi.postMessage("updateVideoProgress", progress);
  });
  playerApi.addEventListener("onStateChange", state => {
    playerStateApi.postMessage("updateVideoState", state);
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      sendVideoData();
    }
  });
  ytmStore.subscribe(() => {
    sendStoreState();
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
  const playerApi = polymerhook.ytmPlayerBar.playerApi;

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
