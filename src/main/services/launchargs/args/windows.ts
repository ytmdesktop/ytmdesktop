import log from "electron-log";
import type {
  LaunchArgDictionary,
  LaunchArgHandler,
  UpdaterDialogState,
} from "../types";

const VALID_UPDATER_STATES: ReadonlySet<string> = new Set([
  "checking",
  "available",
  "not-available",
  "downloaded",
  "error",
]);

function parseUpdaterState(value?: string): UpdaterDialogState | undefined {
  if (!value) return undefined;

  const normalized = value.toLowerCase();
  if (VALID_UPDATER_STATES.has(normalized)) {
    return normalized as UpdaterDialogState;
  }

  log.warn(`Invalid updater dialog state '${value}', defaulting to 'checking'`);
  return "checking";
}

function windowAction(handler: LaunchArgHandler) {
  return { ready: handler, secondInstance: handler };
}

export const windowArgs: LaunchArgDictionary = {
  "update-dialog": {
    phases: {
      preInit: (ctx) => {
        ctx.state.skipUpdateCheck = true;
      },
      ready: (ctx) => {
        ctx.windows?.openUpdaterDialog(parseUpdaterState(ctx.value));
      },
      secondInstance: (ctx) => {
        ctx.windows?.openUpdaterDialog(parseUpdaterState(ctx.value));
      },
    },
  },
  settings: {
    phases: windowAction((ctx) => ctx.windows?.openSettings()),
  },
  changelog: {
    phases: windowAction((ctx) => ctx.windows?.openChangelog()),
  },
  miniplayer: {
    phases: windowAction((ctx) => ctx.windows?.openMiniplayer()),
  },
  "authorize-companion": {
    phases: windowAction((ctx) => ctx.windows?.openAuthorizeCompanion()),
  },
};
