import fs from "fs";

import Integration from "../integration";
import { Unsubscribe } from "conf/dist/source/types";
import configStore from "../../config-store";
import ytmviewmanager from "../../ytmviewmanager";

export default class CustomCSS extends Integration {
  public override name = "CustomCSS";
  public override storeEnableProperty: Integration["storeEnableProperty"] = "appearance.customCSSEnabled";
  private injected = false;

  private customCSSKey: string | null = null;
  private storeListener: Unsubscribe | null = null;

  private currentWatcher: fs.FSWatcher | null = null;

  private ytmViewRecreatedListener = () => {
    this.injected = false;
    this.updateCSS();
  };

  public onEnabled(): void {
    ytmviewmanager.on("view-recreated", this.ytmViewRecreatedListener);
    this.storeListener = configStore.onDidChange("appearance", (newState, oldState) => {
      if (newState.customCSSEnabled && newState.customCSSPath != oldState.customCSSPath) {
        this.updateCSS();
      }
    });

    this.injectCSS();
  }

  public onDisabled(): void {
    ytmviewmanager.off("view-recreated", this.ytmViewRecreatedListener);
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }
    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }

    this.removeCSS();
  }

  public updateCSS(): void {
    this.removeCSS();
    this.injectCSS();
  }

  private async injectCSS() {
    if (this.injected) return;

    const cssPath = configStore.get("appearance.customCSSPath");
    if (cssPath && fs.existsSync(cssPath)) {
      const content: string = fs.readFileSync(cssPath, "utf8");

      await ytmviewmanager.ready();
      this.customCSSKey = await ytmviewmanager.getView().webContents.insertCSS(content);
      this.injected = true;

      this.watchCSSFile(cssPath);
    }
  }

  private async removeCSS() {
    if (this.customCSSKey === null && !this.injected) return;

    await ytmviewmanager.ready();
    await ytmviewmanager.getView().webContents.removeInsertedCSS(this.customCSSKey);

    this.customCSSKey = null;
    this.injected = false;
  }

  private async watchCSSFile(newFile?: string) {
    // Reset the file listener if it exists
    if (this.currentWatcher) {
      this.currentWatcher.close();
      this.currentWatcher = null;
    }

    if (newFile === null) return;

    // Watch for changes to the custom CSS file
    // and update the CSS when it changes
    this.currentWatcher = fs.watch(newFile, {}, (type, filename) => {
      if (type === "change") {
        this.updateCSS();
      } else if (type === "rename") {
        if (filename) {
          configStore.set("appearance.customCSSPath", null);
          this.removeCSS();
          this.currentWatcher.close();
        }
      }
    });
  }
}
