import { session } from "electron";
import type { Session } from "electron";

export function getYtmPartitionName(isPackaged: boolean): string {
  return isPackaged ? "persist:ytmview" : "persist:ytmview-dev";
}

export function getYtmSession(isPackaged: boolean): Session {
  return session.fromPartition(getYtmPartitionName(isPackaged));
}
