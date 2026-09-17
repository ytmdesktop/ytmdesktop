/* [YTMDesktop Electron Extension Shim] */
if (typeof chrome !== "undefined" && chrome?.storage) {
  try {
    if (!chrome.storage.local) {
      chrome.storage.local = chrome.storage.local;
    }
  } catch (e) {}
}
/**
 * @fileoverview YouTube Music player integration script for BetterLyrics.
 * Handles real-time player state monitoring and event dispatching.
 */

/**
 * Interval ID for the lyrics tick timer.
 * @type {number|null|undefined}
 */
let tickLyricsInterval;

/**
 * Last recorded player time to detect changes.
 * @type {number}
 */
let lastPlayerTime = 0;

/**
 * Last recorded player timestamp to interpolate time.
 * @type {number}
 */
let lastPlayerTimestamp = 0;

let lastSentPlaying = null;
let pausedTickCounter = 0;

let cachedContentRect = null;
let playerResizeObserver = null;
let lastVideoId = null;
let observedVideoElement = null;

/**
 * Writes the video's intrinsic aspect ratio (from the <video> element's
 * videoWidth/videoHeight) to a CSS variable so styles can resize the player
 * to match it (eliminating black bars). Removes the variable when no real
 * video frame is available so CSS falls back to its default.
 * @param {HTMLVideoElement | null} video
 */
const updateVideoAspectRatioVar = video => {
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    document.documentElement.style.setProperty(
      "--blyrics-video-aspect-ratio",
      `${video.videoWidth} / ${video.videoHeight}`
    );
  } else {
    document.documentElement.style.removeProperty("--blyrics-video-aspect-ratio");
  }
};

const handleVideoResize = () => updateVideoAspectRatioVar(observedVideoElement);

/**
 * Finds the <video> inside the player and (re)attaches a resize listener so
 * we react to intrinsic-dimension changes (loadedmetadata, quality switches).
 * @param {HTMLElement} player
 */
const attachVideoListener = player => {
  const video = player && player.querySelector("video");
  if (video !== observedVideoElement) {
    if (observedVideoElement) {
      observedVideoElement.removeEventListener("resize", handleVideoResize);
    }
    observedVideoElement = video || null;
    if (observedVideoElement) {
      observedVideoElement.addEventListener("resize", handleVideoResize);
    }
  }
  updateVideoAspectRatioVar(observedVideoElement);
};

/**
 * Sets up a ResizeObserver on the player element to cache the content rect.
 * This avoids querying the DOM layout every 20ms which causes performance drops.
 * @param {HTMLElement} player
 */
const setupResizeObserver = player => {
  if (playerResizeObserver) {
    playerResizeObserver.disconnect();
  }

  playerResizeObserver = new ResizeObserver(() => {
    if (player && typeof player.getVideoContentRect === "function") {
      cachedContentRect = player.getVideoContentRect();
    }
    attachVideoListener(player);
  });

  playerResizeObserver.observe(player);
  attachVideoListener(player);
};
// ------------------------------------------

/**
 * Starts the lyrics tick interval to monitor YouTube Music player state.
 * Dispatches custom events with player information every 20ms for real-time sync.
 * Automatically stops the previous interval if one exists.
 */
const startLyricsTick = () => {
  stopLyricsTick();

  let player = document.getElementById("movie_player");
  if (player) {
    setupResizeObserver(player);
  }

  tickLyricsInterval = setInterval(function () {
    if (!player || !player.isConnected) {
      player = document.getElementById("movie_player");
      if (player) {
        setupResizeObserver(player);
      }
    } else {
      try {
        const now = Date.now();

        const { video_id, title, author } = player.getVideoData();

        // Update the cached rect when the video changes, as aspect ratios might shift
        if (video_id !== lastVideoId) {
          lastVideoId = video_id;
          if (typeof player.getVideoContentRect === "function") {
            cachedContentRect = player.getVideoContentRect();
          }
          attachVideoListener(player);
        }

        const audioTrackData = player.getAudioTrack();
        const duration = player.getDuration();
        const { isPlaying, isBuffering } = player.getPlayerStateObject();

        // Use the cached contentRect. Fallback if it hasn't been cached yet.
        let contentRect = cachedContentRect;
        if (!contentRect && typeof player.getVideoContentRect === "function") {
          contentRect = player.getVideoContentRect();
          cachedContentRect = contentRect;
        }

        const currentTime = player.getCurrentTime();
        const playing = isPlaying && !isBuffering;

        // Throttle events when paused: only send every ~500ms instead of every 20ms
        if (!playing) {
          pausedTickCounter++;
          const stateChanged = lastSentPlaying !== playing;
          const timeChanged = currentTime !== lastPlayerTime;
          if (!stateChanged && !timeChanged && pausedTickCounter < 25) {
            return;
          }
          pausedTickCounter = 0;
        }
        lastSentPlaying = playing;

        // Extrapolate the current time
        if (currentTime !== lastPlayerTime || !playing) {
          lastPlayerTime = currentTime;
          lastPlayerTimestamp = now;
        }

        const timeDiff = (now - lastPlayerTimestamp) / 1000;
        const time = currentTime + timeDiff;

        document.dispatchEvent(
          new CustomEvent("blyrics-send-player-time", {
            detail: {
              currentTime: time,
              videoId: video_id,
              song: title,
              artist: author,
              duration: duration,
              audioTrackData: audioTrackData,
              browserTime: now,
              playing: playing,
              contentRect,
            },
          })
        );
      } catch (e) {
        console.log(e);
        stopLyricsTick();
      }
    }
  }, 20);
};

/**
 * Stops the lyrics tick interval, clears the timer, and cleans up observers.
 * Called when the page is unloaded or when an error occurs.
 */
const stopLyricsTick = () => {
  if (tickLyricsInterval) {
    clearInterval(tickLyricsInterval);
    tickLyricsInterval = null;
  }

  if (playerResizeObserver) {
    playerResizeObserver.disconnect();
    playerResizeObserver = null;
  }

  if (observedVideoElement) {
    observedVideoElement.removeEventListener("resize", handleVideoResize);
    observedVideoElement = null;
  }
};

window.addEventListener("unload", stopLyricsTick);

document.addEventListener("blyrics-seek-to", event => {
  const player = document.getElementById("movie_player");
  const seekTime = event.detail ?? 0;
  if (player && seekTime >= 0) {
    player.seekTo(seekTime, true);
    player.playVideo();
  }
});

startLyricsTick();
