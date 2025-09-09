/* eslint-disable @typescript-eslint/no-unused-expressions */
(function (videoId, playlistId, index) {
  return new Promise((resolve, reject) => {
    var returnValue = [];
    var serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          document.querySelector("ytmusic-app-layout>ytmusic-player-bar"),
          {
            queueAddEndpoint: {
              queueTarget: {
                videoId: videoId,
                playlistId: playlistId
              }
            }
          }
        ],
        optionalAction: false,
        returnValue
      }
    };
    document.querySelector("ytmusic-app-layout>ytmusic-player-bar").dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    returnValue[0].ajaxPromise.then(
      response => {
        let items = response.data.queueDatas.map(data => data.content);
        window.__YTMD_HOOK__.ytmStore.dispatch({
          type: "ADD_ITEMS",
          payload: {
            nextQueueItemId: window.__YTMD_HOOK__.ytmStore.getState().queue.nextQueueItemId,
            index,
            items,
            shuffleEnabled: window.__YTMD_HOOK__.ytmStore.getState().queue.shuffleEnabled,
            shouldAssignIds: true
          }
        });
        resolve();
      },
      () => {
        reject();
      }
    );
  });
})
