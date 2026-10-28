// eslint-disable-next-line @typescript-eslint/no-unused-expressions
(function() {
  let volume = window.__YTMD_HOOK__.ytmPlayerController.playerApi.getVolume();
  window.__YTMD_HOOK__.ytmPlayerController.playerApi.setVolume(volume);
  window.__YTMD_HOOK__.ytmStateStore.store.dispatch({ type: 'SET_VOLUME', payload: volume });
})
