import { BrowserView, ipcMain, ipcRenderer } from "electron";
import fs from "fs";
import ElectronStore from "electron-store";

import IIntegration from "../integration";
import { StoreSchema } from "../../shared/store/schema";
import { Unsubscribe } from "conf/dist/source/types";

export default class CustomCSS implements IIntegration {
  private ytmView: BrowserView;
  private store: ElectronStore<StoreSchema>;
  private isEnabled = false;

  private customCSSKey: string|null = null;
  private fileListener: fs.StatsListener|null = null;
  private storeListener: Unsubscribe|null = null;
  private ipcListener: () => void|null = null;

  public provide(store: ElectronStore<StoreSchema>, ytmView: BrowserView): void {
    this.ytmView = ytmView;
    this.store = store;

    if (this.isEnabled && !this.customCSSKey) {
      this.enable();
    }
  }

  public enable(): void {
    this.isEnabled = true;
    if (this.ytmView === null || this.customCSSKey) return;

    this.injectCSS();

    // Listen to updates to the custom CSS file
    this.storeListener = this.store.onDidChange('appearance', (oldState, newState) => {
      if (newState.customCSSEnabled && oldState.customCSSPath != newState.customCSSPath) {
        this.updateCSS();

        this.watchCSSFile(newState.customCSSPath, oldState.customCSSPath);
      }
    });
  }

  public disable(): void {
    this.removeCSS();
    this.isEnabled = false;

    if (this.fileListener) {
      fs.unwatchFile(this.store.get('appearance.customCSSPath'), this.fileListener);
      this.fileListener = null;
    }

    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }

    if (this.ipcListener) {
      ipcMain.removeListener('ytmView:loaded', this.ipcListener);
      this.ipcListener = null;
    }
  }

  public updateCSS(): void {
    if (this.isEnabled) {
      this.removeCSS();
      this.injectCSS();
    }
  }

  // --------------------------------------------------

  private injectCSS() {
    if (!this.ytmView) { return; }

    const cssPath: string|null = this.store.get('appearance.customCSSPath');
    if (cssPath && fs.existsSync(cssPath)) {
      const content: string = fs.readFileSync(cssPath, "utf8");

      /* To do in the future...
        Have an alternative means of checking if YTM has loaded
        as I'd rather keep away from constantly having an event for if `ytmView:loaded` is emitted
        and only needed for the initial load of the app */
      this.ipcListener = () => {
        this.ytmView.webContents.insertCSS(content).then((customCssRef) => {
          this.customCSSKey = customCssRef
        });
      }
      ipcMain.once('ytmView:loaded', this.ipcListener);

      this.ytmView.webContents.insertCSS(content).then((customCssRef) => {
        this.customCSSKey = customCssRef
      });


      this.watchCSSFile(cssPath);
    }
    else {
      console.error("Custom CSS file not found");
    }
  }

  private async removeCSS() {
    if (this.customCSSKey === null || !this.ytmView) return;

    await this.ytmView.webContents.removeInsertedCSS(this.customCSSKey);
    this.customCSSKey = null;
  }

  private async watchCSSFile(newFile: string, oldFile?: string) {
    // Reset the file listener if it exists
    if (this.fileListener && oldFile) {
      fs.unwatchFile(oldFile, this.fileListener);
      this.fileListener = null;
    }

    // Watch for changes to the custom CSS file
    // and update the CSS when it changes
    this.fileListener = (curr: fs.Stats, prev: fs.Stats) => {
      if (curr.mtimeMs != prev.mtimeMs) {
        this.updateCSS();
      }
    }
    fs.watchFile(newFile, { interval: 5000 }, this.fileListener);
  }
}
