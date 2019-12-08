var webContents, initialized;

var player = {
  isPaused: true,
  volumePercent: 0,
  seekbarCurrentPosition: 0,
  likeStatus: "",
  repatType: ""
};

var track = {
  author: "",
  title: "",
  cover: "",
  duration: 0,
  url: "",
  id: ""
};

function init(view) {
  webContents = view.webContents;
  initialized = true;
}

function getAllInfo() {
  return {
    player: getPlayerInfo(),
    track: getTrackInfo()
  };
}

function getPlayerInfo() {
  if (webContents !== undefined) {
    isPaused(webContents);
    getVolume(webContents);
    getSeekbarPosition(webContents);
    getLikeStatus(webContents);
    getRepeatType(webContents);
  }
  return player;
}

function getTrackInfo() {
  if (webContents !== undefined) {
    getAuthor(webContents);
    getTitle(webContents);
    getCover(webContents);
    getDuration(webContents);
    getUrl(webContents);
  }
  return track;
}

function isPaused(webContents) {
  webContents.executeJavaScript(
    `document.getElementsByTagName('video')[0].paused`,
    null,
    function(isPaused) {
      debug(`Is paused: ${isPaused}`);
      player.isPaused = isPaused;
    }
  );
}

function getTitle(webContents) {
  webContents.executeJavaScript(
    `document.getElementsByClassName('title ytmusic-player-bar')[0].innerText`,
    null,
    function(title) {
      debug(`Title is: ${title}`);
      track.title = title;
    }
  );
}

function getDuration(webContents) {
  webContents.executeJavaScript(
    `document.getElementById('progress-bar').getAttribute('aria-valuemax');`,
    null,
    function(duration) {
      debug(`Duration is: ${parseInt(duration)}`);
      track.duration = parseInt(duration);
    }
  );
}

/**
 * Get Like status
 * LIKE | DISLIKE | INDIFFERENT
 * @param {*} webContents
 */
function getLikeStatus(webContents) {
  webContents.executeJavaScript(
    `document.getElementById('like-button-renderer').getAttribute('like-status')`,
    true,
    function(likeStatus) {
      debug(`Like status is: ${likeStatus}`);
      player.likeStatus = likeStatus;
    }
  );
}

/**
 * GET CURRENT SEEK BAR POSITION
 * @param {*} webContents
 */
function getSeekbarPosition(webContents) {
  webContents.executeJavaScript(
    `document.getElementById('progress-bar').getAttribute('aria-valuenow');`,
    null,
    function(position) {
      debug(`Seekbar position is: ${parseInt(position)}`);
      player.seekbarCurrentPosition = parseInt(position);
    }
  );
}

function getVolume(webContents) {
  webContents.executeJavaScript(
    `document.getElementsByClassName('volume-slider style-scope ytmusic-player-bar')[0].getAttribute('value')`,
    true,
    function(volume) {
      debug(`Volume % is: ${parseInt(volume)}`);
      player.volumePercent = parseInt(volume);
    }
  );
}

function getAuthor(webContents) {
  webContents.executeJavaScript(
    `
                var bar = document.getElementsByClassName('subtitle ytmusic-player-bar')[0];
                var title = bar.getElementsByClassName('yt-simple-endpoint yt-formatted-string');
                if( !title.length ) { title = bar.getElementsByClassName('byline ytmusic-player-bar') }
                title[0].innerText
            `,
    null,
    function(author) {
      debug(`Author is: ${author}`);
      track.author = author;
    }
  );
}

function getCover(webContents) {
  webContents.executeJavaScript(
    `
        var a = document.getElementsByClassName('thumbnail style-scope ytmusic-player no-transition')[0];
        var b = a.getElementsByClassName('yt-img-shadow')[0];
        b.src
      `,
    null,
    function(cover) {
      debug(`Song cover is: ${cover}`);
      track.cover = cover;
    }
  );
}

function getRepeatType(webContents) {
  webContents.executeJavaScript(
    `document.getElementsByTagName("ytmusic-player-bar")[0].getAttribute("repeat-mode_")`,
    null,
    function(repeatType) {
      debug(`Repeat type is: ${repeatType}`);
      player.repatType = repeatType;
    }
  );
}

function getUrl(webContents) {
  webContents.executeJavaScript(
    `document.getElementsByClassName('ytp-title-link yt-uix-sessionlink')[0].href`,
    null,
    function(url) {
      track.url = url;

      var url = new URL(url);
      var searchParams = new URLSearchParams(url.search);

      track.id = searchParams.get("v");
    }
  );
}

function hasInitialized() {
  return initialized;
}

function debug(data) {
  // console.log(data);
}

module.exports = {
  init: init,
  getAllInfo: getAllInfo,
  getPlayerInfo: getPlayerInfo,
  getTrackInfo: getTrackInfo,
  hasInitialized: hasInitialized
};
