import { WindowsEventArguments, YTMViewStatus } from "~shared/types";
import Store from "../store-ipc/store";
import { StoreSchema, MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../store-ipc/memory-store";
import { PlayerState } from "~shared/playerstatestore/types";

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
      ytmViewStatusChanged(callback: (status: YTMViewStatus) => void): void;

      // View specific
      appViewHiding(callback: () => void): void;
      appViewShowing(callback: () => void): void;
      appViewHide(): void;

      // Window control
      minimizeWindow(): void;
      maximizeWindow(): void;
      restoreWindow(): void;
      closeWindow(): void;
      setAlwaysOnTopWindow(alwaysOnTop: boolean): void;
      handleWindowEvents(callback: (args: WindowsEventArguments) => void);
      requestWindowState(): void;

      // App specific
      getAppVersion(): Promise<string>;
      checkForUpdates(): void;
      handleCheckingForUpdate(callback: () => void);
      handleUpdateAvailable(callback: () => void);
      handleUpdateNotAvailable(callback: () => void);
      handleUpdateDownloaded(callback: () => void);
      isAppUpdateAvailable(): Promise<boolean>;
      isAppUpdateDownloaded(): Promise<boolean>;

      // Miniplayer specific
      playerStore: {
        getState(): PlayerState | null;
        handleStateChanged(callback: (state: PlayerState) => void);
      };
      executeCommandInYTMView(command: string, ...args: unknown[]);
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
