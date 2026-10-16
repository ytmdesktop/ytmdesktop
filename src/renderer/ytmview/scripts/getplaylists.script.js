(function () {
  const player = document.querySelector("ytmusic-app-layout>ytmusic-player-bar") ?? document.querySelector("ytmusic-player");
  if (!player) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    var returnValue = [];
    var serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          player,
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
    player.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    const request = returnValue[0]?.ajaxPromise;
    if (!request || typeof request.then !== "function") {
      resolve([]);
      return;
    }
    request.then(
      response => {
        resolve(response.data.contents[0].addToPlaylistRenderer.playlists);
      },
      () => {
        reject();
      }
    );
  });
});
