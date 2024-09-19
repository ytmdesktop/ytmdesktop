import { app, BaseWindow, BaseWindowConstructorOptions, BrowserWindow, BrowserWindowConstructorOptions, IpcMainEvent, Rectangle } from "electron";
import assert from "node:assert";
import log from "electron-log";
import { AppView } from "./appview";
import { EventEmitter } from "node:stream";
import { AppWindowManager } from ".";

export type AppWindowType = "Base" | "Browser";
export type AppWindowEventMap = {
  "recreated": [];
  "electronwindow-resize": [];
  "electronwindow-move": [];
  "electronwindow-maximize": [];
  "electronwindow-unmaximize": [];
  // This event is not called when the app is quitting
  "electronwindow-close": [Electron.Event];
};

export type ElectronOptions = {
  Base: BaseWindowConstructorOptions;
  Browser: BrowserWindowConstructorOptions;
};
export type MappedElectronOptions = {
  [P in AppWindowType]: ElectronOptions[P];
};

export type ElectronWindow = {
  Base: BaseWindow;
  Browser: BrowserWindow;
};
export type MappedElectronWindow = {
  [P in AppWindowType]: ElectronWindow[P];
};

export type AppWindowOptions<T extends AppWindowType> = {
  /**
   * The name of the Window
   */
  name: string;
  /**
   * Whether to automatically recreate this window when it closes
   *
   * This also applies if the window crashes
   */
  autoRecreate: boolean;
  /**
   * The backing electron window options
   */
  electronOptions: MappedElectronOptions[T];
  /**
   * Instructs the Window to wait for initial views to be ready before showing the window
   */
  waitForViews: boolean;
  /**
   * The initial state the window should be in that can't be specified by Electron window options
   */
  windowState?: {
    maximized?: boolean;
  };
  /**
   * The initial views to attach to the window
   */
  views?: AppView[];
  /**
   * The url to load for the window
   *
   * This only works if AppWindowType is set to "Browser"
   */
  url: string;
};

export class AppWindow<T extends AppWindowType> extends EventEmitter<AppWindowEventMap> {
  private readonly windowType: T;
  private parentManager: AppWindowManager;
  private electronWindow: BaseWindow;
  private options: AppWindowOptions<T>;
  private activeViews: { [viewName: string]: { view: AppView; index: number } } = {};

  private destroyed = false;
  private requestedClosure = false;
  private initialCreation = true;
  private lastState: {
    maximized: boolean;
    bounds: Rectangle;
  } = {
    maximized: false,
    bounds: undefined
  };
  private initialViewsReady = 0;
  private localViewReady = false;
  private windowReady = false;
  private ipcEventProxy = new EventEmitter();

  private thumbarButtons: Electron.ThumbarButton[] = [];
  private progressBar: number = -1;
  private progressBarOptions: Electron.ProgressBarOptions = null;

  public readonly name: string;
  public get webContents() {
    if (this.windowType !== "Browser") throw new Error("This AppWindow does not contain a webContents");

    if (this.electronWindow) return (this.electronWindow as BrowserWindow).webContents;
    else return null;
  }

  public constructor(windowType: T, parentManager: AppWindowManager, windowOptions: AppWindowOptions<T>) {
    super();

    this.windowType = windowType;
    this.options = windowOptions;
    this.name = windowOptions.name;
    this.parentManager = parentManager;
    this.createElectronWindow();
  }

  /**
   * Safely closes this AppWindow
   *
   * The AppWindow is disposed after this call and should not be used
   */
  public closeWindow() {
    assert(this.destroyed === false, new Error("This AppWindow is destroyed"));

    this.requestedClosure = true;
    this.electronWindow.close();
  }

  /**
   * Destroys this window in an unsafe manner
   *
   * The AppWindow is disposed after this call and should not be used
   */
  public destroyWindow() {
    this.requestedClosure = true;

    if (!this.electronWindow.isDestroyed()) this.electronWindow.destroy();

    this.destroyed = true;
  }

  /**
   * Creates the window
   */
  public createWindow() {
    if (this.electronWindow) throw new Error(`Tried to create backing electron window for AppWindow '${this.name}' but it already exists`);
    this.createElectronWindow();
  }

  private recreateWindowInternal() {
    if (!this.requestedClosure && !this.destroyed) {
      if (!this.electronWindow.isDestroyed()) this.electronWindow.destroy();
    }
  }

  public _getElectronWindow(): MappedElectronWindow[T] {
    assert(this.destroyed === false, new Error("This AppWindow is destroyed"));

    return this.electronWindow as MappedElectronWindow[T];
  }

  public attachView(view: AppView, index?: number) {
    if (this.activeViews[view.name]) throw new Error(`View with the name '${view.name}' already exists on Window '${this.name}'`);

    view._attachToWindow(this, index);
    this.activeViews[view.name] = {
      view,
      index
    };
  }

  public detachView(view: AppView) {
    if (this.activeViews[view.name].view != view) {
      log.warn(
        `Attempted to detach AppView '${this.name}' from ${this.name} but the provided view does not match the current view with the same name attached`
      );
      return;
    }

    view._detachFromWindow(this);
    delete this.activeViews[view.name];
  }

  /**
   * Asynchronously waits for the window to be ready then returns
   *
   * @remarks Returns immediately if the window is already ready
   */
  public async ready(): Promise<void> {
    if (!this.windowReady)
      await new Promise<void>(resolve => {
        const interval = setInterval(() => {
          if (this.windowReady) {
            clearInterval(interval);
            resolve();
          }
        }, 250);
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- This is OK to have as any
  public ipcOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    assert(this.windowType === "Browser", new Error("Attempted to attach an ipc event but the current window isn't of type 'Browser'"));

    this.ipcEventProxy.on(channel, listener);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- This is OK to have as any
  public ipcOff(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    assert(this.windowType === "Browser", new Error("Attempted to detach an ipc event but the current window isn't of type 'Browser'"));

    this.ipcEventProxy.off(channel, listener);
  }

  public ipcBroadcast(channel: string, ...args: unknown[]) {
    if (this.windowType === "Browser") (this.electronWindow as BrowserWindow).webContents.send(channel, ...args);

    for (const appView of Object.values(this.activeViews)) {
      appView.view.webContents?.send(channel, ...args);
    }
  }

  public showAndFocus() {
    if (this.electronWindow.isMinimized()) this.electronWindow.restore();
    this.electronWindow.show();
    this.electronWindow.focus();
  }

  public hide() {
    this.electronWindow.hide();
  }

  public show() {
    this.electronWindow.show();
  }

  public isVisible() {
    return this.electronWindow.isVisible();
  }

  public forceWindowClosure() {
    this.requestedClosure = true;
  }

  public setThumbarButtons(buttons: Electron.ThumbarButton[]) {
    if (process.platform !== "win32") return;

    this.thumbarButtons = buttons;
    this.electronWindow.setThumbarButtons(buttons);
  }

  public setProgressBar(progress: number, options?: Electron.ProgressBarOptions) {
    this.progressBar = progress;
    this.progressBarOptions = options;
    this.electronWindow.setProgressBar(progress, options);
  }

  public getWindowType() {
    return this.windowType;
  }

  private createElectronWindow() {
    // Silently ignore this call as the AppWindow is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring createElectronWindow because this AppWindow is destroyed");
      return;
    }
    log.debug(`AppWindow '${this.name}' created`);

    switch (this.windowType) {
      case "Base": {
        this.electronWindow = new BaseWindow(this.options.electronOptions as BaseWindowConstructorOptions);
        break;
      }

      case "Browser": {
        this.electronWindow = new BrowserWindow(this.options.electronOptions as BrowserWindowConstructorOptions);
        break;
      }

      default: {
        throw new Error("Invalid window type passed to createWindow");
      }
    }
    this.attachElectronWindowEvents();

    if (this.initialCreation && (this.options.windowState?.maximized ?? false)) this.electronWindow.maximize();
    else if (this.lastState.maximized) this.electronWindow.maximize();

    if (this.initialCreation) {
      for (const view of this.options.views ?? []) {
        this.attachView(view);
        if (this.options.waitForViews) {
          view._getElectronView().webContents.once("dom-ready", () => {
            this.initialViewsReady++;
            if (this.initialViewsReady >= this.options.views.length) {
              if (this.electronWindow instanceof BrowserWindow && this.localViewReady) {
                this.electronWindow.show();
                this.windowReady = true;
              }
            }
          });
        }
      }

      if (this.options.waitForViews) {
        if (this.electronWindow instanceof BrowserWindow) {
          this.electronWindow.on("ready-to-show", () => {
            this.localViewReady = true;
            if (this.initialViewsReady >= (this.options.views?.length ?? 0)) {
              this.electronWindow.show();
              this.windowReady = true;
            }
          });
        }
      }
    } else {
      for (const view of Object.values(this.activeViews)) {
        view.view._attachToWindow(this, view.index);
      }
      this.electronWindow.show();
      this.windowReady = true;
    }

    if (this.thumbarButtons) this.electronWindow.setThumbarButtons(this.thumbarButtons);
    if (this.progressBar) this.electronWindow.setProgressBar(this.progressBar, this.progressBarOptions);

    if (this.windowType === "Browser") {
      if (!app.isPackaged) (this.electronWindow as BrowserWindow).webContents.openDevTools();

      (this.electronWindow as BrowserWindow).loadURL(this.options.url);
    }

    this.initialCreation = false;
  }

  private sendWindowControlsStateIpc() {
    assert(this.windowType === "Browser", new Error("Attempted to send window controls state but the current window isn't of type 'Browser'"));

    (this.electronWindow as BrowserWindow).webContents.send("windowControls:stateChanged", {
      minimized: this.electronWindow.isMinimized(),
      maximized: this.electronWindow.isMaximized(),
      fullscreen: this.electronWindow.isFullScreen()
    });
  }

  private attachElectronWindowEvents() {
    // Silently ignore this call as the AppWindow is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring attachElectronWindowEvents because this AppWindow is destroyed");
      return;
    }

    this.electronWindow.on("close", event => {
      if (!this.requestedClosure) this.emit("electronwindow-close", event);
      // Even if the event was prevented if a closure was requested already we will be honouring that
      if (!event.defaultPrevented) {
        this.requestedClosure = true;
        this.lastState.bounds = this.electronWindow.getBounds();
        this.lastState.maximized = this.electronWindow.isMaximized();

        for (const view of Object.values(this.activeViews)) {
          this.detachView(view.view);
        }
      }
    });

    this.electronWindow.on("closed", () => {
      log.debug(`AppWindow '${this.name}' closed`);
      this.windowReady = false;

      if (!this.requestedClosure && this.options.autoRecreate) {
        log.debug(`Recreating AppWindow '${this.name}' because of an unexpected closure`);
        this.createElectronWindow();
        log.debug(`Recreated AppWindow '${this.name}'`);
        this.emit("recreated");
      } else {
        this.parentManager.destroyWindow(this);
      }
    });

    //#region Proxy rest of events
    this.electronWindow.on("resize", () => {
      this.emit("electronwindow-resize");
    });
    this.electronWindow.on("move", () => {
      this.emit("electronwindow-move");
    });
    this.electronWindow.on("maximize", () => {
      this.emit("electronwindow-maximize");
    });
    this.electronWindow.on("unmaximize", () => {
      this.emit("electronwindow-unmaximize");
    });
    //#endregion

    if (this.windowType === "Browser") {
      const browserWindow = this.electronWindow as BrowserWindow;
      browserWindow.webContents.ipc.on("windowControls:minimize", () => {
        this.electronWindow.minimize();
      });
      browserWindow.webContents.ipc.on("windowControls:maximize", () => {
        this.electronWindow.maximize();
      });
      browserWindow.webContents.ipc.on("windowControls:restore", () => {
        this.electronWindow.restore();
      });
      browserWindow.webContents.ipc.on("windowControls:close", () => {
        this.closeWindow();
      });
      browserWindow.webContents.ipc.on("windowControls:requestState", () => {
        this.sendWindowControlsStateIpc();
      });
      browserWindow.on("minimize", this.sendWindowControlsStateIpc.bind(this));
      browserWindow.on("maximize", this.sendWindowControlsStateIpc.bind(this));
      browserWindow.on("unmaximize", this.sendWindowControlsStateIpc.bind(this));
      browserWindow.on("restore", this.sendWindowControlsStateIpc.bind(this));
      browserWindow.webContents.on("render-process-gone", () => {
        log.debug(`AppWindow '${this.name}' webContents render process gone`);
        this.recreateWindowInternal();
      });
      browserWindow.webContents.on("ipc-message", (event, channel, ...args: unknown[]) => {
        this.ipcEventProxy.emit(channel, event, ...args);
      });
    }
  }
}
