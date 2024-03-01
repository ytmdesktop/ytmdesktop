(function() {
  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    let state = document.querySelector("ytmusic-popup-container").store.getState();

    const videoId = document.querySelector("ytmusic-player-bar").playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const likeButtonData = document.querySelector("ytmusic-player-bar").querySelector("ytmusic-like-button-renderer").data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];
    
    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    window.ytmd.sendStoreUpdate(state.queue, likeStatus, volume, muted, adPlaying);
  }

  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      let videoDetails = document.querySelector("ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails;
      let playlistId = document.querySelector("ytmusic-player-bar").playerApi.getPlaylistId();
      let album = null;

      let currentItem = document.querySelector("ytmusic-player-bar").currentItem;
      if (currentItem !== null && currentItem !== undefined) {
        if (videoDetails.musicVideoType === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") {
          // Thumbnails are not provided on the video details for a podcast
          videoDetails.thumbnail = document.querySelector("ytmusic-player-bar").currentItem.thumbnail;
        }

        for (let i = 0; i < currentItem.longBylineText.runs.length; i++) {
          const item = currentItem.longBylineText.runs[i];
          if (item.navigationEndpoint) {
            if (item.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
              album = {
                id: item.navigationEndpoint.browseEndpoint.browseId,
                text: item.text
              }
            }
          }
        }
      }

      window.ytmd.sendVideoData(videoDetails, playlistId, album);
    }
  });
  document.querySelector("ytmusic-popup-container").store.subscribe(() => {
    sendStoreState();
  });
  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        let title = e.detail.args[2].create_playlist_title;
        let returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then(response => {
          let id = response.data.playlistId;
          window.ytmd.sendCreatePlaylistObservation({
            title,
            id
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      let playlistId = e.detail.args[0].handlePlaylistDeletionCommand.playlistId;
      window.ytmd.sendDeletePlaylistObservation(playlistId);
    }
  });
})
