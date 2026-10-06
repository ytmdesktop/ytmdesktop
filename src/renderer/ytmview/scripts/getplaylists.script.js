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
              videoId:
                (function() {
                  // Prefer the currently loaded video; fall back to the last
                  // known video id injected by the preload script so the
                  // playlists list also works when nothing is playing.
                  try {
                    var playerResponse = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getPlayerResponse();
                    if (playerResponse && playerResponse.videoDetails && playerResponse.videoDetails.videoId) {
                      return playerResponse.videoDetails.videoId;
                    }
                  } catch (e) {}
                  return window.__YTMD_PLAYLISTS_FALLBACK_VIDEO_ID__;
                })()
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
