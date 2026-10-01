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
    const fromAttr = normalizeLikeStatus(renderer.getAttribute?.("like-status")) ||
      normalizeLikeStatus(renderer.data?.likeStatus) ||
      normalizeLikeStatus(renderer.likeStatus);

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
      const pressed = button.getAttribute("aria-pressed") === "true";
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      if (label.includes("dislike") && (pressed || label.includes("remove"))) return "DISLIKE";
      if ((label.includes("unlike") || label.includes("remove like") || label.includes("좋아요 취소")) && pressed !== false)
        return "LIKE";
      if (pressed && label.includes("like") && !label.includes("dislike")) return "LIKE";
    }
    return fromAttr;
  }

  function pickLikeStatus(...values) {
    const statuses = values.map(normalizeLikeStatus).filter(Boolean);
    if (statuses.includes("LIKE")) return "LIKE";
    if (statuses.includes("DISLIKE")) return "DISLIKE";
    if (statuses.includes("INDIFFERENT")) return "INDIFFERENT";
    return "UNKNOWN";
  }

  function getLikeStatus(videoId) {
    const renderer = queryDeep(playerBar, "ytmusic-like-button-renderer") || queryDeep(document, "ytmusic-like-button-renderer");
    const state = ytmStore.getState();
    return pickLikeStatus(
      likeStatusFromRenderer(renderer),
      state.likeStatus?.videos?.[videoId],
      playerBar.likeStatus
    );
  }

  function textOf(element) {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function pickText(root, selectors) {
    for (const selector of selectors) {
      const text = textOf(root?.querySelector(selector));
      if (text) return text;
    }
    return null;
  }

  function visible(element) {
    return !!element && element.offsetParent !== null;
  }

  const SKIP_SELECTORS = [".ytp-ad-skip-button-modern", ".ytp-ad-skip-button", ".ytp-skip-ad-button"];

  function findSkipButton(root) {
    for (const selector of SKIP_SELECTORS) {
      const button = root?.querySelector(selector);
      if (visible(button)) return button;
    }
    return null;
  }

  // The ad runs on a player the YTM playerApi callbacks never report on: no progress, no state
  // change, no data change, and getPlayerResponse() keeps returning the interrupted song. Every
  // fact about an ad has to be read off the real player element.
  function getMoviePlayer() {
    return document.querySelector("#movie_player") || queryDeep(document, "#movie_player");
  }

  function readAdState() {
    const moviePlayer = getMoviePlayer();
    const adShowing = !!moviePlayer && moviePlayer.classList.contains("ad-showing");
    let adState = false;
    try {
      adState = playerApi.getAdState?.() === 1;
    } catch {
      adState = false;
    }
    const storeAd = ytmStore.getState()?.player?.adPlaying === true;
    if (!adShowing && !adState && !storeAd) return null;

    // While an ad shows, this video element IS the ad.
    const video = moviePlayer?.querySelector("video");
    const duration = Number.isFinite(video?.duration) ? video.duration : 0;

    return {
      title: pickText(moviePlayer, [".ytp-ad-visit-advertiser-button .ytp-ad-button-text", ".ytp-ad-title"]),
      advertiser: pickText(moviePlayer, [".ytp-ad-visit-advertiser-button", ".ytp-ad-hover-text-button"]),
      badge: pickText(moviePlayer, [".ytp-ad-simple-ad-badge", ".ytp-ad-badge", ".ytp-ad-text"]),
      durationSeconds: duration,
      progressSeconds: Number.isFinite(video?.currentTime) ? video.currentTime : 0,
      isPlaying: !!video && !video.paused,
      canSkip: !!findSkipButton(moviePlayer),
      skipHint: pickText(moviePlayer, [".ytp-ad-preview-text", ".ytp-ad-preview-container"]),
      signals: { adShowing, adState, storeAd }
    };
  }

  let adTickId = null;
  let adActive = false;

  function pushAdState() {
    const ad = readAdState();
    const active = !!ad;

    if (active !== adActive) {
      adActive = active;
      // One line per transition, so a stale selector is diagnosable from the log instead of guessed at.
      window.ytmd.sendAdDiagnostic(
        active ? `ad started ${JSON.stringify(ad.signals)} duration=${ad.durationSeconds} canSkip=${ad.canSkip}` : "ad ended"
      );
    }

    window.ytmd.sendAdState(ad);

    if (active && adTickId === null) {
      adTickId = setInterval(pushAdState, 500);
    } else if (!active && adTickId !== null) {
      clearInterval(adTickId);
      adTickId = null;
    }
  }

  let watchAttempts = 0;

  function watchForAds() {
    const moviePlayer = getMoviePlayer();
    if (!moviePlayer) {
      watchAttempts += 1;
      // Say so rather than retrying in silence: without this element there is no ad reporting at all.
      if (watchAttempts === 30) window.ytmd.sendAdDiagnostic("#movie_player never appeared; ad reporting is off");
      if (watchAttempts <= 30) setTimeout(watchForAds, 1000);
      return;
    }
    // Ads start and end without dispatching a store action, so the class attribute is the trigger.
    new MutationObserver(pushAdState).observe(moviePlayer, { attributes: true, attributeFilter: ["class"] });
    pushAdState();
  }

  function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();
    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    window.ytmd.sendStoreUpdate(state.queue, getLikeStatus(videoId), state.player.volume, state.player.muted);
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
  watchForAds();

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
