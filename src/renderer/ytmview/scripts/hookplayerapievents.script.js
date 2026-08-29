(function() {
  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const playerApi = window.__YTMD_HOOK__.ytmPlayerBar.playerApi;
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();
    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const likeButtonData = playerBar.querySelector("ytmusic-like-button-renderer")?.data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const likeStatus = state.likeStatus?.videos?.[videoId] ?? defaultLikeStatus;
    window.ytmd.sendStoreUpdate(state.queue, likeStatus, state.player.volume, state.player.muted, state.player.adPlaying);
  }

  function sendVideoData() {
    let videoDetails = playerApi.getPlayerResponse()?.videoDetails;
    if (!videoDetails) return;

    const playlistId = playerApi.getPlaylistId();
    let album = null;
    let hasFullMetadata = false;
    const currentItem = playerBar.currentItem;
    if (currentItem) {
      hasFullMetadata = true;
      videoDetails.title = currentItem.title?.runs?.map(v => v.text).join("") ?? videoDetails.title;
      videoDetails.thumbnail = currentItem.thumbnail ?? videoDetails.thumbnail;

      for (const item of currentItem.longBylineText?.runs ?? []) {
        const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
        if (browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
          album = {
            id: browseEndpoint.browseId,
            text: item.text
          };
        }
      }
    }

    const state = ytmStore.getState();
    const likeButtonData = playerBar.querySelector("ytmusic-like-button-renderer")?.data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const likeStatus = state.likeStatus?.videos?.[videoDetails.videoId] ?? defaultLikeStatus;
    window.ytmd.sendVideoData(videoDetails, playlistId, album, likeStatus, hasFullMetadata);
  }

  function sendCurrentPlayerState() {
    window.ytmd.sendVideoProgress(playerApi.getCurrentTime?.() ?? 0);
    window.ytmd.sendVideoState(playerApi.getPlayerState?.() ?? -1);
    sendVideoData();
    sendStoreState();
  }

  playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) sendVideoData();
  });
  ytmStore.subscribe(() => {
    sendStoreState();
  });
  sendCurrentPlayerState();

  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        const title = e.detail.args[2].create_playlist_title;
        const returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then(response => {
          window.ytmd.sendCreatePlaylistObservation({
            title,
            id: response.data.playlistId
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      window.ytmd.sendDeletePlaylistObservation(e.detail.args[0].handlePlaylistDeletionCommand.playlistId);
    }
  });
})
