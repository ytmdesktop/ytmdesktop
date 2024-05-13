import { api_version, $, getPrefix, getThumbnail, humanReadableSeconds } from "./util";
import './events';
import io from 'socket.io-client';

import '../css/control.scss';

const appData = {
  appId: 'ytmd-remote-control',
  appName: 'YTMD Remote Control',
  appVersion: '0.0.1'
};

document.addEventListener('DOMContentLoaded', function() {
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

  if (!localStorage.getItem('ip')) {
    // Open the settings bottom draw
    $('#settings').dispatchEvent(new CustomEvent('click'));
  }

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

const errorDialog = $('#error-dialog');
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

const infoDialog = $('#info-dialog');
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
    $('#artist').innerText = video.author;
  }

  if (!lastState || lastState.video.title !== video.title) {
    $('#title').innerText = video.title;
  }

  if (lastState && !lastState.player.adPlaying && player.adPlaying) {
    $('#title').innerText = 'Advertisement';
    $('#artist').innerText = 'YouTube Music';
  }

  if (!lastState || lastState.video.likeStatus !== video.likeStatus) {
    // -1 = Unknown, 0 Disliked, 1 = Indifferent, 2 = Liked
    const likeIcon = $('#control-like svg use');
    const dislikeIcon = $('#control-dislike svg use');

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
    const thumbnail = getThumbnail(video.thumbnails);
    let albumArts = document.getElementsByClassName('albumart');
    for (let i = 0; i < albumArts.length; i++) {
      albumArts[i].src = thumbnail;
    }

    const totalDuration = humanReadableSeconds(video.durationSeconds);
    $('.totaltime').innerText = totalDuration;
  }

  if (!lastState || lastState.video.id !== video.id ||
    lastState.player.queue.items.length !== player.queue.items.length ||
    lastState.player.queue.automixItems.length !== player.queue.automixItems.length ||
    lastState.player.queue.selectedItemIndex !== player.queue.selectedItemIndex)
  {
    // Update the queue
    const queue = $('#queue');
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
    const playPauseIcon = $('#control-playpause div svg use');
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
    const repeatIcon = $('#control-repeat svg use');
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

  if (!lastState || lastState.player.videoProgress !== player.videoProgress && video.isLive === false) {
    // Update the progress bar
    const durationPercent = player.videoProgress / video.durationSeconds;

    $('#progressbar').style.transform = `scaleX(${durationPercent})`;
    $('#progressSliderKnob').style.left = `${durationPercent * 100}%`;

    const currentTime = humanReadableSeconds(player.videoProgress);
    $('.currenttime').innerText = currentTime;
  }
  
  if (!lastState || lastState.video.isLive !== video.isLive) {
    $('#progressSliderBar').style.display = (video.isLive ? 'none' : 'block');
    $('#progressSliderKnob').style.display = (video.isLive ? 'none' : 'block');
    $('.currenttime').style.display = (video.isLive ? 'none' : 'block');
    $('.totaltime').style.display = (video.isLive ? 'none' : 'block');
  }

  if (!lastState || lastState.player.volume !== player.volume) {
    const volumePercent = player.volume;
    $('#volumebar').style.transform = `scaleX(${volumePercent / 100})`;
    $('#volumeSliderKnob').style.left = `${volumePercent}%`;
  }

  lastState = stateData;
}
