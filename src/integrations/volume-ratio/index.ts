import { BrowserView } from "electron";
import IIntegration from "../integration";

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

    this.ytmView.webContents.executeJavaScript(`
      {
        // manipulation exponent, higher value = lower volume
        // 3 is the value used by pulseaudio, which Barteks2x figured out this gist here: https://gist.github.com/Barteks2x/a4e189a36a10c159bb1644ffca21c02a
        // 0.05 (or 5%) is the lowest you can select in the UI which with an exponent of 3 becomes 0.000125 or 0.0125%
        const EXPONENT = 3;

        const storedOriginalVolumes = new WeakMap();
        const HTMLMediaElement_volume = {get, set} = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
            get () {
                const lowVolume = HTMLMediaElement_volume.get.call(this);
                const calculatedOriginalVolume = lowVolume ** (1 / EXPONENT);

                // The calculated value has some accuracy issues which can lead to problems for implementations that expect exact values.
                // To avoid this, I'll store the unmodified volume to return it when read here.
                // This mostly solves the issue, but the initial read has no stored value and the volume can also change though external influences.
                // To avoid ill effects, I check if the stored volume is somewhere in the same range as the calculated volume.
                const storedOriginalVolume = storedOriginalVolumes.get(this);
                const storedDeviation = Math.abs(storedOriginalVolume - calculatedOriginalVolume);

                const originalVolume = storedDeviation < 0.01 ? storedOriginalVolume : calculatedOriginalVolume;
                console.log('manipulated volume from', lowVolume.toFixed(2), 'to  ', originalVolume.toFixed(2), storedDeviation);
                return originalVolume;
            },
            set (originalVolume) {
                const lowVolume = originalVolume ** EXPONENT;
                storedOriginalVolumes.set(this, originalVolume);
                // console.log('manipulated volume to  ', lowVolume.toFixed(2), 'from', originalVolume.toFixed(2));
                HTMLMediaElement_volume.set.call(this, lowVolume);
            }
        });

        window.HTMLMediaElement_volume = HTMLMediaElement_volume;

        // Electron is not happy with returning the element, so we just give it an empty string.
        '';
      }
    `)
    .catch((err) => { console.log(err); });
    this.forceUpdateVolume();

    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.ytmView.webContents.executeJavaScript(`
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

      // Electron is not happy with returning the element, so we just give it an empty string.
      '';
    `)
    .catch((err) => { err; });

    this.forceUpdateVolume();
    this.hasInjected = false;
  }

  private forceUpdateVolume(): void {
    this.ytmView.webContents.executeJavaScript(`
      {
        let volume = document.querySelector("ytmusic-player-bar").playerApi_.getVolume();
        document.querySelector("ytmusic-player-bar").playerApi_.setVolume(volume);
        document.querySelector("ytmusic-player-bar").store.dispatch({ type: 'SET_VOLUME', payload: volume });
        
        volume;
      }
    `)
    .catch((err) => { err; });
  }
} 
