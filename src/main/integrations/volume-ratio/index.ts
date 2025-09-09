import enableScript from "./script/enable.script?raw";
import disableScript from "./script/disable.script?raw";
import forceUpdateVolume from "./script/forceupdatevolume.script?raw";
import Integration from "../integration";
import YTMViewManager from "../../services/ytmviewmanager";

export default class VolumeRatio extends Integration {
  public override name = "VolumeRatio";
  public override storeEnableProperty: Integration["storeEnableProperty"] = "playback.ratioVolume";

  // This integration is based upon the following GreasyFork script:
  // https://greasyfork.org/en/scripts/397686-youtube-music-fix-volume-ratio
  // Made by: Marco Pfeiffer <git@marco.zone>

  private injected = false;
  private ytmViewRecreatedListener = () => {
    this.onEnabled();
  };

  public onSetup() {}

  public async onEnabled() {
    const ytmViewManager = this.getService(YTMViewManager);

    ytmViewManager.on("view-recreated", this.ytmViewRecreatedListener);

    if (!this.injected) {
      await ytmViewManager.ready();
      this.executeYTMScript(enableScript);
      this.forceUpdateVolume();
      this.injected = true;
    }
  }

  public async onDisabled() {
    const ytmViewManager = this.getService(YTMViewManager);

    ytmViewManager.off("view-recreated", this.ytmViewRecreatedListener);

    if (this.injected) {
      await ytmViewManager.ready();
      this.executeYTMScript(disableScript);
      this.forceUpdateVolume();
      this.injected = false;
    }
  }

  private forceUpdateVolume(): void {
    this.executeYTMScript(forceUpdateVolume);
  }
}
