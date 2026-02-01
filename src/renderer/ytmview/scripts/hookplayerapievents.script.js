(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  function sendStoreState() {
    // Only send the minimal required state data; sensitive data is excluded
    let state = ytmStore.getState();

    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (!playerBar || !playerBar.playerApi) return;

    const playerResponse = playerBar.playerApi.getPlayerResponse?.();
    const videoId = playerResponse?.videoDetails?.videoId;
    const likeButtonRenderer = playerBar.querySelector("ytmusic-like-button-renderer");
    const likeButtonData = likeButtonRenderer ? likeButtonRenderer.data : undefined;
    const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus?.videos?.[videoId];

    const likeStatus = storeLikeStatus ? storeLikeStatus : defaultLikeStatus;
    const volume = state.player?.volume;
    const adPlaying = state.player?.adPlaying;
    const muted = state.player?.muted;

    window.ytmd.sendStoreUpdate(state.queue, likeStatus, volume, muted, adPlaying);
  }

  // Create a throttled version of sendVideoProgress
  let lastProgressTime = 0;
  let progressThrottleTimeout = null;
  let lastProgress = null;
  
  function throttledSendVideoProgress(progress) {
    const now = Date.now();
    lastProgress = progress;

    // If we haven't sent progress in 250ms, send it immediately
    if (now - lastProgressTime > 250) {
      window.ytmd.sendVideoProgress(progress);
      lastProgressTime = now;
      lastProgress = null;

      // Clear any pending timeout
      if (progressThrottleTimeout) {
        clearTimeout(progressThrottleTimeout);
        progressThrottleTimeout = null;
      }
    }
    // Otherwise, schedule an update if we don't have one already
    else if (!progressThrottleTimeout) {
      progressThrottleTimeout = setTimeout(() => {
        if (lastProgress !== null) {
          window.ytmd.sendVideoProgress(lastProgress);
          lastProgressTime = Date.now();
          lastProgress = null;
        }
        progressThrottleTimeout = null;
      }, Math.max(0, 250 - (now - lastProgressTime)));
    }
  }

  function tryAddPlayerEvents(playerBar) {
    if (!playerBar || !playerBar.playerApi) return;

    playerBar.playerApi.addEventListener("onVideoProgress", progress => {
      throttledSendVideoProgress(progress);
    });

    playerBar.playerApi.addEventListener("onStateChange", state => {
      window.ytmd.sendVideoState(state);
    });

    playerBar.playerApi.addEventListener("onVideoDataChange", event => {
      if (event.playertype === 1 && (event.type === "dataloaded" || event.type === "dataupdated")) {
        const playerResponse = playerBar.playerApi.getPlayerResponse?.();
        if (!playerResponse || !playerResponse.videoDetails) return;

        let videoDetails = playerResponse.videoDetails;
        let playlistId = playerBar.playerApi.getPlaylistId?.();
        let album = null;
        let hasFullMetadata = false;

        // If playing from online sources this usually is filled out with the first dataupdated; for offline, always filled
        let currentItem = playerBar.currentItem;
        if (currentItem !== null && currentItem !== undefined) {
          hasFullMetadata = true;

          // Fill out video details with better information
          const rawTitle =
            Array.isArray(currentItem.title?.runs)
              ? currentItem.title.runs.map(v => v.text).join("")
              : "";

          // Fix character encoding issues in title
          videoDetails.title = rawTitle
            .replace(/ΓÇó/g, '•')
            .replace(/├ÿ/g, 'Ø')
            .replace(/ΓÇÖ/g, '–')
            .replace(/ΓÇÜ/g, '—')
            .replace(/ΓÇô/g, '"')
            .replace(/ΓÇ£/g, '"')
            .replace(/ΓÇ¥/g, "'");
            videoDetails.thumbnail = currentItem.thumbnail; // Can contain more thumbnails than player response

          // Extract artist and album information from longBylineText
          let artistName = "";
          if (Array.isArray(currentItem.longBylineText?.runs)) {
            for (let i = 0; i < currentItem.longBylineText.runs.length; i++) {
              const item = currentItem.longBylineText.runs[i];
              if (item.navigationEndpoint) {
                const pageType = item.navigationEndpoint.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
                if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
                  album = {
                    id: item.navigationEndpoint.browseEndpoint.browseId,
                    text: item.text
                  };
                } else if (pageType === "MUSIC_PAGE_TYPE_ARTIST" && !artistName) {
                  // This is the artist name (first artist link we encounter)
                  artistName = item.text;
                }
              }
            }
          }
          
          // Update the author field with the extracted artist information
          if (artistName) {
            videoDetails.author = artistName
              .replace(/ΓÇó/g, '•')
              .replace(/├ÿ/g, 'Ø')
              .replace(/ΓÇÖ/g, '–')
              .replace(/ΓÇÜ/g, '—')
              .replace(/ΓÇô/g, '"')
              .replace(/ΓÇ£/g, '"')
              .replace(/ΓÇ¥/g, "'")
              .replace(/ΓÇ¥/g, "'");
          }
        }

        let state = ytmStore.getState();
        const likeButtonRenderer = playerBar.querySelector("ytmusic-like-button-renderer");
        const likeButtonData = likeButtonRenderer ? likeButtonRenderer.data : undefined;
        const defaultLikeStatus = likeButtonData?.likeStatus ?? "UNKNOWN";
        const storeLikeStatus = state.likeStatus?.videos?.[videoDetails.videoId];

        const likeStatus = storeLikeStatus ? storeLikeStatus : defaultLikeStatus;

        window.ytmd.sendVideoData(videoDetails, playlistId, album, likeStatus, hasFullMetadata);
      }
    });
  }

  // Try to attach to the bar, retry if not available yet (handle slow loading)
  function attachEventsWithRetry(retried = 0) {
    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (playerBar && playerBar.playerApi) {
      tryAddPlayerEvents(playerBar);
    } else if (retried < 20) {
      setTimeout(() => {
        attachEventsWithRetry(retried + 1);
      }, 200);
    }
  }
  attachEventsWithRetry();

  ytmStore.subscribe(() => {
    sendStoreState();
  });

  window.addEventListener("yt-action", e => {
    if (!e.detail) return;
    if (e.detail.actionName === "yt-service-request") {
      if (
        Array.isArray(e.detail.args) &&
        e.detail.args[1] &&
        e.detail.args[1].createPlaylistServiceEndpoint
      ) {
        let title = e.detail.args[2]?.create_playlist_title;
        let returnValue = e.detail.returnValue;
        if (
          Array.isArray(returnValue) &&
          returnValue[0] &&
          returnValue[0].ajaxPromise &&
          typeof returnValue[0].ajaxPromise.then === "function"
        ) {
          returnValue[0].ajaxPromise.then(response => {
            let id = response?.data?.playlistId;
            if (id) {
              window.ytmd.sendCreatePlaylistObservation({
                title,
                id
              });
            }
          });
        }
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      let playlistId = e.detail.args?.[0]?.handlePlaylistDeletionCommand?.playlistId;
      if (playlistId) {
        window.ytmd.sendDeletePlaylistObservation(playlistId);
      }
    }
  });
})();
