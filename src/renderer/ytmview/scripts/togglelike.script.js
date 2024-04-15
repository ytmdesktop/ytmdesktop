(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  const videoId = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlayerResponse().videoDetails.videoId;
  const likeButtonData = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").querySelector("ytmusic-like-button-renderer").data;
  
  let likeServiceEndpoint = null;
  let indifferentServiceEndpoint = null;

  for (const endpoint of likeButtonData.serviceEndpoints) {
    if (endpoint.likeEndpoint.status === "LIKE") {
      likeServiceEndpoint = endpoint;
    } else if (endpoint.likeEndpoint.status === "INDIFFERENT") {
      indifferentServiceEndpoint = endpoint;
    }
  }

  let serviceEvent = null;

  const defaultLikeStatus = likeButtonData.likeStatus;
  const state = ytmStore.getState();
  const storeLikeStatus = state.likeStatus.videos[videoId];

  const likeStatus = storeLikeStatus ? state.likeStatus.videos[videoId] : defaultLikeStatus;

  if (likeStatus === "LIKE") {
    serviceEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          document.querySelector("ytmusic-like-button-renderer"),
          indifferentServiceEndpoint
        ],
        optionalAction: false,
        returnValue: []
      }
    };
  } else if (likeStatus === "DISLIKE" || likeStatus === "INDIFFERENT") {
    serviceEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          document.querySelector("ytmusic-like-button-renderer"),
          likeServiceEndpoint
        ],
        optionalAction: false,
        returnValue: []
      }
    };
  }

  if (serviceEvent) document.querySelector("ytmusic-like-button-renderer").dispatchEvent(new CustomEvent("yt-action", serviceEvent));
})
