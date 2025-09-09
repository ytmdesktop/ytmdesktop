import { nativeImage } from "electron";
import log from "electron-log";
import { getControlsIconPath } from "../../util";
import playerStateStore from "../../player-state-store";
import Service from "../service";
import { StoreSchema } from "~shared/store/schema";
import ConfigStore from "../configstore";
import AppWindowManager from "../windowmanager";
import YTMViewManager from "../ytmviewmanager";
import { DependencyConstructor } from "~shared/types";
import { VideoState } from "~shared/playerstatestore/types";

export default class TaskbarManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [ConfigStore, AppWindowManager, YTMViewManager];

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public override onPreInitialized(): void {}
  public onInitialized() {
    if (this._initialized) throw new Error("TaskbarManager is already initialized!");
    this._initialized = true;

    log.info("TaskbarManager initialized");
  }
  public override onPostInitialized(): void {
    const configStore = this.getDependency(ConfigStore);

    playerStateStore.addEventListener(() => this.reconcileTaskbar());
    configStore.onDidChange("playback", state => this.reconcileTaskbar(state));

    this.reconcileTaskbar();
  }
  public override onTerminated(): void {}

  public reconcileTaskbar(state?: StoreSchema["playback"]) {
    const windowManager = this.getDependency(AppWindowManager);
    if (windowManager.hasWindow("Main")) {
      const mainWindow = windowManager.getWindow("Main");

      const playerState = playerStateStore.getState();
      const hasVideo = !!playerState.videoDetails;
      const isPlaying = playerState.trackState === VideoState.Playing;

      const taskbarFlags = [];
      if (!hasVideo) {
        taskbarFlags.push("disabled");
      }

      const ytmViewManager = this.getDependency(YTMViewManager);
      mainWindow.setThumbarButtons([
        {
          tooltip: "Previous",
          icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmViewManager.ready();
            ytmViewManager.getView().webContents.send("remoteControl:execute", "previous");
          }
        },
        {
          tooltip: "Play/Pause",
          icon: isPlaying
            ? nativeImage.createFromPath(getControlsIconPath("pause-button.png"))
            : nativeImage.createFromPath(getControlsIconPath("play-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmViewManager.ready();
            ytmViewManager.getView().webContents.send("remoteControl:execute", "playPause");
          }
        },
        {
          tooltip: "Next",
          icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
          flags: taskbarFlags,
          async click() {
            await ytmViewManager.ready();
            ytmViewManager.getView().webContents.send("remoteControl:execute", "next");
          }
        }
      ]);

      let progressInTaskbar = false;
      if (!state) {
        const configStore = this.getDependency(ConfigStore);
        progressInTaskbar = configStore.get("playback.progressInTaskbar");
      } else {
        progressInTaskbar = state.progressInTaskbar;
      }

      if (progressInTaskbar) {
        mainWindow.setProgressBar(hasVideo ? playerState.videoProgress / playerState.videoDetails.durationSeconds : -1, {
          mode: isPlaying ? "normal" : "paused"
        });
      } else {
        mainWindow.setProgressBar(-1);
      }
    }
  }
}
