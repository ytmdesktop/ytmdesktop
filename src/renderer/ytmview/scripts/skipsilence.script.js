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

  // Threshold: ~ -54 dBFS in normalized amplitude (prevents false positives on quiet acoustic intros)
  const SILENCE_THRESHOLD = 0.002;

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
  let leadingSilenceMs = 0;

  function resetTrackState() {
    leadingDone = false;
    trailingDone = false;
    hasPlayedMusic = false;
    leadingSilenceMs = 0;
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
    if (video.currentTime < 0.3 && leadingDone) {
      leadingDone = false;
      leadingSilenceMs = 0;
    }

    // Must be actively playing and buffered
    if (video.readyState < 3 || video.paused || video.ended || video.seeking || !video.duration || isNaN(video.duration) || video.muted) {
      return;
    }

    // Never skip silence if AudioContext is not running yet
    if (!audioCtx || audioCtx.state !== "running") {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(function() {});
      }
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

    // 1. LEADING SILENCE (Intro of the track, first 6 seconds)
    if (!leadingDone && currentTime < 6) {
      if (normRms >= SILENCE_THRESHOLD) {
        // Music detected! Smoothly ensure normal playback speed without any seeking stutter
        hasPlayedMusic = true;
        leadingDone = true;
        if (video.playbackRate !== 1.0) {
          video.playbackRate = 1.0;
        }
        if (gainNode && audioCtx) {
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        }
      } else {
        // Give audio stream 400ms buffer grace period before accelerating dead silence
        if (currentTime >= 0.4) {
          leadingSilenceMs += deltaMs;
          if (leadingSilenceMs > 350) {
            video.playbackRate = 2.5;
          }
        }
      }
      return;
    } else if (!leadingDone && currentTime >= 6) {
      leadingDone = true;
      if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
      if (gainNode && audioCtx) gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }

    // 2. TRAILING SILENCE (Outro of track, ONLY final 5 seconds of songs longer than 20s and only if song has played)
    if (!trailingDone && hasPlayedMusic && duration > 20 && currentTime >= duration - 5) {
      if (normRms < SILENCE_THRESHOLD) {
        trailingSilenceMs += deltaMs;
        if (trailingSilenceMs >= 1000) {
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
