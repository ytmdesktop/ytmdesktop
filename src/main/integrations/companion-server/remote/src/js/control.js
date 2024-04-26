const api_version = 'v1';
const getPrefix = (withVer = true) => {
  return (
    `http://${localStorage.getItem('ip') || 'localhost'}:9863` +
    (withVer ? `/api/${api_version}` : '')
  );
}

const appData = {
  appId: 'ytmd-remote-control',
  appName: 'YTMD Remote Control',
  appVersion: '0.0.1'
};

document.addEventListener('DOMContentLoaded', function() {
  // Add a Custom CSS property (--control-height) on #control with the height of the window
  const control = document.getElementById('control');

  control.style.setProperty('--control-height', control.clientHeight + 'px');
  window.addEventListener('resize', () => {
    control.style.setProperty('--control-height', control.clientHeight + 'px');
  });

  const materialtabs = document.getElementsByClassName('material-tabs');
  for (let i = 0; i < materialtabs.length; i++) {
    const currentMTab = materialtabs[i];
    const links = currentMTab.querySelectorAll('a');

    const active = links[0];
    active.classList.add('active');

    const content = document.getElementById(active.getAttribute('href').split('#')[1]);
    content.style.display = null;

    links.forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        
        const active = currentMTab.querySelector('.active');
        active.classList.remove('active');
  
        const content = document.getElementById(active.getAttribute('href').split('#')[1]);
        content.style.display = 'none';
  
        e.target.classList.add('active');
        const target = document.getElementById(e.target.getAttribute('href').split('#')[1]);
        target.style.display = null;

        const bottomDraw = document.querySelector('.bottom-draw');
        bottomDraw.setAttribute('open', '');
      });

      if (link === active) {return;}

      const target = document.getElementById(link.getAttribute('href').split('#')[1]);
      target.style.display = 'none';
    });

  }

  const header = document.getElementsByClassName('header')[0];
  const bottomDraw = document.querySelector('.bottom-draw');
  header.addEventListener('click', function() {
    if (bottomDraw.hasAttribute('open')) {
      bottomDraw.removeAttribute('open');
    }
  });

  if (!localStorage.getItem('ip')) {
    let ip = window.prompt(
      "Please enter the IP Address of the YouTube Music Desktop Player instance",
      "localhost"
    );

    if (ip === null) { 
      handleError({ 'code': 'NO_IP' });
      return;
    }

    localStorage.setItem('ip', ip);
  }

  fetch(`${getPrefix(false)}/metadata`)
    .then(response => response.json())
    .then(data => {
      if (data.apiVersions.indexOf(api_version) === -1) {
        handleError({ 'code': 'UNSUPPORTED_API' });
      }
    })
    .catch(error => {
      console.error('Error:', error);
    });


  if (!localStorage.getItem('code') || !localStorage.getItem('token')) {
    getCode();
  }

  else {
    getInitialStateAndStart();
  }
});

function getCode() {
  fetch(`${getPrefix()}/auth/requestcode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(appData),
    timeout: 30000
  })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        handleError(data);
        return;
      }

      console.log('Successfully got Code', data.code);
      localStorage.setItem('code', data.code);

      getToken();
    })
    .catch(error => {
      console.error('Error:', error);
    });
}

function getToken() {
  showInfo(
    "Authorization Required",
    [
      "Please authorize the application to continue. YouTube Music Desktop Player will open a new Window to authorize the application.",
      "Please check it uses the code below:",
      `Code: ${localStorage.getItem('code')}`
    ]
  );

  fetch(`${getPrefix()}/auth/request`, {
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
      if (data.error) {
        handleError(data);
        return;
      }

      console.log('Successfully got Token');
      localStorage.setItem('token', data.token);
      getInitialStateAndStart();
    })
    .catch(error => {
      console.error('Error:', error);
    })
    .finally(() => {
      infoDialog.close();
    })
}

function getInitialStateAndStart() {
  fetch(`${getPrefix()}/state`, {
    headers: {
      'Authorization': localStorage.getItem('token')
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        handleError(data);
        return;
      }
      console.log('Success:', data);

      displayState(data);
    })
    .catch(error => {
      console.error('Error:', error);
    });


  var socket = io(`ws://${getPrefix().replace('http://', '')}/realtime`, {
    auth: {
      token: localStorage.getItem('token')
    },
    transports: ['websocket']
  })
  socket.on("state-update", (stateData) => {
    displayState(stateData);
  })
}

const errorDialog = document.getElementById('error-dialog');
function handleError(data) {

  if (!data.code && data.message) {
    errorDialog.querySelector('h2').innerText = data.error;
    errorDialog.querySelector('p').innerText = data.message;
    errorDialog.showModal();
    return;
  }

  if (!data.code && !data.message) {
    errorDialog.querySelector('h2').innerText = "Unknown Error";
    errorDialog.querySelector('p').innerText = data.error;
    errorDialog.showModal();
    return;
  }

  errorDialog.querySelector('h2').innerText = "Error - " + data.code;
  switch (data.code) {
    case 'NO_IP':
      errorDialog.querySelector('p').innerText = "No IP Address was provided. Please refresh and try again.";
      break;

    case 'UNSUPPORTED_API':
      errorDialog.querySelector('p').innerText = `No supported API Version in current Application. Required Version ${api_version}. Please update YouTube Music Desktop Player.`;
      break;

    case 'UNAUTHENTICATED':
      errorDialog.querySelector('p').innerText = "You are not authenticated. Please try again.";
      localStorage.removeItem('code');
      localStorage.removeItem('token');
      break;

    case 'UNAUTHORIZED':
      errorDialog.querySelector('p').innerText = "You are not authorized to access this resource. Please try again.";
      localStorage.removeItem('code');
      localStorage.removeItem('token');
      break;

    case 'AUTHORIZATION_TIME_OUT':
      errorDialog.querySelector('p').innerText = "Authorization request timed out. Please try again.";
      break;

    case 'AUTHORIZATION_DENIED':
      errorDialog.querySelector('p').innerText = "Authorization request was denied. Please try again.";
      break;

    case 'AUTHORIZATION_TOO_MANY':
      errorDialog.querySelector('p').innerText = "Too many authorization requests. Please try removing some other connections and try again.";
      break;

    case 'AUTHORIZATION_DISABLED':
      errorDialog.querySelector('p').innerText = "New Authorizations are currently disabled. Please enable it and try again.";
      break;

    case 'AUTHORIZATION_INVALID':
      errorDialog.querySelector('p').innerText = "Authorization code is invalid. Please try again.";
      break;

    case 'YOUTUBE_MUSIC_UNVAILABLE':
      errorDialog.querySelector('p').innerText = "YouTube Music is currently unavailable. Please try again later.";
      break;

    case 'YOUTUBE_MUSIC_TIME_OUT':
      errorDialog.querySelector('p').innerText = "Request to YouTube Music timed out. Please try again.";
      break;
  }

  errorDialog.showModal()
}
errorDialog.querySelector('button').addEventListener('click', function() {
  errorDialog.close();
});

const infoDialog = document.getElementById('info-dialog');
function showInfo(title, message) {
  infoDialog.querySelector('h2').innerText = title;
  infoDialog.querySelector('p').innerText = (
    typeof message === "object"
      ? message.join('\n')
      : message
  );
  infoDialog.showModal();
}
infoDialog.querySelector('button').addEventListener('click', function() {
  infoDialog.close();
});

var lastState = null;
function displayState(stateData) {
  const {
    video,
    player
  } = stateData;

  if (!lastState || lastState.video.author !== video.author) {
    document.getElementById('artist').innerText = video.author;
  }

  if (!lastState || lastState.video.title !== video.title) {
    document.getElementById('title').innerText = video.title;
  }

  if (lastState && !lastState.player.adPlaying && player.adPlaying) {
    document.getElementById('title').innerText = 'Advertisement';
    document.getElementById('artist').innerText = 'YouTube Music';
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
    let albumArts = document.getElementsByClassName('albumart');
    for (let i = 0; i < albumArts.length; i++) {
      albumArts[i].src = thumbnail;
    }

    const totalDuration = humanReadableSeconds(video.durationSeconds);
    document.getElementsByClassName('totaltime')[0].innerText = totalDuration;
  }

  if (!lastState || lastState.video.id !== video.id ||
    lastState.player.queue.items.length !== player.queue.items.length ||
    lastState.player.queue.automixItems.length !== player.queue.automixItems.length ||
    lastState.player.queue.selectedItemIndex !== player.queue.selectedItemIndex)
  {
    // Update the queue
    const queue = document.getElementById('queue');
    const queueTemplate = document.getElementsByTagName('TEMPLATE')[0]
      .content.querySelector('.queue-item')
    queue.innerHTML = '';

    if (player.queue.items.length > 0) {
      const separator = document.createElement('div');
      separator.classList.add('queue-separator');
      separator.innerText = 'Queue';
      queue.appendChild(separator);

      player.queue.items.forEach((item, index) => {
        const queueItem = queueTemplate.cloneNode(true);
        if (item.selected) {
          queueItem.classList.add('selected');
        }

        const albumArt = queueItem.querySelector('.queue-albumart');
        albumArt.src = getThumbnail(item.thumbnails, 128);

        const title = queueItem.querySelector('.queue-item-title');
        title.innerText = item.title;

        const artist = queueItem.querySelector('.queue-item-artist');
        artist.innerText = item.author;

        const duration = queueItem.querySelector('.queue-item-duration');
        duration.innerText = item.duration;

        queueItem.setAttribute('queue-index', index);

        queue.appendChild(queueItem);
      });
    }

    // automix items
    if (player.queue.automixItems.length > 0) {
      // Append a separator
      const separator = document.createElement('div');
      separator.classList.add('queue-separator');
      separator.innerText = 'Automix';
      queue.appendChild(separator);

      player.queue.automixItems.forEach((item, index) => {
        const queueItem = queueTemplate.cloneNode(true);
        if (item.selected) {
          queueItem.classList.add('selected');
        }

        const albumArt = queueItem.querySelector('.queue-albumart');
        albumArt.src = getThumbnail(item.thumbnails, 128);

        const title = queueItem.querySelector('.queue-item-title');
        title.innerText = item.title;

        const artist = queueItem.querySelector('.queue-item-artist');
        artist.innerText = item.author;

        const duration = queueItem.querySelector('.queue-item-duration');
        duration.innerText = item.duration;

        queueItem.setAttribute('queue-index', (player.queue.items.length + index - 1));

        queue.appendChild(queueItem);
      });
    }
  }


  if (!lastState || lastState.player.trackState !== player.trackState) {
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

function getThumbnail(thumbnails, maxSize) {
  var maxHeight = 0;
  var selectedThumbnail = null;
  thumbnails.forEach(thumbnail => {
    if (thumbnail.height > maxHeight && thumbnail.height <= maxSize) {
      maxHeight = thumbnail.height;
      selectedThumbnail = thumbnail;
    }
  });

  return selectedThumbnail?.url || thumbnails[thumbnails.length - 1].url;
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

document.getElementById('tab-queue').addEventListener('click', function() {
  setTimeout(() => {
    // Scroll the #queue element so that the Selected item is in the top middle
    const queue = document.getElementById('queue');
    const selectedItem = queue.querySelector('.queue-item.selected');
  
    if (!selectedItem) { return; }
  
    const queueRect = queue.getBoundingClientRect();
    const selectedItemRect = selectedItem.getBoundingClientRect();
  

    const scrollY = selectedItemRect.top - queueRect.top - (queueRect.height / 2) + (selectedItemRect.height);

    queue.scrollTo({ top: scrollY, behavior: 'smooth' });
  }, 100)
});

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
  const percentage = e.offsetX / e.currentTarget.clientWidth;
  const duration = lastState.video.durationSeconds * percentage;

  sendCommand('seekTo', duration);
});

document.getElementById('volumeSliderBar').addEventListener('click', function(e) {
  const percentage = e.offsetX / e.currentTarget.clientWidth;
  sendCommand('setVolume', parseInt(percentage * 100));
});

// Any element clicked inside of queue which is class of queue-item
document.getElementById('queue').addEventListener('click', function(e) {
  if (!e.target.classList.contains('queue-item')) {
    return;
  }

  const index = parseInt(e.target.getAttribute('queue-index'));
  if (index === lastState.player.queue.selectedItemIndex) {
    return;
  }

  sendCommand('playQueueIndex', index);
});

function sendCommand(command, data = null) {
  const body = {
    command
  };
  if (data !== null) {
    body.data = data;
  }

  return fetch(`${getPrefix()}/command`, {
    method: 'POST',
    headers: {
      'Authorization': localStorage.getItem('token'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    // Get resposne code and check if it's 4XX and display error
    .then(response => {
      if (response.status >= 400) {
        response.json().then(data => {
          handleError(data);
          return;
        });
      }
    })
    .catch(error => {
      console.error('Error:', error);
    });
}
