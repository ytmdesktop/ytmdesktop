(function() {
  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    let state = document.querySelector("ytmusic-player-bar").store.getState();

    let album = null;
    let thumbnails = null;
    if (state.playerPage.playerOverlay) {
      album = {
        id: null,
        text: state.playerPage.playerOverlay.playerOverlayRenderer.browserMediaSession.browserMediaSessionRenderer.album
      }
      const currentMenu = document.querySelector("ytmusic-player-bar").getMenuRenderer();
      if (currentMenu) {
        for (let i = 0; i < currentMenu.items.length; i++) {
          const item = currentMenu.items[i];
          if (item.menuNavigationItemRenderer) {
            if (item.menuNavigationItemRenderer.icon.iconType === "ALBUM") {
              album.id = item.menuNavigationItemRenderer.navigationEndpoint.browseEndpoint.browseId;
            }
          }
        }
      }

      if (state.playerPage.playerOverlay.playerOverlayRenderer.browserMediaSession.browserMediaSessionRenderer.thumbnailDetails) {
        thumbnails = state.playerPage.playerOverlay.playerOverlayRenderer.browserMediaSession.browserMediaSessionRenderer.thumbnailDetails.thumbnails
      }
    }

    const videoId = document.querySelector("ytmusic-player-bar").playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const likeButtonData = document.querySelector("ytmusic-player-bar").querySelector("ytmusic-like-button-renderer").data;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];
    
    const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    window.ytmd.sendStoreUpdate(state.queue, thumbnails, album, likeStatus, volume, muted, adPlaying);
  }

  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  document.querySelector("ytmusic-player-bar").playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      window.ytmd.sendVideoData(
        document.querySelector("ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails,
        document.querySelector("ytmusic-player-bar").playerApi.getPlaylistId()
      );
      // This event will reset the video details object in YTMD so we send a store update to ensure a race condition between the store dispatch events and this event aren't occurring
      sendStoreState();
    }
  });
  document.querySelector("ytmusic-player-bar").store.subscribe(() => {
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
