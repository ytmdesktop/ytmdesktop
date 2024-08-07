import playerStateStore, { PlayerState, VideoDetails } from "../../player-state-store";
import IIntegration from "../integration";
import { StoreSchema } from "~shared/store/schema";
import Conf from "conf";

export default class SlackStatus implements IIntegration {
  private store: Conf<StoreSchema>;
  private enabled = false;
  private stateCallback: (event: PlayerState) => void = null;
  private currentVideoId: string = "";
  private statusTimeoutId: NodeJS.Timeout;
  private slackUserToken: string = "";

  private async playerStateChanged(state: PlayerState) {
    const { secondsTillClearStatus } = await this.store.get("slack");
    if (state.trackState === 1 && state.videoDetails) {
      if (!state.adPlaying) {
        if (this.statusTimeoutId) clearTimeout(this.statusTimeoutId);
        if (this.currentVideoId === state.videoDetails.id) {
          this.statusTimeoutId = setTimeout(() => {
            this.currentVideoId = "";
            this.updateSlackStatus(true, state.videoDetails);
          }, secondsTillClearStatus * 1000);
        } else {
          this.currentVideoId = state.videoDetails.id;
          this.updateSlackStatus(false, state.videoDetails);
        }
      }
    }
  }
  private updateSlackStatus(clear: boolean, data: VideoDetails) {
    const message = `Listening To: ${data.title} | ${data.author}`;
    let postData: { status_text: string; status_emoji: string; status_expiration: number } = {
      status_text: "",
      status_emoji: "",
      status_expiration: 0
    };
    if (!clear) {
      const currentUnixTimestamp = Math.floor(Date.now() / 1000);
      // Add 15 minutes (15 * 60 seconds)
      const newUnixTimestamp = currentUnixTimestamp + 15 * 60;
      postData = {
        status_text: message,
        status_emoji: ":notes:",
        status_expiration: newUnixTimestamp
      };
    }
    if (!this.slackUserToken) return;
    fetch("https://slack.com/api/users.profile.set", {
      headers: {
        "Authorization": `Bearer ${this.slackUserToken}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      body: JSON.stringify({
        profile: postData
      })
    });
  }
  public provide(store: Conf<StoreSchema>): void {
    this.store = store;
  }
  public async enable(): Promise<void> {
    this.enabled = true;
    const { slackUserToken } = await this.store.get("slack");
    this.slackUserToken = slackUserToken;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };
    playerStateStore.addEventListener(this.stateCallback);
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
