// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ytmd", {
  sendResult: (result: boolean) => ipcRenderer.send("companionAuthorization:result", result),
  getAppName: async () => await ipcRenderer.invoke("companionAuthorization:getAppName"),
  getCode: async () => await ipcRenderer.invoke("companionAuthorization:getCode"),
  minimizeWindow: () => ipcRenderer.send("companionWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("companionWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("companionWindow:restore"),
  closeWindow: () => ipcRenderer.send("companionWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => ipcRenderer.on("settingsWindow:stateChanged", callback)
});
