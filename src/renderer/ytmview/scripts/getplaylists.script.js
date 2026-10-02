(function() {
  return new Promise((resolve, reject) => {
    var targetElement = document.querySelector("ytmusic-player-bar, ytmusic-player-controls, ytmusic-app") || document.body;
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
              videoId: window.__YTMD_HOOK__?.ytmPlayerBar?.playerApi?.getPlayerResponse()?.videoDetails?.videoId
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
    if (returnValue[0] && returnValue[0].ajaxPromise) {
      returnValue[0].ajaxPromise.then(
        response => {
          if (response?.data?.contents?.[0]?.addToPlaylistRenderer?.playlists) {
            resolve(response.data.contents[0].addToPlaylistRenderer.playlists);
          } else {
            resolve([]);
          }
        },
        () => {
          reject();
        }
      );
    } else {
      resolve([]);
    }
  });
})
