const clientId = "495666957501071390";
const RPC = require("discord-rpc");
const startTimestamp = new Date();
var client;

var _isStarted;

function isStarted() {
  return _isStarted;
}

function _setIsStarted(value) {
  _isStarted = value;
}

function start() {
  client = new RPC.Client({ transport: "ipc" });

  client.on("ready", () => {
    _setIsStarted(true);
  });

  client.login({ clientId }).catch(() => {
    if (!isStarted()) {
      setTimeout(function() {
        // console.log('trying to connect')
        start();
      }, 10000);
    }
  });

  client.on("disconnected", () => {
    _setIsStarted(false);
    start();
  });
}

function stop() {
  client.destroy();
  _setIsStarted(false);
}

function setActivity(info) {
  if (isStarted()) {
    client
      .setActivity({
        details: info.track.title,
        state: info.track.author,
        startTimestamp,
        largeImageKey: "ytm_logo_512",
        smallImageKey: info.player.isPaused
          ? "discordrpc-pause"
          : "discordrpc-play",
        instance: false
      })
      .catch(err => {
        console.log(err);
      });
  }
}

module.exports = {
  start: start,
  isStarted: isStarted,
  stop: stop,
  setActivity: setActivity
};
