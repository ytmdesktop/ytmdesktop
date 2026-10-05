(function() {
  let volume = window.__YTMD_HOOK__.ytmPlayerBar.playerApi.getVolume();
  window.__YTMD_HOOK__.ytmPlayerBar.playerApi.setVolume(volume);
  window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: volume });
})
