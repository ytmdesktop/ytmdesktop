// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import { WindowsEventArguments } from "~shared/types";
import { MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../../store-ipc/memory-store";
import RendererSentryIntegration from "../../integrations/sentry";

const memoryStore = new MemoryStore<MemoryStoreSchema>();

// Initialize Sentry integration (only once, through the integration class)
try {
  const sentryIntegration = new RendererSentryIntegration();
  sentryIntegration.enable();
} catch (error) {
  console.error("Failed to initialize Sentry integration:", error);
  // Allow the preload script to continue even if Sentry fails
}

// Set up global error handlers for the renderer process
window.addEventListener("error", event => {
  console.error("Uncaught error:", event.error);
  ipcRenderer.send("renderer:unhandledError", {
    message: event.error?.message || "Unknown error",
    stack: event.error?.stack || "",
    source: event.filename,
    line: event.lineno,
    column: event.colno
  });

  // Don't prevent default - still allow the error to be logged in the console
});

window.addEventListener("unhandledrejection", event => {
  console.error("Unhandled rejection:", event.reason);
  ipcRenderer.send("renderer:unhandledRejection", {
    message: event.reason?.message || "Unknown promise rejection",
    stack: event.reason?.stack || ""
  });
});

contextBridge.exposeInMainWorld("ytmd", {
  minimizeWindow: () => ipcRenderer.send("mainWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("mainWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("mainWindow:restore"),
  closeWindow: () => ipcRenderer.send("mainWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on("mainWindow:stateChanged", callback),
  requestWindowState: () => ipcRenderer.send("mainWindow:requestWindowState"),
  openSettingsWindow: () => ipcRenderer.send("settingsWindow:open"),
  switchFocus: (context: string) => ipcRenderer.send("ytmView:switchFocus", context),
  ytmViewNavigateDefault: () => ipcRenderer.send("ytmView:navigateDefault"),
  ytmViewRecreate: () => ipcRenderer.send("ytmView:recreate"),
  memoryStore: {
    set: (key: string, value: unknown) => memoryStore.set(key, value),
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: MemoryStoreSchema, oldState: MemoryStoreSchema) => void) => memoryStore.onStateChanged(callback)
  },
  restartApplicationForUpdate: () => ipcRenderer.send("app:restartApplicationForUpdate"),
  checkForUpdates: () => ipcRenderer.send("app:checkForUpdates"),
  reportError: (error: Error) =>
    ipcRenderer.send("renderer:reportError", {
      message: error.message,
      stack: error.stack
    })
});

// Also expose ipcRenderer directly for components that need it
contextBridge.exposeInMainWorld("ipcRenderer", {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.on(channel, listener),
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.removeListener(channel, listener)
});
