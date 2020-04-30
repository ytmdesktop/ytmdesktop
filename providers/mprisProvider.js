const { ipcMain } = require("electron");
const mpris = require("mpris-service");

class Mpris {
  constructor() {
    this.player = undefined;
  }

  start() {
    this.player = new mpris({
      name: "youtubemusic",
      identity: "Youtube Music",
      supportedUriSchemes: ["file"],
      supportedMimeTypes: ["audio/mpeg", "application/ogg"],
      supportedInterfaces: ["player"]
    });

    this.setInitialEvents();
  }

  setActivity(info) {
    this.player.metadata = {
      "mpris:trackid": this.player.objectPath("track/0"),
      "mpris:length": info.track.duration * 1000 * 1000, // In microseconds
      "mpris:artUrl": info.track.cover,
      "xesam:title": info.track.title,
      "xesam:album": info.track.album,
      "xesam:artist": [info.track.author]
    };

    this.player.playbackStatus = info.player.isPaused
      ? mpris.PLAYBACK_STATUS_PAUSED
      : mpris.PLAYBACK_STATUS_PLAYING;
  }

  setInitialEvents() {
    const events = {
      quit: () => process.exit(0),
      previous: "media-previous-track",
      next: "media-next-track",
      pause: "media-play-pause",
      play: "media-play-pause"
    };

    for (let [event, action] of Object.entries(events)) {
      if (typeof action === "string") {
        this.player.on(event, () => {
          ipcMain.emit(action, true);
        });
      } else if (typeof action === "function") {
        this.player.on(event, action);
      }
    }
  }
}

module.exports = new Mpris();
