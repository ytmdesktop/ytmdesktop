import { BrowserView } from "electron";
import Conf from "conf";

import IIntegration from "../integration";
import { StoreSchema } from "../../../shared/store/schema";
import { getPresetThemeById } from "../../../shared/preset-themes";
import { Unsubscribe } from "conf/dist/source/types";

export default class PresetThemes implements IIntegration {
  private ytmView: BrowserView;
  private store: Conf<StoreSchema>;
  private isEnabled = false;
  private hasInjectedOnce = false;

  private cssKeys: string[] = [];
  private storeListener: Unsubscribe | null = null;

  public provide(store: Conf<StoreSchema>, ytmView: BrowserView): void {
    let ytmViewChanged = false;
    if (ytmView !== this.ytmView) {
      ytmViewChanged = true;
    }

    this.ytmView = ytmView;
    this.store = store;

    if (ytmViewChanged) {
      this.cssKeys = [];
    }

    if ((this.isEnabled && !this.hasInjectedOnce) || (this.isEnabled && ytmViewChanged)) {
      this.enable();
    }
  }

  public enable(): void {
    this.isEnabled = true;
    if (this.ytmView === null || this.cssKeys.length > 0) return;

    this.injectTheme();

    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }
    this.storeListener = this.store.onDidChange("appearance", (oldState, newState) => {
      if (newState.presetTheme && oldState.presetTheme !== newState.presetTheme) {
        this.updateTheme();
      }
    });
  }

  public disable(): void {
    this.removeTheme();
    this.isEnabled = false;
    this.hasInjectedOnce = false;

    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  public updateTheme(): void {
    if (this.isEnabled) {
      this.removeTheme();
      this.injectTheme();
    }
  }

  private injectTheme() {
    if (!this.ytmView) return;
    this.hasInjectedOnce = true;

    const themeId: string | null = this.store.get("appearance.presetTheme");
    if (!themeId) return;

    const theme = getPresetThemeById(themeId);
    if (!theme) return;

    this.ytmView.webContents.insertCSS(theme.css).then(ref => {
      this.cssKeys.push(ref);
      this.refitYTMPopups();
    });
  }

  private removeTheme() {
    if (this.cssKeys.length === 0 || !this.ytmView) return;

    const keys = [...this.cssKeys];
    this.cssKeys = [];

    for (const key of keys) {
      this.ytmView.webContents.removeInsertedCSS(key).catch(() => {
        // key may be invalid after page reload
      });
    }
    this.refitYTMPopups();
  }

  private refitYTMPopups() {
    if (this.ytmView) {
      this.ytmView.webContents.send("ytmView:refitPopups");
    }
  }
}
