import { BrowserView } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import Conf from "conf";
import log from "electron-log";

import IIntegration from "../integration";
import { StoreSchema } from "../../shared/store/schema";

export default class AdBlockerIntegration implements IIntegration {
    private ytmView: BrowserView | null = null;
    private store: Conf<StoreSchema> | null = null;
    private blocker: ElectronBlocker | null = null;

    public provide(store: Conf<StoreSchema>, ytmView: BrowserView): void {
        this.store = store;
        this.ytmView = ytmView;

        if (this.store.get("integrations.adBlockerEnabled")) {
            this.enable();
        }
    }

    public async enable(): Promise<void> {
        if (!this.ytmView) return;

        try {
            if (!this.blocker) {
                log.info("AdBlocker: Initializing blocker...");
                this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
            }

            if (this.blocker) {
                this.blocker.enableBlockingInSession(this.ytmView.webContents.session);
                log.info("AdBlocker: Enabled");
            }
        } catch (error) {
            log.error("AdBlocker: Failed to enable", error);
        }
    }

    public disable(): void {
        if (this.blocker && this.ytmView) {
            this.blocker.disableBlockingInSession(this.ytmView.webContents.session);
            log.info("AdBlocker: Disabled");
        }
    }

    public getYTMScripts(): { name: string; script: string }[] {
        return [];
    }
}
