import { nativeImage } from "electron";
import configStore from "./config-store";
import log from "electron-log";
import ytmviewmanager from "./ytmviewmanager";
import Manager from "./manager";
import windowmanager from "./windowmanager";
import { getControlsIconPath } from "./util";
import playerStateStore, { VideoState } from "./player-state-store";

class TaskbarManager implements Manager {
  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public initialize() {
    if (this._initialized) throw new Error("TaskbarManager is already initialized!");
    this._initialized = true;

    this.reconcileTaskbar();
    playerStateStore.addEventListener(() => this.reconcileTaskbar());
    configStore.onDidChange("playback", () => this.reconcileTaskbar());

    log.info("TaskbarManager initialized");
  }

  public reconcileTaskbar() {
    if (windowmanager.hasWindow("Main")) {
      const mainWindow = windowmanager.getWindow("Main");

      const playerState = playerStateStore.getState();
      const hasVideo = !!playerState.videoDetails;
      const isPlaying = playerState.trackState === VideoState.Playing;

      const taskbarFlags = [];
      if (!hasVideo) {
        taskbarFlags.push("disabled");
      }

      mainWindow.setThumbarButtons([
        {
          tooltip: "Previous",
          icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmviewmanager.ready();
            ytmviewmanager.getView().webContents.send("remoteControl:execute", "previous");
          }
        },
        {
          tooltip: "Play/Pause",
          icon: isPlaying
            ? nativeImage.createFromPath(getControlsIconPath("pause-button.png"))
            : nativeImage.createFromPath(getControlsIconPath("play-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmviewmanager.ready();
            ytmviewmanager.getView().webContents.send("remoteControl:execute", "playPause");
          }
        },
        {
          tooltip: "Next",
          icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmviewmanager.ready();
            ytmviewmanager.getView().webContents.send("remoteControl:execute", "next");
          }
        }
      ]);

      if (configStore.get("playback.progressInTaskbar")) {
        mainWindow.setProgressBar(hasVideo ? playerState.videoProgress / playerState.videoDetails.durationSeconds : -1, {
          mode: isPlaying ? "normal" : "paused"
        });
      } else {
        mainWindow.setProgressBar(-1);
      }
    }
  }
}

export default new TaskbarManager();
