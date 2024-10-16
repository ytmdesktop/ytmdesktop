import { WindowsEventArguments } from "~shared/types";
import Store from "../store-ipc/store";
import { StoreSchema, MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../store-ipc/memory-store";

declare global {
  interface Window {
    ytmd: {
      // Settings specific
      isDarwin: boolean;
      isLinux: boolean;
      isWindows: boolean;
      store: Store<StoreSchema>;
      memoryStore: MemoryStore<MemoryStoreSchema>;
      safeStorage: {
        decryptString(value: string): string;
        encryptString(value: string): Buffer;
      };
      openSettingsWindow(): void;
      restartApplication(): void;
      restartApplicationForUpdate(): void;
      getTrueFilePath(file: File): string;

      // Companion Authorization specific
      sendResult(authorized: boolean);
      getAppName(): string;
      getCode(): string;

      // Main window specific
      switchFocus(context: "main" | "ytm"): void;

      // YTM view specific
      ytmViewNavigateDefault(): void;
      ytmViewRecreate(): void;

      // Window control
      minimizeWindow(): void;
      maximizeWindow(): void;
      restoreWindow(): void;
      closeWindow(): void;
      handleWindowEvents(callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void);
      requestWindowState(): void;

      // App specific
      getAppVersion(): Promise<string>;
      checkForUpdates(): void;
      handleCheckingForUpdate(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateAvailable(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateNotAvailable(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateDownloaded(callback: (event: Electron.IpcRendererEvent) => void);
      isAppUpdateAvailable(): Promise<boolean>;
      isAppUpdateDownloaded(): Promise<boolean>;
    };
  }

  // Fixes the navigator type to include windowControlsOverlay
  interface Navigator {
    windowControlsOverlay: {
      visible: boolean;
      addEventListener(event: "geometrychange", listener: (event: { visible: boolean }) => void);
    };
  }
}
