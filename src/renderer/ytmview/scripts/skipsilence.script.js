(function() {
  let isEnabled = true;
  let audioCtx = null;
  let sourceNode = null;
  let analyser = null;
  let gainNode = null;
  let dataArray = null;
  let currentVideo = null;
  let leadingDone = false;
  let trailingDone = false;
  let trailingSilenceMs = 0;
  let lastCheckTime = performance.now();
  let lastVideoId = "";

  // Threshold: ~ -50 dBFS in normalized amplitude
  const SILENCE_THRESHOLD = 0.0035;

  function initAudioNodes(video) {
    if (!video) return;
    if (video.__ytmd_silence_hooked) {
      currentVideo = video;
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtx) {
        audioCtx = new AudioCtx();
      }

      sourceNode = audioCtx.createMediaElementSource(video);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.1;

      gainNode = audioCtx.createGain();
      gainNode.gain.value = 1.0;

      // Routing: video -> sourceNode -> analyser -> gainNode -> audioCtx.destination
      sourceNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      dataArray = new Float32Array(analyser.fftSize);
      video.__ytmd_silence_hooked = true;
      video.addEventListener("play", resumeCtx, { passive: true });
      currentVideo = video;
    } catch (err) {
      console.warn("[YTMD SkipSilence] Audio routing fallback:", err);
    }
  }

  function getAudioRms() {
    if (!analyser || !dataArray) return 1.0;
    analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = dataArray[i];
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    const vol = (currentVideo && currentVideo.volume > 0.01) ? currentVideo.volume : 1.0;
    return rms / vol;
  }

    let hasPlayedMusic = false;

  function resetTrackState() {
    leadingDone = false;
    trailingDone = false;
    hasPlayedMusic = false;
    trailingSilenceMs = 0;
    if (currentVideo && currentVideo.playbackRate !== 1.0) {
      currentVideo.playbackRate = 1.0;
    }
    if (gainNode && audioCtx) {
      gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }
  }

  function checkSilence() {
    if (!isEnabled) return;
    const now = performance.now();
    const deltaMs = Math.min(100, now - lastCheckTime);
    lastCheckTime = now;

    const video = document.querySelector("video");
    if (!video) return;

    if (video !== currentVideo || !video.__ytmd_silence_hooked) {
      initAudioNodes(video);
      resetTrackState();
    }

    // Check if song changed by inspecting videoId
    const currentVideoId = window.__YTMD_HOOK__?.ytmPlayerBar?.playerApi?.getPlayerResponse?.()?.videoDetails?.videoId || "";
    if (currentVideoId && currentVideoId !== lastVideoId) {
      lastVideoId = currentVideoId;
      resetTrackState();
    }

    // If user looped or seeked back to start, re-enable leading silence skip
    if (video.currentTime < 0.5 && leadingDone) {
      leadingDone = false;
    }

    // Must be actively playing and buffered
    if (video.readyState < 3 || video.paused || video.ended || video.seeking || !video.duration || isNaN(video.duration)) {
      return;
    }

    // Never skip silence during ad playback
    const player = document.querySelector("#movie_player, .html5-video-player");
    if (player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"))) {
      return;
    }

    const currentTime = video.currentTime;
    const duration = video.duration;
    const normRms = getAudioRms();

    if (normRms >= SILENCE_THRESHOLD) {
      hasPlayedMusic = true;
    }

    // 1. LEADING SILENCE (Intro of the track, first 8 seconds)
    if (!leadingDone && currentTime < 8) {
      if (normRms < SILENCE_THRESHOLD) {
        if (gainNode && audioCtx) {
          gainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
        }
        video.playbackRate = 4.0;
      } else {
        video.playbackRate = 1.0;
        if (gainNode && audioCtx) {
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        }

        const safeStart = Math.max(0, video.currentTime - 0.08);
        video.currentTime = safeStart;
        leadingDone = true;
      }
      return;
    } else if (!leadingDone && currentTime >= 8) {
      leadingDone = true;
      if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
      if (gainNode && audioCtx) gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }

    // 2. TRAILING SILENCE (Outro of track, ONLY final 5 seconds of songs longer than 20s and only if song has played)
    if (!trailingDone && hasPlayedMusic && duration > 20 && currentTime >= duration - 5) {
      if (normRms < SILENCE_THRESHOLD) {
        trailingSilenceMs += deltaMs;
        if (trailingSilenceMs >= 1200) {
          trailingDone = true;
          const playerApi = window.__YTMD_HOOK__?.ytmPlayerBar?.playerApi;
          if (playerApi && typeof playerApi.nextVideo === "function") {
            playerApi.nextVideo();
          } else {
            const nextBtn = document.querySelector(".next-button, ytmusic-player-bar .next-button");
            if (nextBtn) {
              nextBtn.click();
            } else {
              video.currentTime = duration - 0.05;
            }
          }
        }
      } else {
        trailingSilenceMs = 0;
      }
    }
  }

  // Toggle listener
  window.addEventListener("ytmd:skipsilence:toggle", function(e) {
    isEnabled = !!(e.detail && e.detail.enabled);
    if (!isEnabled && currentVideo) {
      currentVideo.playbackRate = 1.0;
      if (gainNode && audioCtx) gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }
  });

  // Resume AudioContext on interaction
  const resumeCtx = function() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(function() {});
    }
  };
  window.addEventListener("click", resumeCtx, { passive: true });
  window.addEventListener("keydown", resumeCtx, { passive: true });

  // Reset on navigation
  document.addEventListener("yt-navigate-finish", resetTrackState);

  // Poll loop: 35ms interval for precise detection
  setInterval(checkSilence, 35);

  if (!window.__YTMD_HOOK__) window.__YTMD_HOOK__ = {};
  window.__YTMD_HOOK__.resetSilenceSkipper = resetTrackState;
})();
