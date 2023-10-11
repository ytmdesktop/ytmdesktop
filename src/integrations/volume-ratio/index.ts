import { BrowserView } from "electron";
import IIntegration from "../integration";

import enableScript from "./script/enable.script";

export default class VolumeRatio implements IIntegration {
  // This integration is based upon the following GreasyFork script:
  // https://greasyfork.org/en/scripts/397686-youtube-music-fix-volume-ratio
  // Made by: Marco Pfeiffer <git@marco.zone>

  private ytmView: BrowserView;
  private hasInjected = false;
  private isEnabled = false;

  public provide(ytmView: BrowserView): void {
    this.ytmView = ytmView;

    if (this.isEnabled && !this.hasInjected) {
      this.enable();
    }
  }

  public enable(): void {
    this.isEnabled = true;
    if ((this.isEnabled && this.hasInjected) || this.ytmView === null) return;

    this.ytmView.webContents.executeJavaScript(enableScript).catch(err => {
      console.log(err);
    });

    this.forceUpdateVolume();

    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.ytmView.webContents
      .executeJavaScript(
        `
      {
        if (typeof window.HTMLMediaElement_volume !== 'undefined' &&
            typeof window.HTMLMediaElement_volume.get !== 'undefined' &&
            typeof window.HTMLMediaElement_volume.set !== 'undefined')
        {
          console.log("Removing VolumeRatio script")
  
          // Restore the original volume property
          Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
            get: window.HTMLMediaElement_volume.get,
            set: window.HTMLMediaElement_volume.set
          });
        }
      }

      // Electron is not happy with whatever is returned, so we just give it an empty string.
      '';
    `
      )
      .catch(err => {
        err;
      });

    this.forceUpdateVolume();
    this.hasInjected = false;
  }

  private forceUpdateVolume(): void {
    this.ytmView.webContents
      .executeJavaScript(
        `
      {
        let volume = document.querySelector("ytmusic-player-bar").playerApi.getVolume();
        document.querySelector("ytmusic-player-bar").playerApi.setVolume(volume);
        document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: volume });
        
        volume;
      }
    `
      )
      .catch(err => {
        err;
      });
  }
}
