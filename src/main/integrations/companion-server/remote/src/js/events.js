import { $, getPrefix } from "./util";

document.addEventListener('DOMContentLoaded', function() {
  const control = $('#control');

  control.style.setProperty('--control-height', control.clientHeight + 'px');
  window.addEventListener('resize', () => {
    control.style.setProperty('--control-height', control.clientHeight + 'px');
  });
});

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

document.getElementById('control-repeat').addEventListener('click', function() {
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
  var targetElement = e.target.closest('.queue-item');

  if (targetElement && targetElement.classList.contains('queue-item')) {
    const index = parseInt(targetElement.getAttribute('queue-index'));
    if (index === lastState.player.queue.selectedItemIndex) {
      return;
    }

    sendCommand('playQueueIndex', index);
  }

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
