import ytmhook from "./ytmhook";
import protectedapimanager from "./protectedapimanager";

function getLikeStatus() {
  try {
    const ytmStore = ytmhook.ytmStateStore.store;
    const state = ytmStore.getState();

    let status = "INDIFFERENT";
    if (
      state.playerPage &&
      state.playerPage.playerOverlay &&
      state.playerPage.playerOverlay.playerOverlayRenderer
    ) {
      if (state.playerPage.playerOverlay.playerOverlayRenderer.actions) {
        status =
          state.playerPage.playerOverlay.playerOverlayRenderer.actions[0]
            .likeButtonRenderer.likeStatus;
      } else if (
        state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar
      ) {
        // New player bar
        const actionBar =
          state.playerPage.playerOverlay.playerOverlayRenderer.videoActionBar;
        const viewModel =
          actionBar.videoActionBarViewModel.buttons[0].buttonViewModel
            .segmentedLikeDislikeButtonViewModel;
        status =
          viewModel.likeButtonViewModel.likeButtonViewModel.likeStatusEntity
            .likeStatus;
      }
    }
    return status;
  } catch (err) {
    console.error("[ytmd-err(getLikeStatus)]", err);
    return null;
  }
}

async function remapThumbnailsToDataUrl(thumbnails: any[]) {
  for (const thumbnail of thumbnails) {
    if (thumbnail.url) {
      try {
        // YTM utilizes CacheStorage and more specifically for thumbnails it's from `caches.open("yt-player-local-img:${yt.config_.DATASYNC_ID}")`
        const response = await caches.match(thumbnail.url);
        if (response && response.ok) {
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          thumbnail.url = dataUrl;
        }
      } catch (err) {
        console.error(
          "[ytmd-err(sendVideoData)] Could not update thumbnail url to data url",
          err,
        );
      }
    }
  }
}

const UNAVAILABLE_PLAYABILITY_STATUSES = new Set([
  "UNPLAYABLE",
  "LOGIN_REQUIRED",
  "ERROR",
]);

export type TrackLifecycleSignal =
  | { type: "NEW_PLAYBACK" }
  | { type: "TRACK_ENDED"; videoId: string }
  | {
      type: "TRACK_UNAVAILABLE";
      videoId: string | null;
      reason: string | number;
    };

export interface TrackLifecycleTracker {
  setHydratedState(videoState: number): void;
  onStateChange(
    state: number,
    context: { currentVideoId: string | null; adPlaying: boolean },
  ): TrackLifecycleSignal | null;
  onVideoDataChange(event: { playertype?: number; type?: string }): {
    emitNewPlayback: boolean;
    shouldSendVideoData: boolean;
  };
  checkPlayabilityStatus(
    playerResponse:
      | {
          playabilityStatus?: { status?: string };
          videoDetails?: { videoId?: string };
        }
      | null
      | undefined,
    fallbackVideoId: string | null,
  ): Extract<TrackLifecycleSignal, { type: "TRACK_UNAVAILABLE" }> | null;
  onError(
    code: string | number,
    currentVideoId: string | null,
  ): Extract<TrackLifecycleSignal, { type: "TRACK_UNAVAILABLE" }>;
}

/**
 * Tracks edge-triggered track end transitions and unavailable track conditions
 * independently of YTM player and DOM globals.
 */
export function createTrackLifecycleTracker(): TrackLifecycleTracker {
  let previousVideoState = -1;
  let trackEndedForVideoId: string | null = null;

  return {
    setHydratedState(videoState: number): void {
      previousVideoState = videoState;
    },

    onStateChange(
      state: number,
      context: { currentVideoId: string | null; adPlaying: boolean },
    ): TrackLifecycleSignal | null {
      if (state === 1) {
        trackEndedForVideoId = null;
      }

      let signal: TrackLifecycleSignal | null = null;
      if (
        (previousVideoState === 1 || previousVideoState === 2) &&
        state === 0 &&
        !context.adPlaying &&
        context.currentVideoId &&
        trackEndedForVideoId !== context.currentVideoId
      ) {
        trackEndedForVideoId = context.currentVideoId;
        signal = { type: "TRACK_ENDED", videoId: context.currentVideoId };
      }

      previousVideoState = state;
      return signal;
    },

    onVideoDataChange(event: { playertype?: number; type?: string }): {
      emitNewPlayback: boolean;
      shouldSendVideoData: boolean;
    } {
      if (event.playertype !== 1) {
        return { emitNewPlayback: false, shouldSendVideoData: false };
      }

      const emitNewPlayback = event.type === "newdata";
      if (emitNewPlayback) {
        trackEndedForVideoId = null;
      }

      const shouldSendVideoData =
        event.type === "dataloaded" || event.type === "dataupdated";
      return { emitNewPlayback, shouldSendVideoData };
    },

    checkPlayabilityStatus(
      playerResponse,
      fallbackVideoId: string | null,
    ): Extract<TrackLifecycleSignal, { type: "TRACK_UNAVAILABLE" }> | null {
      const playabilityStatus = playerResponse?.playabilityStatus?.status;
      if (
        playabilityStatus &&
        UNAVAILABLE_PLAYABILITY_STATUSES.has(playabilityStatus)
      ) {
        return {
          type: "TRACK_UNAVAILABLE",
          videoId: playerResponse?.videoDetails?.videoId ?? fallbackVideoId,
          reason: playabilityStatus,
        };
      }
      return null;
    },

    onError(
      code: string | number,
      currentVideoId: string | null,
    ): Extract<TrackLifecycleSignal, { type: "TRACK_UNAVAILABLE" }> {
      return {
        type: "TRACK_UNAVAILABLE",
        videoId: currentVideoId,
        reason: code,
      };
    },
  };
}

function getSelectedQueueItem(state: any) {
  const items = state?.queue?.items;
  if (!Array.isArray(items)) return null;

  const selectedItem = items.find((item) => {
    return (
      item.playlistPanelVideoRenderer?.selected ??
      item.playlistPanelVideoWrapperRenderer?.primaryRenderer
        ?.playlistPanelVideoRenderer?.selected
    );
  });
  return (
    selectedItem?.playlistPanelVideoRenderer ??
    selectedItem?.playlistPanelVideoWrapperRenderer?.primaryRenderer
      ?.playlistPanelVideoRenderer ??
    null
  );
}

export default function init() {
  const playerStateApi = protectedapimanager.createOrGetAPI("PlayerState");
  const ytmStore = ytmhook.ytmStateStore.store;
  //const playerBar = ytmhook.ytmPlayerController;
  const playerApi = ytmhook.ytmPlayerController.playerApi;
  const lifecycle = createTrackLifecycleTracker();

  function getCurrentVideoId(): string | null {
    return (
      playerApi.getPlayerResponse()?.videoDetails?.videoId ??
      getSelectedQueueItem(ytmStore.getState())?.videoId ??
      null
    );
  }

  async function sendStoreState() {
    // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
    const state = ytmStore.getState();

    const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
    const defaultLikeStatus = getLikeStatus() ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoId];

    const likeStatus = storeLikeStatus
      ? state.likeStatus.videos[videoId]
      : defaultLikeStatus;
    const volume = state.player.volume;
    const adPlaying = state.player.adPlaying;
    const muted = state.player.muted;

    // This feature which can remap queue item thumbnails into data url is extremely intensive both memory and for companion api responses
    //
    // We opt for a tradeoff below of just remapping the currently playing videos thumbnails to data url
    /*
    const queue = structuredClone(state.queue);
    // Check if offline then convert the thumbnail url by requesting it
    const networkStatusManager = window["yt"]?.networkStatusManager?.instance?.sharedNetworkStatusManager;
    if (networkStatusManager && !networkStatusManager.isNetworkAvailable()) {
      for (const item of queue.items) {
        let playlistPanelVideoRenderer;
        if (item.playlistPanelVideoRenderer) {
          playlistPanelVideoRenderer = item.playlistPanelVideoRenderer;
        } else if (item.playlistPanelVideoWrapperRenderer) {
          playlistPanelVideoRenderer = item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer
        }
        await remapThumbnailsToDataUrl(playlistPanelVideoRenderer.thumbnail?.thumbnails ?? []);
      }
    }
    */

    playerStateApi.postMessage(
      "updateFromStore",
      state.queue,
      likeStatus,
      volume,
      muted,
      adPlaying,
    );
  }

  async function sendVideoData() {
    const state = ytmStore.getState();
    const playerResponse = playerApi.getPlayerResponse();
    const unavailable = lifecycle.checkPlayabilityStatus(
      playerResponse,
      getCurrentVideoId(),
    );
    if (unavailable) {
      console.warn(
        `[ytmd-warn(sendVideoData)] Track unavailable (videoId=${unavailable.videoId ?? "unknown"}, status=${unavailable.reason})`,
      );
      playerStateApi.postMessage(
        "trackUnavailable",
        unavailable.videoId,
        unavailable.reason,
      );
    }
    if (!playerResponse?.videoDetails) return;

    const videoDetails = structuredClone(playerResponse.videoDetails);
    const playlistId = playerApi.getPlaylistId();
    let album: any | null = null;
    let hasFullMetadata = false;

    const currentItem = getSelectedQueueItem(state);
    if (currentItem !== null && currentItem !== undefined) {
      hasFullMetadata = true;

      // Fill out video details with better information
      videoDetails.title = currentItem.title.runs.map((v) => v.text).join(""); // Can contain featuring text which isn't in player response
      videoDetails.thumbnail = structuredClone(currentItem.thumbnail); // Can contain more thumbnails than player response

      // Maybe obtain the album information from a text run
      for (let i = 0; i < currentItem.longBylineText.runs.length; i++) {
        const item = currentItem.longBylineText.runs[i];
        if (item.navigationEndpoint) {
          if (
            item.navigationEndpoint.browseEndpoint
              .browseEndpointContextSupportedConfigs
              .browseEndpointContextMusicConfig.pageType ===
            "MUSIC_PAGE_TYPE_ALBUM"
          ) {
            album = {
              id: item.navigationEndpoint.browseEndpoint.browseId,
              text: item.text,
            };
          }
        }
      }
    }

    const defaultLikeStatus = getLikeStatus() ?? "UNKNOWN";
    const storeLikeStatus = state.likeStatus.videos[videoDetails.videoId];

    const likeStatus = storeLikeStatus
      ? state.likeStatus.videos[videoDetails.videoId]
      : defaultLikeStatus;

    // Check if offline then convert the thumbnail url to data url if possible
    //
    // This provides a quality of life where at least when something is currently playing and we're offline the media service
    // or anything that may present the currently playing media thumbnail has something tangible to work with
    const networkStatusManager =
      window["yt"]?.networkStatusManager?.instance?.sharedNetworkStatusManager;
    if (networkStatusManager && !networkStatusManager.isNetworkAvailable()) {
      await remapThumbnailsToDataUrl(videoDetails.thumbnail?.thumbnails ?? []);
    }

    playerStateApi.postMessage(
      "updateVideoDetails",
      videoDetails,
      playlistId,
      album,
      likeStatus,
      hasFullMetadata,
    );
  }

  function hydrateApplicationState() {
    sendStoreState();

    const progressState = playerApi.getProgressState();
    playerStateApi.postMessage("updateVideoProgress", progressState.current);

    const videoState = playerApi.getPlayerState();
    lifecycle.setHydratedState(videoState);
    playerStateApi.postMessage("updateVideoState", videoState);

    sendVideoData();
  }

  // It is mandatory that try catch be used within these so that we handle errors for YTMD and not throw them back to YTM
  playerApi.addEventListener("onVideoProgress", (progress) => {
    try {
      playerStateApi.postMessage("updateVideoProgress", progress);
    } catch (err) {
      console.error("[ytmd-err(playerApi.onVideoProgress)]", err);
    }
  });
  playerApi.addEventListener("onStateChange", (state) => {
    try {
      playerStateApi.postMessage("updateVideoState", state);

      const signal = lifecycle.onStateChange(state, {
        currentVideoId: getCurrentVideoId(),
        adPlaying: Boolean(ytmStore.getState()?.player?.adPlaying),
      });
      if (signal?.type === "TRACK_ENDED") {
        console.info(
          `[ytmd-info(playerApi.onStateChange)] Track ended (videoId=${signal.videoId})`,
        );
        playerStateApi.postMessage(
          "playerSignal",
          "TRACK_ENDED",
          signal.videoId,
        );
      }
    } catch (err) {
      console.error("[ytmd-err(playerApi.onStateChange)]", err);
    }
  });
  playerApi.addEventListener("onError", (code) => {
    try {
      const unavailable = lifecycle.onError(code, getCurrentVideoId());
      console.warn(
        `[ytmd-warn(playerApi.onError)] Track unavailable (videoId=${unavailable.videoId ?? "unknown"}, code=${String(unavailable.reason)})`,
      );
      playerStateApi.postMessage(
        "trackUnavailable",
        unavailable.videoId,
        unavailable.reason,
      );
    } catch (err) {
      console.error("[ytmd-err(playerApi.onError)]", err);
    }
  });
  playerApi.addEventListener("onVideoDataChange", (event) => {
    try {
      const { emitNewPlayback, shouldSendVideoData } =
        lifecycle.onVideoDataChange(event);
      if (emitNewPlayback) {
        playerStateApi.postMessage("playerSignal", "NEW_PLAYBACK");
      }
      if (shouldSendVideoData) {
        sendVideoData();
      }
    } catch (err) {
      console.error("[ytmd-err(playerApi.onVideoDataChange)]", err);
    }
  });
  ytmStore.subscribe(() => {
    try {
      sendStoreState();
    } catch (err) {
      console.error("[ytmd-err(stateStore.subscribe)]", err);
    }
  });
  window.addEventListener("yt-action", (e: any) => {
    if (e.detail.actionName === "yt-service-request") {
      if (e.detail.args[1].createPlaylistServiceEndpoint) {
        const title = e.detail.args[2].create_playlist_title;
        const returnValue = e.detail.returnValue;
        returnValue[0].ajaxPromise.then((response) => {
          const id = response.data.playlistId;

          playerStateApi.postMessage("playlistCreated", {
            title,
            id,
          });
        });
      }
    } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
      const playlistId =
        e.detail.args[0].handlePlaylistDeletionCommand.playlistId;
      playerStateApi.postMessage("playlistDeleted", playlistId);
    }
  });

  try {
    hydrateApplicationState();
  } catch (err) {
    console.error("[ytmd-err(hydrateApplicationState)]", err);
  }
}

export async function waitForYTMPlayerApiReady() {
  const playerApi = ytmhook.ytmPlayerController.playerApi;

  await new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      const playerApiReady: boolean = playerApi.isReady();

      if (playerApiReady) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}
