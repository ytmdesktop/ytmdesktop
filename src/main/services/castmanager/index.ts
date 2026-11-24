import path from "node:path";
import {
  app,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  screen,
} from "electron";
import log from "electron-log";
import {
  createCastManager,
  type CastDevice,
  type CastManager as ElectronCastManager,
  type CastRequestInfo,
  type DeviceChoice,
} from "electron-cast/main";
import Service from "../service";
import {
  CastPickerDevice,
  CastPickerShowArguments,
  DependencyConstructor,
} from "~shared/types";
import AppWindowManager from "../windowmanager";
import type { AppWindow } from "../windowmanager/appwindow";
import ConfigStore from "../configstore";
import { getIconPath } from "../../util";

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

const YTM_ORIGIN = "https://music.youtube.com";

const PICKER_WINDOW_NAME = "CastPicker";
const PICKER_WIDTH = 320;
const PICKER_INITIAL_HEIGHT = 120;
const PICKER_MIN_HEIGHT = 40;
// Chromecast capability bit 1 (video_out), as advertised in the mDNS "ca" record
const CAPABILITY_VIDEO_OUT = 1;

// On some platforms a menu's close callback runs before the clicked item's handler, so a close only counts as a
// cancel once the click has had a chance to land.
const MENU_CLOSE_GRACE_MS = 100;

type PickerRequest = {
  resolve: (choice: DeviceChoice) => void;
  devicesById: Map<string, CastDevice>;
  currentDeviceId: string | undefined;
};

function sortDevices(devices: CastDevice[]) {
  return [...devices].sort(
    (a, b) =>
      Number(a.isGroup) - Number(b.isGroup) || a.name.localeCompare(b.name),
  );
}

function toPickerDevice(device: CastDevice): CastPickerDevice {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    kind: device.isGroup
      ? "group"
      : device.capabilities & CAPABILITY_VIDEO_OUT
        ? "tv"
        : "speaker",
  };
}

/**
 * Chromecast support: discovers Cast devices on the network and serves YTM's own cast button through electron-cast's
 * chrome.cast polyfill, which the ytmview preload installs.
 */
export default class CastManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] =
    [AppWindowManager, ConfigStore];

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  private manager: ElectronCastManager | null = null;

  private pickerWindow: AppWindow<"Browser"> | null = null;
  private pickerLoaded: Promise<void> | null = null;
  private pickerRequest: PickerRequest | null = null;
  private pickerAnchor = { x: 0, y: 0 };
  // The window stays hidden until the renderer has laid out the list and reported its height
  private pickerAwaitingSize = false;
  private pickerShown = false;

  public override onPreInitialized(): void {}
  public onInitialized() {
    if (this._initialized)
      throw new Error("CastManager is already initialized!");
    this._initialized = true;

    this.manager = createCastManager({
      ipcMain,
      allowOrigin: (origin) => origin === YTM_ORIGIN,
      selectDevice: (devices, request) => this.pickDevice(devices, request),
    });

    log.info("CastManager initialized");
  }
  public override onPostInitialized(): void {
    this.manager
      ?.start()
      .catch((err) => log.error("CastManager failed to start discovery", err));
  }
  public override onTerminated(): void {
    this.settlePicker(null);
    if (this.pickerWindow) {
      const windowManager = this.getDependency(AppWindowManager);
      if (windowManager.hasWindow(PICKER_WINDOW_NAME))
        windowManager.destroyWindow(this.pickerWindow);
      this.pickerWindow = null;
    }

    const manager = this.manager;
    this.manager = null;
    manager
      ?.dispose()
      .catch((err) => log.error("CastManager failed to dispose", err));
  }

  /** Shows the device picker at the cursor (the user just clicked YTM's cast button). */
  private pickDevice(
    devices: CastDevice[],
    request: CastRequestInfo,
  ): Promise<DeviceChoice> {
    return new Promise((resolve) => {
      // A newer request replaces an open picker
      this.settlePicker(null, false);

      const entry: PickerRequest = {
        resolve,
        devicesById: new Map(devices.map((device) => [device.id, device])),
        currentDeviceId: undefined,
      };
      const currentId = request.session?.deviceId;
      if (currentId && entry.devicesById.has(currentId))
        entry.currentDeviceId = currentId;

      this.pickerRequest = entry;
      this.pickerAnchor = screen.getCursorScreenPoint();

      this.showPicker(entry, devices).catch((err) => {
        log.error("CastManager failed to show the device picker window", err);
        if (this.pickerRequest !== entry) return;
        this.pickerRequest = null;
        this.pickDeviceWithMenu(devices, entry.currentDeviceId).then(resolve);
      });
    });
  }

  private async showPicker(entry: PickerRequest, devices: CastDevice[]) {
    const pickerWindow = this.ensurePickerWindow();
    await this.pickerLoaded;
    // Superseded or cancelled while the page was loading
    if (this.pickerRequest !== entry) return;

    const args: CastPickerShowArguments = {
      devices: sortDevices(devices).map(toPickerDevice),
      currentDeviceId: entry.currentDeviceId,
    };

    this.pickerAwaitingSize = true;
    this.placePicker(PICKER_INITIAL_HEIGHT);
    pickerWindow.webContents?.send("castPicker:show", args);
  }

  private ensurePickerWindow(): AppWindow<"Browser"> {
    const windowManager = this.getDependency(AppWindowManager);
    if (this.pickerWindow && windowManager.hasWindow(PICKER_WINDOW_NAME))
      return this.pickerWindow;

    const configStore = this.getDependency(ConfigStore);
    const pickerWindow = windowManager.createWindow("Browser", {
      name: PICKER_WINDOW_NAME,
      autoRecreate: false,
      waitForViews: false,
      url: app.isPackaged
        ? "ytmd-app://cast-picker"
        : ALL_WINDOWS_VITE_DEV_SERVER_URL + "/windows/cast-picker/index.html",
      electronOptions: {
        width: PICKER_WIDTH,
        height: PICKER_INITIAL_HEIGHT,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        frame: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: "#212121",
        icon: getIconPath("ytmd.png"),
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: path.join(
            __dirname,
            `../preload/windows/cast-picker/preload.cjs`,
          ),
          devTools: !app.isPackaged
            ? true
            : configStore.get("developer.enableDevTools"),
        },
      },
    });
    this.pickerWindow = pickerWindow;

    const electronWindow = pickerWindow._getElectronWindow();
    const webContents = electronWindow.webContents;

    // AppWindow opens DevTools for every window in development, which would steal focus and cancel the picker
    webContents.on("devtools-opened", () => webContents.closeDevTools());
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", (event) => event.preventDefault());

    this.pickerLoaded = new Promise<void>((resolve, reject) => {
      webContents.once("did-finish-load", () => resolve());
      webContents.once("did-fail-load", (_event, code, description) => {
        // Drop the broken window so the next request builds a fresh one
        if (this.pickerWindow === pickerWindow) this.pickerWindow = null;
        if (windowManager.hasWindow(PICKER_WINDOW_NAME))
          windowManager.destroyWindow(pickerWindow);
        reject(new Error(`Picker failed to load: ${description} (${code})`));
      });
    });
    // The failure is surfaced through showPicker; this keeps it from being reported as unhandled
    this.pickerLoaded.catch(() => {});

    // Only the picker's own page may answer
    const fromPicker = (event: Electron.IpcMainEvent) =>
      event.sender === webContents &&
      event.senderFrame === webContents.mainFrame;

    pickerWindow.ipcOn("castPicker:choose", (event, id: unknown) => {
      if (!fromPicker(event) || typeof id !== "string") return;
      const device = this.pickerRequest?.devicesById.get(id);
      if (device) this.settlePicker(device);
    });
    pickerWindow.ipcOn("castPicker:stop", (event) => {
      if (!fromPicker(event)) return;
      // Stop is only offered while casting
      if (this.pickerRequest?.currentDeviceId) this.settlePicker("stop");
    });
    pickerWindow.ipcOn("castPicker:cancel", (event) => {
      if (fromPicker(event)) this.settlePicker(null);
    });
    pickerWindow.ipcOn("castPicker:resize", (event, height: unknown) => {
      if (!fromPicker(event) || typeof height !== "number") return;
      if (!Number.isFinite(height) || !this.pickerRequest) return;
      this.placePicker(height);
      if (this.pickerAwaitingSize) {
        this.pickerAwaitingSize = false;
        this.pickerShown = true;
        electronWindow.show();
        electronWindow.focus();
      }
    });

    electronWindow.on("blur", () => {
      if (this.pickerShown) this.settlePicker(null);
    });
    electronWindow.on("closed", () => {
      this.pickerShown = false;
      this.pickerAwaitingSize = false;
      if (this.pickerWindow === pickerWindow) this.pickerWindow = null;
      this.settlePicker(null, false);
    });

    return pickerWindow;
  }

  /** Sizes the picker to the list and keeps it on the display it was opened on. */
  private placePicker(requestedHeight: number) {
    const electronWindow = this.pickerWindow?._getElectronWindow();
    if (!electronWindow || electronWindow.isDestroyed()) return;

    const { workArea } = screen.getDisplayNearestPoint(this.pickerAnchor);
    const width = Math.min(PICKER_WIDTH, workArea.width);
    const height = Math.round(
      Math.min(Math.max(requestedHeight, PICKER_MIN_HEIGHT), workArea.height),
    );
    const x = Math.min(
      Math.max(this.pickerAnchor.x, workArea.x),
      workArea.x + workArea.width - width,
    );
    const y = Math.min(
      Math.max(this.pickerAnchor.y, workArea.y),
      workArea.y + workArea.height - height,
    );
    electronWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
    });
  }

  /** Resolves the open picker request (if any) and optionally hides the window. */
  private settlePicker(choice: DeviceChoice, hide = true) {
    const request = this.pickerRequest;
    this.pickerRequest = null;

    if (hide) {
      this.pickerShown = false;
      this.pickerAwaitingSize = false;
      const electronWindow = this.pickerWindow?._getElectronWindow();
      if (electronWindow && !electronWindow.isDestroyed())
        electronWindow.hide();
    }

    request?.resolve(choice);
  }

  /** Fallback when the picker window cannot be created: the device list as a native menu. */
  private pickDeviceWithMenu(
    devices: CastDevice[],
    currentDeviceId: string | undefined,
  ): Promise<DeviceChoice> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice: DeviceChoice) => {
        if (settled) return;
        settled = true;
        resolve(choice);
      };

      const template: MenuItemConstructorOptions[] = [
        { label: "Cast to", enabled: false },
        { type: "separator" },
        ...sortDevices(devices).map(
          (device): MenuItemConstructorOptions => ({
            label: device.name,
            sublabel: device.id === currentDeviceId ? "Casting" : device.model,
            click: () => finish(device),
          }),
        ),
      ];
      if (currentDeviceId) {
        template.push(
          { type: "separator" },
          { label: "Stop casting", click: () => finish("stop") },
        );
      }

      const windowManager = this.getDependency(AppWindowManager);
      const window = windowManager.hasWindow("Main")
        ? windowManager.getWindow("Main")._getElectronWindow()
        : undefined;

      Menu.buildFromTemplate(template).popup({
        window,
        callback: () => setTimeout(() => finish(null), MENU_CLOSE_GRACE_MS),
      });
    });
  }
}
