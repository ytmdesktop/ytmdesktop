(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  const videoId = window.__YTMD_HOOK__.ytmPlayerBar?.playerApi?.getPlayerResponse()?.videoDetails?.videoId;
  const likeButtonRenderer = document.querySelector("ytmusic-like-button-renderer");
  if (!likeButtonRenderer) return;

  const likeButtonData = likeButtonRenderer.data;
  if (likeButtonData && Array.isArray(likeButtonData.serviceEndpoints) && likeButtonData.serviceEndpoints.length > 0) {
    let dislikeServiceEndpoint = null;
    let indifferentServiceEndpoint = null;

    for (const endpoint of likeButtonData.serviceEndpoints) {
      if (endpoint?.likeEndpoint?.status === "DISLIKE") {
        dislikeServiceEndpoint = endpoint;
      } else if (endpoint?.likeEndpoint?.status === "INDIFFERENT") {
        indifferentServiceEndpoint = endpoint;
      }
    }

    const defaultLikeStatus = (
      likeButtonRenderer.getAttribute?.("like-status") ||
      likeButtonRenderer.likeStatus ||
      likeButtonData.likeStatus ||
      "INDIFFERENT"
    );
    const state = ytmStore.getState();
    const storeLikeStatus = videoId ? state.likeStatus?.videos?.[videoId] : null;
    const likeStatus = storeLikeStatus || defaultLikeStatus;

    let serviceEvent = null;
    if (likeStatus === "DISLIKE" && indifferentServiceEndpoint) {
      serviceEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            likeButtonRenderer,
            indifferentServiceEndpoint
          ],
          optionalAction: false,
          returnValue: []
        }
      };
    } else if ((likeStatus === "LIKE" || likeStatus === "INDIFFERENT") && dislikeServiceEndpoint) {
      serviceEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            likeButtonRenderer,
            dislikeServiceEndpoint
          ],
          optionalAction: false,
          returnValue: []
        }
      };
    }

    if (serviceEvent) {
      likeButtonRenderer.dispatchEvent(new CustomEvent("yt-action", serviceEvent));
      return;
    }
  }

  // Fallback for modern layout / new Miniplayer: click the dislike button element directly
  const dislikeBtn = (
    likeButtonRenderer.querySelector("#dislike-button button, [aria-label*='Dislike' i] button, button[aria-label*='Dislike' i]") ||
    likeButtonRenderer.querySelector("#dislike-button, [aria-label*='Dislike' i]") ||
    likeButtonRenderer.querySelector("tp-yt-paper-icon-button.dislike, yt-icon-button.dislike")
  );
  if (dislikeBtn && typeof dislikeBtn.click === "function") {
    dislikeBtn.click();
  }
})
