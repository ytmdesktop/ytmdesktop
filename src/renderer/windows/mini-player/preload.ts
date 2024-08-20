import { contextBridge, ipcRenderer } from "electron";
import { WindowsEventArguments } from "~shared/types";

contextBridge.exposeInMainWorld("ytmd", {
  minimizeWindow: () => ipcRenderer.send(`miniplayer:minimize`),
  maximizeWindow: () => ipcRenderer.send(`miniplayer:maximize`),
  restoreWindow: () => ipcRenderer.send(`miniplayer:restore`),
  closeWindow: () => ipcRenderer.send(`miniplayer:close`),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) => ipcRenderer.on(`miniplayer:stateChanged`, callback)
});
