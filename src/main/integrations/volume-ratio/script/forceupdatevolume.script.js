(function() {
  let volume = document.querySelector("ytmusic-player-bar").playerApi.getVolume();
  document.querySelector("ytmusic-player-bar").playerApi.setVolume(volume);
  document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: volume });
})
