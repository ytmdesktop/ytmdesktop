// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import { WindowsEventArguments } from "~shared/types";

const requestId = process.argv[process.argv.length - 3];
const appName = process.argv[process.argv.length - 2];
const code = process.argv[process.argv.length - 1];

contextBridge.exposeInMainWorld("ytmd", {
  sendResult: (result: boolean) => ipcRenderer.send(`companionAuthorization:result:${requestId}`, result),
  getAppName: async () => appName,
  getCode: async () => code,
  minimizeWindow: () => ipcRenderer.send(`companionWindow:minimize:${requestId}`),
  maximizeWindow: () => ipcRenderer.send(`companionWindow:maximize:${requestId}`),
  restoreWindow: () => ipcRenderer.send(`companionWindow:restore:${requestId}`),
  closeWindow: () => ipcRenderer.send(`companionWindow:close:${requestId}`),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on(`companionWindow:stateChanged:${requestId}`, callback)
});
