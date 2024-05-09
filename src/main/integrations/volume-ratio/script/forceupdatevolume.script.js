(function() {
  let volume = document.querySelector("ytmusic-player-bar").playerApi.getVolume();
  document.querySelector("ytmusic-player-bar").playerApi.setVolume(volume);
  window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: volume });
})
