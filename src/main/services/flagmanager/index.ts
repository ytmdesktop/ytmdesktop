// This service is deliberately not used right now

import fs from "node:fs/promises";
import path from "node:path";
import Service, { EventEmitterService } from "../service";
import { app, ipcMain } from "electron";
import { Context, Unleash } from "unleash-client";
import AppWindowManager from "../windowmanager";
import { DependencyConstructor } from "~shared/types";
import log from "electron-log";

declare const YTMD_UNLEASH_SERVER: string;
declare const YTMD_UNLEASH_INSTANCE_ID: string;

export type FlagManagerEventMap = {
  ready: [];
  synchronized: [];
  changed: [{ name: string; enabled: boolean }[]];
};

export default class FlagManager extends EventEmitterService<FlagManagerEventMap> {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [AppWindowManager];

  private context: Context = {
    sessionId: Math.floor(Math.random() * 1_000_000_000).toString()
  };
  private unleash: Unleash;

  public override onPreInitialized(): void {}
  public override async onInitialized(): Promise<void> {
    if (YTMD_UNLEASH_SERVER) {
      const unleashSessionIdPath = path.join(app.getPath("userData"), ".unleash-sid");

      try {
        await fs.access(unleashSessionIdPath, fs.constants.F_OK);

        try {
          this.context.sessionId = await fs.readFile(unleashSessionIdPath, { encoding: "utf8" });
        } catch {
          /* Do nothing and just default to random every time if we couldn't properly read the file */
        }
      } catch {
        await fs.writeFile(unleashSessionIdPath, this.context.sessionId);
      }

      this.unleash = new Unleash({
        url: YTMD_UNLEASH_SERVER,
        appName: app.isPackaged ? "production" : "development",
        instanceId: YTMD_UNLEASH_INSTANCE_ID,
        backupPath: app.getPath("userData")
      });

      this.unleash.on("ready", () => {
        log.info("flags: synchronized");
        this.emit("ready");
      });
      this.unleash.on("synchronized", () => {
        log.info("flags: synchronized");
        this.emit("synchronized");
      });
      this.unleash.on("changed", () => {
        const windowManager = this.getDependency(AppWindowManager);

        for (const window of windowManager.getWindows()) {
          window.ipcBroadcast("flags:changed", this.getFlags());
        }

        this.emit("changed", this.getFlags());
      });
    }

    ipcMain.handle("flags:getFlag", (event, flag: string) => {
      return this.getFlag(flag);
    });
    ipcMain.handle("flags:getFlags", () => {
      return this.getFlags();
    });
  }
  public override onPostInitialized(): void {}
  public override onTerminated(): void {}

  public get isSynchronized() {
    return this.unleash?.isSynchronized() ?? false;
  }

  /**
   * Gets the flag enable state
   * @param flag
   * @returns
   */
  public getFlag(name: string): boolean {
    return this.unleash?.getFeatureToggleDefinition(name)?.enabled ?? false;
  }

  /**
   * Gets the flags and their enable state
   * @returns
   */
  public getFlags(): { name: string; enabled: boolean }[] {
    return this.unleash?.getFeatureToggleDefinitions()?.map(flag => ({ name: flag.name, enabled: flag.enabled }));
  }
}
