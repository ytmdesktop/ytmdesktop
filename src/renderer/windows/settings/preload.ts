// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from "electron";
import Store from "../../store-ipc/store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { WindowsEventArguments } from "~shared/types";
import MemoryStore from "../../store-ipc/memory-store";

const store = new Store<StoreSchema>();
const memoryStore = new MemoryStore<MemoryStoreSchema>();

// Set up global error handlers for the renderer process
window.addEventListener("error", event => {
  console.error("Uncaught error in settings window:", event.error);
  ipcRenderer.send("renderer:unhandledError", {
    message: event.error?.message || "Unknown error",
    stack: event.error?.stack || "",
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    window: "settings"
  });
});

window.addEventListener("unhandledrejection", event => {
  console.error("Unhandled rejection in settings window:", event.reason);
  ipcRenderer.send("renderer:unhandledRejection", {
    message: event.reason?.message || "Unknown promise rejection",
    stack: event.reason?.stack || "",
    window: "settings"
  });
});

contextBridge.exposeInMainWorld("ytmd", {
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
  isWindows: process.platform === "win32",
  memoryStore: {
    set: (key: string, value: unknown) => memoryStore.set(key, value),
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: MemoryStoreSchema, oldState: MemoryStoreSchema) => void) => memoryStore.onStateChanged(callback)
  },
  store: {
    set: (key: string, value: unknown) => store.set(key, value),
    get: async (key: keyof StoreSchema) => await store.get(key),
    reset: (key: keyof StoreSchema) => store.reset(key),
    onDidAnyChange: (callback: (newState: StoreSchema, oldState: StoreSchema) => void) => store.onDidAnyChange(callback)
  },
  safeStorage: {
    decryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:decryptString", value),
    encryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:encryptString", value)
  },
  restartApplication: () => ipcRenderer.send("settingsWindow:restartapplication"),
  restartApplicationForUpdate: () => ipcRenderer.send("app:restartApplicationForUpdate"),
  minimizeWindow: () => ipcRenderer.send("settingsWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("settingsWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("settingsWindow:restore"),
  closeWindow: () => ipcRenderer.send("settingsWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on("settingsWindow:stateChanged", callback),
  getAppVersion: async (): Promise<string> => await ipcRenderer.invoke("app:getVersion"),
  checkForUpdates: () => ipcRenderer.send("app:checkForUpdates"),
  handleCheckingForUpdate: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:checkingForUpdate", callback),
  handleUpdateAvailable: (callback: (event: Electron.IpcRendererEvent, info?: unknown) => void) => ipcRenderer.on("app:updateAvailable", callback),
  handleUpdateNotAvailable: (callback: (event: Electron.IpcRendererEvent, info?: unknown) => void) => ipcRenderer.on("app:updateNotAvailable", callback),
  handleUpdateDownloaded: (callback: (event: Electron.IpcRendererEvent, info?: unknown) => void) => ipcRenderer.on("app:updateDownloaded", callback),
  handleUpdateError: (callback: (event: Electron.IpcRendererEvent, error?: unknown) => void) => ipcRenderer.on("app:updateError", callback),
  handleUpdateDownloadProgress: (callback: (event: Electron.IpcRendererEvent, progressObj?: unknown) => void) =>
    ipcRenderer.on("app:updateDownloadProgress", callback),
  isAppUpdateAvailable: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateAvailable"),
  isAppUpdateDownloaded: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateDownloaded"),
  getUpdateStatus: async () => await ipcRenderer.invoke("app:getUpdateStatus"),
  getUpdateSettings: async () => await ipcRenderer.invoke("app:getUpdateSettings"),
  updateSettings: (settings: unknown) => ipcRenderer.send("app:updateSettings", settings),
  getTrueFilePath: (file: File) => webUtils.getPathForFile(file),
  openDevTools: () => ipcRenderer.send("ytmView:openDevTools"),

  // Plugin management
  getPlugins: async () => await ipcRenderer.invoke("plugins:getList"),
  getPluginSettingsSchemas: async () => await ipcRenderer.invoke("plugins:getSettingsSchemas"),
  togglePlugin: async (pluginId: string, enabled: boolean) => await ipcRenderer.invoke("plugins:toggle", pluginId, enabled),
  getPluginSetting: (pluginId: string, key: string) => ipcRenderer.sendSync("plugins:getSetting", pluginId, key),
  updatePluginSetting: async (pluginId: string, key: string, value: unknown) => await ipcRenderer.invoke("plugins:updateSetting", pluginId, key, value),

  // Vinyl player specific
  showVinylPlayer: async () => await ipcRenderer.invoke("vinyl-player:show"),
  hideVinylPlayer: async () => await ipcRenderer.invoke("vinyl-player:hide"),

  // 6K Labs Widget specific
  get6KLabsWidgetUrl: async () => await ipcRenderer.invoke("6klabs-widget:getUrl")
});

// Also expose ipcRenderer directly for components that need it
contextBridge.exposeInMainWorld("ipcRenderer", {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.on(channel, listener),
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => ipcRenderer.removeListener(channel, listener)
});
