// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import MemoryStore from "../../store-ipc/memory-store";
import { YTMViewStatus } from "~shared/types";
import { MemoryStoreSchema } from "~shared/store/schema";

const memoryStore = new MemoryStore<MemoryStoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  memoryStore: {
    set: (key: string, value: unknown) => memoryStore.set(key, value),
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: MemoryStoreSchema, oldState: MemoryStoreSchema) => void) => memoryStore.onStateChanged(callback)
  },
  ytmViewStatusChanged: (callback: (status: YTMViewStatus) => void) =>
    ipcRenderer.on("ytmView:statusChanged", (event: Electron.IpcRendererEvent, status: YTMViewStatus) => {
      callback(status);
    }),
  appViewHiding: (callback: () => void) =>
    ipcRenderer.on("appView:hide", () => {
      callback();
    }),
  appViewShowing: (callback: () => void) =>
    ipcRenderer.on("appView:show", () => {
      callback();
    }),
  appViewHide: () => {
    ipcRenderer.send("appView:hide");
  }
});
