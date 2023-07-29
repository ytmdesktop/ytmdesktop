import Store from "../shared/store/renderer";
import { StoreSchema } from "../shared/store/schema";

declare global {
  interface Window {
    ytmd: {
      // Settings specific
      store: Store<StoreSchema>;
      safeStorage: {
        decryptString(value: string): string;
        encryptString(value: string): Buffer;
      };
      openSettingsWindow(): void;
      restartApplication(): void;

      // Companion Authorization specific
      sendResult(authorized: boolean);
      getAppName(): string;
      getCode(): string;

      // Main window specific
      switchFocus(context: "main" | "ytm"): void;

      // Window control
      minimizeWindow(): void;
      maximizeWindow(): void;
      restoreWindow(): void;
      closeWindow(): void;
      handleWindowEvents(callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void);
      requestWindowState(): void;
    };
  }
}
