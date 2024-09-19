// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ytmd", {
  autoUpdater: {
    onChecking: (callback: () => void) => {
      ipcRenderer.on("autoUpdater:checking", () => {
        callback();
      });
    },
    onNotAvailable: (callback: () => void) => {
      ipcRenderer.on("autoUpdater:not-available", () => {
        callback();
      });
    },
    onAvailable: (callback: () => void) => {
      ipcRenderer.on("autoUpdater:available", () => {
        callback();
      });
    },
    onDownloaded: (callback: () => void) => {
      ipcRenderer.on("autoUpdater:downloaded", () => {
        callback();
      });
    },
    onError: (callback: () => void) => {
      ipcRenderer.on("autoUpdater:error", () => {
        callback();
      });
    }
  }
});
