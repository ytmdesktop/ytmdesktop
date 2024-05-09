import playerStateStore, { PlayerState } from "../../player-state-store";
import IIntegration from "../integration";
import { BrowserView } from "electron";

export default class AutoSkipAd implements IIntegration {
  private isEnabled = false;
  private ytmView: BrowserView;
  private playerStateFunction: (state: PlayerState) => void;

  private updateVideoDetails(state: PlayerState): void {
    if (state.adPlaying) {
      this.ytmView.webContents
        .executeJavaScript(`document.querySelector(".ytp-ad-preview-slot").style.display`)
        .then((display: string) => {
          if (display === "none") {
            // The "skip btn" is visible, so click it
            this.ytmView.webContents.executeJavaScript('document.querySelector(".ytp-ad-skip-button-modern").click()');
          }
        })
        .catch(error => {
          console.error("Error executing JavaScript:", error);
        });
    }
  }

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;
  }

  public enable(): void {
    if (!this.isEnabled) {
      this.playerStateFunction = (state: PlayerState) => this.updateVideoDetails(state);
      playerStateStore.addEventListener(this.playerStateFunction);
      this.isEnabled = true;
    }
  }
  public disable(): void {
    if (this.isEnabled) {
      playerStateStore.removeEventListener(this.playerStateFunction);
      this.isEnabled = false;
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
