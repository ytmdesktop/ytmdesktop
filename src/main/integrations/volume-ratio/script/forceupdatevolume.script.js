(function() {
  let volume = window.__YTMD_HOOK__.ytmAppLayout.playerApi.getVolume();
  window.__YTMD_HOOK__.ytmAppLayout.playerApi.setVolume(volume);
  window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: volume });
})
