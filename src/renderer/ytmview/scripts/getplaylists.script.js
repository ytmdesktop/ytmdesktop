(function() {
  return new Promise((resolve, reject) => {
    var returnValue = [];
    var serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          window.__YTMD_HOOK__.ytmPlayerBar.playerBars[0],
          {
            addToPlaylistEndpoint: {
              videoId: window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse().videoDetails.videoId
            }
          }
        ],
        optionalAction: false,
        returnValue
      }
    };
    window.__YTMD_HOOK__.ytmPlayerBar.playerBars[0].dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    returnValue[0].ajaxPromise.then(
      response => {
        resolve(response.data.contents[0].addToPlaylistRenderer.playlists);
      },
      () => {
        reject();
      }
    );
  });
})
