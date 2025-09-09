// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import { WindowsEventArguments } from "~shared/types";

contextBridge.exposeInMainWorld("ytmd", {
  minimizeWindow: () => ipcRenderer.send("windowControls:minimize"),
  maximizeWindow: () => ipcRenderer.send("windowControls:maximize"),
  restoreWindow: () => ipcRenderer.send("windowControls:restore"),
  closeWindow: () => ipcRenderer.send("windowControls:close"),
  setAlwaysOnTopWindow: (alwaysOnTop: boolean) => ipcRenderer.send("windowControls:setAlwaysOnTop", alwaysOnTop),
  handleWindowEvents: (callback: (args: WindowsEventArguments) => void) =>
    ipcRenderer.on("windowControls:stateChanged", (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => {
      callback(args);
    }),
  requestWindowState: () => ipcRenderer.send("windowControls:requestState"),

  playerStore: {
    getState: async () => {
      return await ipcRenderer.invoke("playerStateStore:getState");
    },
    handleStateChanged: (callback: (state: unknown) => void) =>
      ipcRenderer.on("playerStateStore:stateChanged", (event: Electron.IpcRendererEvent, state: unknown) => {
        callback(state);
      })
  },
  executeCommandInYTMView: (command: string, ...args: unknown[]) => {
    ipcRenderer.send("remoteControl:execute", command, ...args);
  }
});
