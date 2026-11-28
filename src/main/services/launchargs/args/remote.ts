import ProtectedAPIManager from "../../protectedapimanager";
import AppWindowManager from "../../windowmanager";
import type { LaunchArgDefinition, LaunchArgDictionary } from "../types";

function remoteCommandArg(command: string): LaunchArgDefinition {
  return {
    phases: {
      secondInstance: (ctx) => {
        const api = ctx
          .getService(ProtectedAPIManager)
          .createOrGetAPI("RemoteControl");
        api.postMessage("execute", command);
      },
    },
  };
}

export const remoteArgs: LaunchArgDictionary = {
  "play-pause": remoteCommandArg("playPause"),
  next: remoteCommandArg("next"),
  previous: remoteCommandArg("previous"),
  show: {
    phases: {
      secondInstance: (ctx) => {
        ctx.getService(AppWindowManager).focusMainOrCloseMiniplayer();
      },
    },
  },
  hide: {
    phases: {
      secondInstance: (ctx) => {
        ctx.getService(AppWindowManager).hideMainWindows();
      },
    },
  },
};
