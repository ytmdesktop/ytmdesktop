const api_version = 'v1';
const prefix = `http://localhost:9863/api/${api_version}`;

const appData = {
  appId: 'ytmd-remote-control',
  appName: 'YTMD Remote Control',
  appVersion: '0.0.1'
};

document.addEventListener('DOMContentLoaded', function() {
  // Add a Custom CSS property (--control-height) on #control with the height of the window
  document.getElementById('control').style.setProperty('--control-height', window.outerHeight + 'px');
  window.addEventListener('resize', () => {
    document.getElementById('control').style.setProperty('--control-height', window.outerHeight + 'px');
  });

  // Check {prefix}/metadata to see if it supports the API Version
  // fetch(`${prefix}/metadata`)
  //   .then(response => response.json())
  //   .then(data => {
  //     if (data.apiVersions.indexOf(version) === -1) {
  //       console.error(`API Version ${version} is not supported by the Client`);
  //     }
  //   })
  //   .catch(error => {
  //     console.error('Error:', error);
  //   });


  if (!localStorage.getItem('code')) {
    fetch(`${prefix}/auth/requestcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(appData),
      timeout: 30000
    })
      .then(response => response.json())
      .then(data => {
        console.log('Success:', data);
        localStorage.setItem('code', data.code);

        getToken();
      })
      .catch(error => {
        console.error('Error:', error);
      });
  }
  if (!localStorage.getItem('token')) {
    getToken();
  }

  else {
    getInitialStateAndStart();
  }
});

function getToken() {
  fetch(`${prefix}/auth/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: localStorage.getItem('code'),
      appId: appData.appId
    }),
    timeout: 30000
  })

    .then(response => response.json())
    .then(data => {
      localStorage.setItem('token', data.token);
      getInitialStateAndStart();
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

function getInitialStateAndStart() {
  fetch(`${prefix}/state`, {
    headers: {
      'Authorization': localStorage.getItem('token')
    }
  })
    .then(response => response.json())
    .then(data => {
      console.log('Success:', data);

      displayState(data);
    })
    .catch(error => {
      console.error('Error:', error);
    });


  var socket = io(`ws://${prefix.replace('http://', '')}/realtime`, {
    auth: {
      token: localStorage.getItem('token')
    },
    transports: ['websocket']
  })
  socket.on("state-update", (stateData) => {
    displayState(stateData);
  })
}

var lastState = null;
function displayState(stateData) {
  const {
    video,
    player,
    playlistId
  } = stateData;

  if (!lastState || lastState.video.author !== video.author) {
    document.getElementById('artist').innerText = video.author;
  }

  if (!lastState || lastState.video.title !== video.title) {
    document.getElementById('title').innerText = video.title;
  }

  if (!lastState || lastState.video.likeStatus !== video.likeStatus) {
    // -1 = Unknown, 0 Disliked, 1 = Indifferent, 2 = Liked
    const likeIcon = document.querySelector('#control-like svg use');
    const dislikeIcon = document.querySelector('#control-dislike svg use');

    switch(video.likeStatus) {
      case 0:
        likeIcon.setAttribute('href', '#like-outline');
        dislikeIcon.setAttribute('href', '#dislike-filled');
        break;

      case 2:
        likeIcon.setAttribute('href', '#like-filled');
        dislikeIcon.setAttribute('href', '#dislike-outline');
        break;

      default:
        likeIcon.setAttribute('href', '#like-outline');
        dislikeIcon.setAttribute('href', '#dislike-outline');
        break;
    }
  }

  if (!lastState || lastState.video.id !== video.id) {
    // We can update a few things here
    const thumbnail = getLargeThumbnail(video.thumbnails);
    let albumArts = document.getElementsByClassName('albumart')
    for (let i = 0; i < albumArts.length; i++) {
      albumArts[i].src = thumbnail;
    }

    const totalDuration = humanReadableSeconds(video.durationSeconds);
    document.getElementsByClassName('totaltime')[0].innerText = totalDuration;
  }


  if (!lastState || lastState.player.trackState !== player.trackState) {
    const playPauseButton = document.getElementById('control-playpause');

    // #control-playpause div svg use
    const playPauseIcon = document.querySelector('#control-playpause div svg use');
    if (player.trackState === 0) {
      playPauseIcon.setAttribute('href', '#play');
    }
    else if (player.trackState === 1) {
      playPauseIcon.setAttribute('href', '#pause');
    }

    // This is kinda bad because as it doesn't show well due to how short the buffer is
    if (player.trackState === 2) {
      playPauseIcon.setAttribute('href', '#buffer');
      playPauseIcon.parentElement.classList.add('buffer-rotate');
    }
    else {
      playPauseIcon.parentElement.classList.remove('buffer-rotate');
    }
  }

  if (!lastState || lastState.player.queue.repeatMode !== player.queue.repeatMode) {
    const repeatIcon = document.querySelector('#control-repeat svg use');
    repeatIcon.setAttribute('data-state', player.queue.repeatMode);
    if (player.queue.repeatMode === 0) {
      repeatIcon.setAttribute('href', '#repeat-off');
    }
    else if (player.queue.repeatMode === 1) {
      repeatIcon.setAttribute('href', '#repeat-queue');
    }
    else if (player.queue.repeatMode === 2) {
      repeatIcon.setAttribute('href', '#repeat-song');
    }
  }

  if (!lastState || lastState.player.videoProgress !== player.videoProgress) {
    // Update the progress bar
    const durationPercent = player.videoProgress / video.durationSeconds;

    document.getElementById('progressbar').style.transform = `scaleX(${durationPercent})`;
    document.getElementById('progressSliderKnob').style.left = `${durationPercent * 100}%`;

    const currentTime = humanReadableSeconds(player.videoProgress);
    document.getElementsByClassName('currenttime')[0].innerText = currentTime;
  }

  if (!lastState || lastState.player.volume !== player.volume) {
    const volumePercent = player.volume;
    document.getElementById('volumebar').style.transform = `scaleX(${volumePercent / 100})`;
    document.getElementById('volumeSliderKnob').style.left = `${volumePercent}%`;
  }

  lastState = stateData;
}

function getLargeThumbnail(thumbnails) {
  var maxHeight = 0;
  var maxThumbnail = null;
  thumbnails.forEach(thumbnail => {
    if (thumbnail.height > maxHeight) {
      maxHeight = thumbnail.height;
      maxThumbnail = thumbnail;
    }
  });

  return maxThumbnail.url;
}

function humanReadableSeconds(seconds) {
  seconds = Math.floor(seconds);
  // Have to convert to MM:SS but also HH:MM:SS
  if (seconds < 60) {
    return `00:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  }

  const hours = Math.floor(seconds / 3600);
  const remainingMinutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours < 10 ? '0' : ''}${hours}:${remainingMinutes < 10 ? '0' : ''}${remainingMinutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

// ----------------------------------------------------------

document.getElementById('control-playpause').addEventListener('click', function() {
  sendCommand('playPause');
});

document.getElementById('control-previous').addEventListener('click', function() {
  sendCommand('previous');
});

document.getElementById('control-next').addEventListener('click', function() {
  sendCommand('next');
});

document.getElementById('control-repeat').addEventListener('click', function(e) {
  const repeatIcon = document.querySelector('#control-repeat svg use');

  const currentState = repeatIcon.getAttribute('data-state');
  let nextState = (currentState + 1) % 3;

  sendCommand('repeatMode', nextState)
});

document.getElementById('control-shuffle').addEventListener('click', function() {
  sendCommand('shuffle');
});

document.getElementById('control-like').addEventListener('click', function() {
  sendCommand('toggleLike');
});

document.getElementById('control-dislike').addEventListener('click', function() {
  sendCommand('toggleDislike');
});

document.getElementById('control-volume-toggle').addEventListener('click', function() {
  const currentState = document.getElementById('control-volume-toggle').getAttribute('data-state');
  let nextState = currentState === 'mute' ? 'unmute' : 'mute';

  sendCommand(nextState)
    .then(() => {
      document.getElementById('control-volume-toggle').setAttribute('data-state', nextState);

      if (nextState === 'mute') {
        document.querySelector('#control-volume-toggle svg use').setAttribute('href', `#volume-mute`);
      }
      else {
        document.querySelector('#control-volume-toggle svg use').setAttribute('href', `#volume`);
      }
    });
});

document.getElementById('progressSliderBar').addEventListener('click', function(e) {
  const percentage = e.offsetX / e.target.clientWidth;
  const duration = lastState.video.durationSeconds * percentage;

  sendCommand('seekTo', duration);
});

document.getElementById('volumeSliderBar').addEventListener('click', function(e) {
  const percentage = e.offsetX / e.target.clientWidth;
  sendCommand('setVolume', parseInt(percentage * 100));
});

function sendCommand(command, data = null) {
  const body = {
    command
  };
  if (data !== null) {
    body.data = data;
  }

  return fetch(`${prefix}/command`, {
    method: 'POST',
    headers: {
      'Authorization': localStorage.getItem('token'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    .catch(error => {
      console.error('Error:', error);
    });
}