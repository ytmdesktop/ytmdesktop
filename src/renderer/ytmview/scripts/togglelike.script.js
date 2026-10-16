(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  const videoId = window.__YTMD_HOOK__.ytmPlayerBar?.playerApi?.getPlayerResponse()?.videoDetails?.videoId;
  const likeButtonRenderer = document.querySelector("ytmusic-like-button-renderer");
  if (!likeButtonRenderer) return;

  const likeButtonData = likeButtonRenderer.data;
  if (likeButtonData && Array.isArray(likeButtonData.serviceEndpoints) && likeButtonData.serviceEndpoints.length > 0) {
    let likeServiceEndpoint = null;
    let indifferentServiceEndpoint = null;

    for (const endpoint of likeButtonData.serviceEndpoints) {
      if (endpoint?.likeEndpoint?.status === "LIKE") {
        likeServiceEndpoint = endpoint;
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
    if (likeStatus === "LIKE" && indifferentServiceEndpoint) {
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
    } else if ((likeStatus === "DISLIKE" || likeStatus === "INDIFFERENT") && likeServiceEndpoint) {
      serviceEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            likeButtonRenderer,
            likeServiceEndpoint
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

  // Fallback for modern layout / new Miniplayer: click the like button element directly
  const likeBtn = (
    likeButtonRenderer.querySelector("#like-button button, [aria-label*='Like' i] button, button[aria-label*='Like' i]") ||
    likeButtonRenderer.querySelector("#like-button, [aria-label*='Like' i]") ||
    likeButtonRenderer.querySelector("tp-yt-paper-icon-button.like, yt-icon-button.like")
  );
  if (likeBtn && typeof likeBtn.click === "function") {
    likeBtn.click();
  }
})
