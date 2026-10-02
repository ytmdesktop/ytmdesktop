(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;
  const playerApi = window.__YTMD_HOOK__.ytmPlayerBar.playerApi;

  function getLikeStatus(state, videoId) {
    if (videoId && state?.likeStatus?.videos?.[videoId]) {
      return state.likeStatus.videos[videoId];
    }
    const likeButtonRenderer = document.querySelector("ytmusic-like-button-renderer");
    return (
      likeButtonRenderer?.getAttribute?.("like-status") ||
      likeButtonRenderer?.likeStatus ||
      likeButtonRenderer?.data?.likeStatus ||
      "INDIFFERENT"
    );
  }

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    let state = ytmStore.getState();

    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const likeStatus = getLikeStatus(state, videoId);
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    window.ytmd.sendStoreUpdate(state.queue, likeStatus, volume, muted, adPlaying);
  }

  playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
      const playerResponse = playerApi.getPlayerResponse();
      if (!playerResponse?.videoDetails) return;

      let videoDetails = { ...playerResponse.videoDetails };
      let playlistId = playerApi.getPlaylistId();
      let album = null;
      let hasFullMetadata = false;
      let state = ytmStore.getState();

      // Check for rich metadata item matching the current video
      const playerBar = document.querySelector("ytmusic-player-bar, ytmusic-player-controls");
      let currentItem = playerBar?.currentItem;
      let currentItemVideoId = currentItem?.videoId || currentItem?.navigationEndpoint?.watchEndpoint?.videoId;

      // Discard currentItem if it belongs to a different video
      if (currentItem && currentItemVideoId && currentItemVideoId !== videoDetails.videoId) {
        currentItem = null;
      }

      // If not on playerBar or stale, search the Redux queue for the current video's renderer
      if (!currentItem && state?.queue) {
        const queueItems = [
          ...(state.queue.items || []),
          ...(state.queue.automixItems || [])
        ];
        for (const item of queueItems) {
          const renderer = (
            item?.playlistPanelVideoRenderer ||
            item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer
          );
          if (renderer) {
            const rVid = renderer.videoId || renderer.navigationEndpoint?.watchEndpoint?.videoId;
            if (rVid === videoDetails.videoId || (!rVid && renderer.selected)) {
              currentItem = renderer;
              break;
            }
          }
        }
      }

      if (currentItem) {
        const cVid = currentItem.videoId || currentItem.navigationEndpoint?.watchEndpoint?.videoId;
        if (!cVid || cVid === videoDetails.videoId) {
          hasFullMetadata = true;

          // Fill out video details with better information (e.g. featuring artists in title)
          if (Array.isArray(currentItem.title?.runs) && currentItem.title.runs.length > 0) {
            const richTitle = currentItem.title.runs.map(v => v.text).join("");
            if (richTitle) {
              videoDetails.title = richTitle;
            }
          }
          if (currentItem.thumbnail) {
            videoDetails.thumbnail = currentItem.thumbnail;
          }

          if (Array.isArray(currentItem.longBylineText?.runs)) {
            for (let i = 0; i < currentItem.longBylineText.runs.length; i++) {
              const item = currentItem.longBylineText.runs[i];
              if (item?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
                album = {
                  id: item.navigationEndpoint.browseEndpoint.browseId,
                  text: item.text
                };
              }
            }
          }
        }
      }

      const likeStatus = getLikeStatus(state, videoDetails?.videoId);

      window.ytmd.sendVideoData(videoDetails, playlistId, album, likeStatus, hasFullMetadata);
    }
  });
  ytmStore.subscribe(() => {
    sendStoreState();
  });
  window.addEventListener("yt-action", e => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        let title = e.detail.args[2].create_playlist_title;
        let returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then(response => {
          let id = response.data.playlistId;
          window.ytmd.sendCreatePlaylistObservation({
            title,
            id
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      let playlistId = e.detail.args[0].handlePlaylistDeletionCommand.playlistId;
      window.ytmd.sendDeletePlaylistObservation(playlistId);
    }
  });
})
