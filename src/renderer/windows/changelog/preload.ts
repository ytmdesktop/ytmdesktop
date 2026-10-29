// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import Store from "../../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";
import { WindowsEventArguments } from "~shared/types";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  minimizeWindow: () => ipcRenderer.send("windowControls:minimize"),
  maximizeWindow: () => ipcRenderer.send("windowControls:maximize"),
  restoreWindow: () => ipcRenderer.send("windowControls:restore"),
  closeWindow: () => ipcRenderer.send("windowControls:close"),
  handleWindowEvents: (callback: (args: WindowsEventArguments) => void) =>
    ipcRenderer.on("windowControls:stateChanged", (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => {
      callback(args);
    }),
  requestWindowState: () => ipcRenderer.send("windowControls:requestState"),

  store: {
    set: (key: string, value: unknown) => store.set(key, value),
    get: async (key: keyof StoreSchema) => await store.get(key),
    reset: (key: keyof StoreSchema) => store.reset(key),
    onDidAnyChange: (callback: (newState: StoreSchema, oldState: StoreSchema) => void) => store.onDidAnyChange(callback)
  },

  getAppVersion: async (): Promise<string> => await ipcRenderer.invoke("app:getVersion"),
  getReleaseMetadata: async (): Promise<string> => await ipcRenderer.invoke("changelog:getReleaseMetadata")
});
