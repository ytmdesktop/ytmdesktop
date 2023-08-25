{
  document.querySelector("ytmusic-player-bar").playerApi_.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  document.querySelector("ytmusic-player-bar").playerApi_.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  document.querySelector("ytmusic-player-bar").playerApi_.addEventListener("onVideoDataChange", event => {
    if (event.type === "dataloaded" && event.playertype === 1) {
      window.ytmd.sendVideoData(
        document.querySelector("ytmusic-player-bar").playerApi_.getPlayerResponse().videoDetails,
        document.querySelector("ytmusic-player-bar").playerApi_.getPlaylistId()
      );
    }
  });
  document.querySelector("ytmusic-player-bar").playerApi_.addEventListener("onAdStart", () => {
    window.ytmd.sendAdState(true);
  });
  document.querySelector("ytmusic-player-bar").playerApi_.addEventListener("onAdEnd", () => {
    window.ytmd.sendAdState(false);
  });
  document.querySelector("ytmusic-player-bar").store.subscribe(() => {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    let state = document.querySelector("ytmusic-player-bar").store.getState();
    window.ytmd.sendStoreUpdate(state.queue);
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
}
