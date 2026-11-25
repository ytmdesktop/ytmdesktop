import { ipcRenderer } from "electron";
import {
  LISTEN_TOGETHER_IPC,
  type ListenTogetherActionResult,
  type ListenTogetherCommand,
  type ListenTogetherUIState,
} from "~shared/listentogether/ipc";

export function createListenTogetherBridge(options?: {
  dispatch?: boolean;
  togglePanel?: boolean;
  closePanel?: boolean;
}) {
  return {
    getState: async (): Promise<ListenTogetherUIState> =>
      await ipcRenderer.invoke(LISTEN_TOGETHER_IPC.getState),
    onStateChanged: (
      callback: (state: ListenTogetherUIState) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: ListenTogetherUIState,
      ) => {
        callback(state);
      };
      ipcRenderer.on(LISTEN_TOGETHER_IPC.stateChanged, listener);
      return () => {
        ipcRenderer.off(LISTEN_TOGETHER_IPC.stateChanged, listener);
      };
    },
    ...(options?.dispatch
      ? {
          dispatch: async (
            command: ListenTogetherCommand,
          ): Promise<ListenTogetherActionResult> =>
            await ipcRenderer.invoke(LISTEN_TOGETHER_IPC.action, command),
        }
      : {}),
    ...(options?.togglePanel
      ? {
          togglePanel: (): void => {
            ipcRenderer.send(LISTEN_TOGETHER_IPC.togglePanel);
          },
        }
      : {}),
    ...(options?.closePanel
      ? {
          closePanel: (): void => {
            ipcRenderer.send(LISTEN_TOGETHER_IPC.closePanel);
          },
        }
      : {}),
  };
}
