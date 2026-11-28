import { developerArgs } from "./args/developer";
import { remoteArgs } from "./args/remote";
import { startupArgs } from "./args/startup";
import { windowArgs } from "./args/windows";
import type { LaunchArgDictionary } from "./types";

export const launchArgRegistry: LaunchArgDictionary = {
  ...windowArgs,
  ...startupArgs,
  ...developerArgs,
  ...remoteArgs,
};
