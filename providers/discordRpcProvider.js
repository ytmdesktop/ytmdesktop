const clientId = "495666957501071390";
const RPC = require("discord-rpc");
const startTimestamp = new Date();
var client;
var initialized;

function start() {
  client = new RPC.Client({ transport: "ipc" });

  client.on("ready", () => {
    initialized = true;
  });

  client.login({ clientId }).catch(console.error);
}

function stop() {
  client.destroy();
  initialized = false;
}

function setActivity(info) {
  if (initialized) {
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
  stop: stop,
  setActivity: setActivity
};
