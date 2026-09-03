(function() {
  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  if (!playerBar) throw new Error("Player bar unavailable");
  const playerApi = playerBar.playerApi;

  function unwrapRenderer(item) {
    if (!item) return null;
    if (item.playlistPanelVideoRenderer) return item.playlistPanelVideoRenderer;
    if (item.playlistPanelVideoWrapperRenderer) return item.playlistPanelVideoWrapperRenderer.primaryRenderer?.playlistPanelVideoRenderer ?? null;
    return null;
  }

  function counterpartRenderers(item) {
    const counterparts = item?.playlistPanelVideoWrapperRenderer?.counterpart ?? [];
    return counterparts.map(counterpart => counterpart.counterpartRenderer?.playlistPanelVideoRenderer).filter(Boolean);
  }

  function musicVideoTypeOf(renderer) {
    return renderer?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? null;
  }

  // The radio YTM itself would start from a track is in that track's overflow menu. Reusing it keeps
  // the params and the music config YTM expects instead of guessing at them.
  function radioEndpointOf(renderer) {
    for (const menuItem of renderer?.menu?.menuRenderer?.items ?? []) {
      const endpoint = (menuItem.menuNavigationItemRenderer ?? menuItem.menuServiceItemRenderer)?.navigationEndpoint?.watchEndpoint;
      if (endpoint?.playlistId?.startsWith("RD")) return endpoint;
    }
    return null;
  }

  const state = window.__YTMD_HOOK__.ytmStore.getState();
  const queue = state.queue;
  const currentItem = queue?.items?.[queue?.selectedItemIndex];
  const currentRenderer = unwrapRenderer(currentItem);

  // A music video seeds a music video radio. When the same track exists as a song, seed from that
  // instead so the mix stays audio.
  let seedRenderer = currentRenderer;
  if (musicVideoTypeOf(currentRenderer) !== "MUSIC_VIDEO_TYPE_ATV") {
    const audioCounterpart = counterpartRenderers(currentItem).find(renderer => musicVideoTypeOf(renderer) === "MUSIC_VIDEO_TYPE_ATV");
    if (audioCounterpart) seedRenderer = audioCounterpart;
  }

  const playerResponse = playerApi.getPlayerResponse();
  const seedVideoId = seedRenderer?.videoId || playerResponse?.videoDetails?.videoId;
  if (!seedVideoId) throw new Error("No track to start a mix from");

  const watchEndpoint = radioEndpointOf(seedRenderer) ?? {
    videoId: seedVideoId,
    playlistId: `RDAMVM${seedVideoId}`,
    params: "wAEB",
    watchEndpointMusicSupportedConfigs: {
      watchEndpointMusicConfig: {
        hasPersistentPlaylistPanel: true,
        // Without this YTM reads the RDAMVM seed as a video seed and fills the queue with music videos.
        musicVideoType: musicVideoTypeOf(seedRenderer) || playerResponse?.videoDetails?.musicVideoType || "MUSIC_VIDEO_TYPE_ATV"
      }
    }
  };

  document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint } } }));

  return { videoId: watchEndpoint.videoId ?? seedVideoId, playlistId: watchEndpoint.playlistId ?? null };
})
