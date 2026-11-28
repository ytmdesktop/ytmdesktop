import { app } from "electron";
import log from "electron-log";
import AppWindowManager from "../../windowmanager";
import type { LaunchArgDictionary } from "../types";

export const developerArgs: LaunchArgDictionary = {
  devtools: {
    phases: {
      preInit: (ctx) => {
        ctx.state.forceDevTools = true;
        if (!app.isPackaged) {
          ctx.getService(AppWindowManager).autoOpenDevTools = true;
        }
        log.info("Launch arg: DevTools force-enabled");
      },
    },
  },
};