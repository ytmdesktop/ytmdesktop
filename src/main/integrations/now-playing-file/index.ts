import fs from "fs";
import Conf from "conf";
import log from "electron-log";

import playerStateStore, { PlayerState, VideoDetails } from "../../player-state-store";
import IIntegration from "../integration";
import { StoreSchema } from "~shared/store/schema";
import { Unsubscribe } from "conf/dist/source/types";

function expandFormat(format: string, details: VideoDetails): string {
  return format
    .replace(/%t/g, details.title ?? "")
    .replace(/%a/g, details.author ?? "")
    .replace(/%b/g, details.album ?? "");
}

export default class NowPlayingFile implements IIntegration {
  private store: Conf<StoreSchema>;
  private enabled = false;
  private stateCallback: (state: PlayerState) => void = null;
  private storeListener: Unsubscribe | null = null;
  private lastWrittenContent: string | null = null;

  public provide(store: Conf<StoreSchema>): void {
    this.store = store;
  }

  public enable(): void {
    this.enabled = true;

    this.stateCallback = (state: PlayerState) => {
      this.onPlayerStateChanged(state);
    };
    playerStateStore.addEventListener(this.stateCallback);

    this.storeListener = this.store.onDidChange("integrations", () => {
      this.writeCurrentState();
    });

    this.writeCurrentState();
  }

  public disable(): void {
    this.enabled = false;
    this.lastWrittenContent = null;

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
      this.stateCallback = null;
    }

    if (this.storeListener) {
      this.storeListener();
      this.storeListener = null;
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  private onPlayerStateChanged(state: PlayerState): void {
    if (!this.enabled) return;

    const filePath = this.store.get("integrations.nowPlayingFilePath") as string | null;
    const format = this.store.get("integrations.nowPlayingFileFormat") as string;
    if (!filePath) return;

    const { videoDetails } = state;
    let content: string;
    if (videoDetails) {
      content = expandFormat(format, videoDetails);
    } else {
      content = "";
    }

    if (content === this.lastWrittenContent) return;
    this.lastWrittenContent = content;

    try {
      fs.writeFileSync(filePath, content, "utf8");
    } catch (err) {
      log.error("NowPlayingFile: Failed to write file", err);
    }
  }

  private writeCurrentState(): void {
    const state = playerStateStore.getState();
    this.onPlayerStateChanged(state);
  }
}
