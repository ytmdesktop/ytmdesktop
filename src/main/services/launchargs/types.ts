import type { Constructor } from "~shared/types";
import type Service from "../service";

export type LaunchArgPhase = "preInit" | "ready" | "secondInstance";

export type UpdaterDialogState =
  | "checking"
  | "available"
  | "not-available"
  | "downloaded"
  | "error";

export interface LaunchWindowActions {
  openUpdaterDialog: (state?: UpdaterDialogState) => void;
  openSettings: () => void;
  openChangelog: () => void;
  openMiniplayer: () => void;
  openAuthorizeCompanion: () => void;
}

export interface LaunchArgState {
  skipUpdateCheck: boolean;
  startMinimized: boolean;
  forceDevTools: boolean;
  gpuDisabledByFlag: boolean;
  safeModeEnabled: boolean;
}

export interface LaunchArgContext {
  getService: <T extends Service>(service: Constructor<T>) => T;
  state: LaunchArgState;
  windows?: LaunchWindowActions;
  value?: string;
}

export type LaunchArgHandler = (ctx: LaunchArgContext) => void;

export interface LaunchArgDefinition {
  phases: Partial<Record<LaunchArgPhase, LaunchArgHandler>>;
}

export type LaunchArgDictionary = Record<string, LaunchArgDefinition>;
