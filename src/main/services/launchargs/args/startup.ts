import { app } from "electron";
import log from "electron-log";
import type { LaunchArgDictionary } from "../types";

export const startupArgs: LaunchArgDictionary = {
  "start-minimized": {
    phases: {
      preInit: (ctx) => {
        ctx.state.startMinimized = true;
        log.info("Launch arg: starting minimized");
      },
    },
  },
  "skip-update": {
    phases: {
      preInit: (ctx) => {
        ctx.state.skipUpdateCheck = true;
        log.info("Launch arg: skipping startup update check");
      },
    },
  },
  "disable-hardware-acceleration": {
    phases: {
      preInit: (ctx) => {
        ctx.state.gpuDisabledByFlag = true;
        app.disableHardwareAcceleration();
        log.info("Launch arg: hardware acceleration disabled");
      },
    },
  },
  "safe-mode": {
    phases: {
      preInit: (ctx) => {
        ctx.state.safeModeEnabled = true;
        log.info("Launch arg: safe mode enabled (integrations disabled)");
      },
    },
  },
};
