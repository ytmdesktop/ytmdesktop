(function() {
  return new Promise((resolve, reject) => {
    var targetElement = (
      document.querySelector("ytmusic-app-layout>ytmusic-player-bar") ||
      document.querySelector("ytmusic-player-controls") ||
      document.querySelector("ytmusic-app") ||
      document.body
    );
    var returnValue = [];
    var serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          targetElement,
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
    if (targetElement) {
      targetElement.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    }
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
