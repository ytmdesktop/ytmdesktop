import playerStateStore, { PlayerState, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import { StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import { PostType } from "../../@types/slack";

export default class SlackStatus implements IIntegration {
  private store: Conf<StoreSchema>;
  private enabled = false;
  private stateCallback: (event: PlayerState) => void = null;
  private currentVideoId: string = "";
  private statusTimeoutId: NodeJS.Timeout;
  private slackUserToken: string = "";

  private async playerStateChanged(state: PlayerState) {
    if (!this.enabled) return;
    const { secondsTillClearStatus } = await this.store.get("slack");
    if (state.trackState === VideoState.Playing && state.videoDetails) {
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
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    const clearPostData: PostType = {
      status_text: "",
      status_emoji: "",
      status_expiration: 0
    };
    const listeningToPostData: PostType = {
      status_text: `Listening To: ${data.title} | ${data.author}`,
      status_emoji: ":notes:",
      status_expiration: currentUnixTimestamp + 15 * 60
    };
    fetch("https://slack.com/api/users.profile.set", {
      headers: {
        "Authorization": `Bearer ${this.slackUserToken}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      body: JSON.stringify({
        profile: clear ? clearPostData : listeningToPostData
      })
    });
  }
  public provide(store: Conf<StoreSchema>): void {
    this.store = store;
  }
  public async enable(): Promise<void> {
    const { slackUserToken } = await this.store.get("slack");
    if (!slackUserToken) return;
    this.enabled = true;
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
