import playerStateStore, { PlayerState, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import { StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import { safeStorage } from "electron";
import log from "electron-log";
import { SlackPostData } from "../../@types/slack";

export default class SlackStatus implements IIntegration {
  private store: Conf<StoreSchema>;
  private enabled = false;
  private stateCallback: (event: PlayerState) => void = null;
  private currentVideoId: string = "";
  private statusTimeoutId: NodeJS.Timeout;
  private slackUserToken: string = "";

  private async playerStateChanged(state: PlayerState) {
    if (!this.enabled || state.trackState !== VideoState.Playing || !state.videoDetails || state.adPlaying) return;
    const { secondsTillClearStatus } = this.store.get("slack");
    if (this.statusTimeoutId) clearTimeout(this.statusTimeoutId);
    if (this.currentVideoId === state.videoDetails.id) {
      this.statusTimeoutId = setTimeout(() => {
        this.currentVideoId = "";
        this.updateSlackStatus(true, state.videoDetails);
      }, secondsTillClearStatus * 1000);
      return;
    }
    this.currentVideoId = state.videoDetails.id;
    this.updateSlackStatus(false, state.videoDetails);
  }
  private updateSlackStatus(clear: boolean, data: VideoDetails) {
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    const slackPostData: SlackPostData = {
      status_text: clear ? "" : `Listening To: ${data.title} | ${data.author}`,
      status_emoji: clear ? "" : ":notes:",
      status_expiration: clear ? 0 : currentUnixTimestamp + 15 * 60
    };
    fetch("https://slack.com/api/users.profile.set", {
      headers: {
        "Authorization": `Bearer ${this.slackUserToken}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      body: JSON.stringify({
        profile: slackPostData
      })
    });
  }
  public provide(store: Conf<StoreSchema>): void {
    this.store = store;
  }
  public async enable(): Promise<void> {
    const { slackUserToken } = this.store.get("slack");
    try {
      this.slackUserToken = safeStorage.decryptString(Buffer.from(slackUserToken, "hex"));
      this.enabled = true;
      this.stateCallback = event => {
        this.playerStateChanged(event);
      };
      playerStateStore.addEventListener(this.stateCallback);
    } catch (e) {
      log.error(e);
    }
  }
  public disable(): void {
    this.enabled = false;
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }
  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
