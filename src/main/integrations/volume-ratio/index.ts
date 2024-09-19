import enableScript from "./script/enable.script";
import disableScript from "./script/disable.script";
import forceUpdateVolume from "./script/forceupdatevolume.script";
import Integration from "../integration";
import ytmviewmanager from "../../ytmviewmanager";

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

  public async onEnabled() {
    ytmviewmanager.on("view-recreated", this.ytmViewRecreatedListener);

    if (!this.injected) {
      await ytmviewmanager.ready();
      this.executeYTMScript(enableScript);
      this.forceUpdateVolume();
      this.injected = true;
    }
  }

  public async onDisabled() {
    ytmviewmanager.off("view-recreated", this.ytmViewRecreatedListener);

    if (this.injected) {
      await ytmviewmanager.ready();
      this.executeYTMScript(disableScript);
      this.forceUpdateVolume();
      this.injected = false;
    }
  }

  private forceUpdateVolume(): void {
    this.executeYTMScript(forceUpdateVolume);
  }
}
