(function() {
  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const playerApi = window.__YTMD_HOOK__.ytmPlayerBar.playerApi;
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  function queryDeep(root, selector) {
    if (!root) return null;
    if (root.querySelector) {
      const match = root.querySelector(selector);
      if (match) return match;
    }
    const children = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const child of children) {
      if (child.shadowRoot) {
        const match = queryDeep(child.shadowRoot, selector);
        if (match) return match;
      }
    }
    return root.shadowRoot ? queryDeep(root.shadowRoot, selector) : null;
  }

  function normalizeLikeStatus(value) {
    if (typeof value === "string") {
      const status = value.toUpperCase();
      if (status === "LIKE" || status === "DISLIKE" || status === "INDIFFERENT") return status;
      return null;
    }
    if (value && typeof value === "object") {
      return normalizeLikeStatus(value.likeStatus || value.status || value.state);
    }
    return null;
  }

  function likeStatusFromRenderer(renderer) {
    if (!renderer) return null;
    const fromData = normalizeLikeStatus(renderer.data?.likeStatus) || normalizeLikeStatus(renderer.likeStatus);
    if (fromData) return fromData;

    const buttons = [];
    const collect = root => {
      if (!root?.querySelectorAll) return;
      buttons.push(...root.querySelectorAll("[aria-label], [aria-pressed]"));
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) collect(child.shadowRoot);
      }
    };
    collect(renderer);
    if (renderer.shadowRoot) collect(renderer.shadowRoot);

    for (const button of buttons) {
      if (button.getAttribute("aria-pressed") !== "true") continue;
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("dislike")) return "DISLIKE";
      if (label.includes("like")) return "LIKE";
    }
    return null;
  }

  function getLikeStatus(videoId) {
    const renderer = queryDeep(playerBar, "ytmusic-like-button-renderer") || queryDeep(document, "ytmusic-like-button-renderer");
    const state = ytmStore.getState();
    return (
      likeStatusFromRenderer(renderer) ||
      normalizeLikeStatus(state.likeStatus?.videos?.[videoId]) ||
      normalizeLikeStatus(playerBar.likeStatus) ||
      "UNKNOWN"
    );
  }

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();
    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    window.ytmd.sendStoreUpdate(state.queue, getLikeStatus(videoId), state.player.volume, state.player.muted, state.player.adPlaying);
  }

  function sendVideoData() {
    let videoDetails = playerApi.getPlayerResponse()?.videoDetails;
    if (!videoDetails) return;

    const playlistId = playerApi.getPlaylistId();
    let album = null;
    let hasFullMetadata = false;
    const currentItem = playerBar.currentItem;
    if (currentItem) {
      hasFullMetadata = true;
      videoDetails.title = currentItem.title?.runs?.map(v => v.text).join("") ?? videoDetails.title;
      videoDetails.thumbnail = currentItem.thumbnail ?? videoDetails.thumbnail;

      for (const item of currentItem.longBylineText?.runs ?? []) {
        const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
        if (browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
          album = {
            id: browseEndpoint.browseId,
            text: item.text
          };
        }
      }
    }

    window.ytmd.sendVideoData(videoDetails, playlistId, album, getLikeStatus(videoDetails.videoId), hasFullMetadata);
  }

  function sendCurrentPlayerState() {
    window.ytmd.sendVideoProgress(playerApi.getCurrentTime?.() ?? 0);
    window.ytmd.sendVideoState(playerApi.getPlayerState?.() ?? -1);
    sendVideoData();
    sendStoreState();
  }

  playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) sendVideoData();
  });
  ytmStore.subscribe(() => {
    sendStoreState();
  });
  sendCurrentPlayerState();

  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        const title = e.detail.args[2].create_playlist_title;
        const returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then(response => {
          window.ytmd.sendCreatePlaylistObservation({
            title,
            id: response.data.playlistId
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      window.ytmd.sendDeletePlaylistObservation(e.detail.args[0].handlePlaylistDeletionCommand.playlistId);
    }
  });
})
