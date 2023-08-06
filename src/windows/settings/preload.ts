// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import Store from "../../shared/store/renderer";
import { StoreSchema } from "../../shared/store/schema";
import { WindowsEventArguments } from "../../shared/types";

const store = new Store<StoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  store: {
    set: (key: string, value: unknown) => store.set(key, value),
    get: async (key: keyof StoreSchema) => await store.get(key),
    onDidAnyChange: (callback: (newState: StoreSchema, oldState: StoreSchema) => void) => store.onDidAnyChange(callback)
  },
  safeStorage: {
    decryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:decryptString", value),
    encryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:encryptString", value)
  },
  restartApplication: () => ipcRenderer.send("settingsWindow:restartapplication"),
  restartApplicationForUpdate: () => ipcRenderer.send("settingsWindow:restartApplicationForUpdate"),
  minimizeWindow: () => ipcRenderer.send("settingsWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("settingsWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("settingsWindow:restore"),
  closeWindow: () => ipcRenderer.send("settingsWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on("settingsWindow:stateChanged", callback),
  getAppVersion: async (): Promise<string> => await ipcRenderer.invoke("app:getVersion"),
  checkForUpdates: () => ipcRenderer.send("app:checkForUpdates"),
  handleCheckingForUpdate: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:checkingForUpdate", callback),
  handleUpdateAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateAvailable", callback),
  handleUpdateNotAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateNotAvailable", callback),
  handleUpdateDownloaded: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateDownloaded", callback),
  isAppUpdateAvailable: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateAvailable"),
  isAppUpdateDownloaded: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateDownloaded")
});
