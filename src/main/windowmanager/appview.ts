import { app, IpcMainEvent, Rectangle, WebContentsView, WebContentsViewConstructorOptions } from "electron";
import { AppWindow, AppWindowType } from "./appwindow";
import assert from "node:assert";
import log from "electron-log";
import { EventEmitter } from "node:stream";

export type AppViewEventMap = {
  // AppView related events
  "recreated": [];
  "ready": [];

  // WebContents proxied events
  "webcontents-enter-html-full-screen": [];
  "webcontents-leave-html-full-screen": [];
  "webcontents-did-navigate": [];
  "webcontents-did-navigate-in-page": [];
  "webcontents-context-menu": [Electron.Event, Electron.ContextMenuParams];
  "webcontents-will-navigate": [Electron.Event<Electron.WebContentsWillNavigateEventParams>];
  "webcontents-will-redirect": [Electron.Event<Electron.WebContentsWillRedirectEventParams>];
  "webcontents-unresponsive": [];
  "webcontents-responsive": [];
};

export type AppViewOptions = {
  /**
   * The name of the View
   */
  name: string;
  /**
   * The url to load for the view
   */
  url: string;
  /**
   * Whether to automatically recreate this view when it crashes
   */
  autoRecreate: boolean;
  /**
   * Whether to automatically create the view when the constructor is called
   */
  autoCreate?: boolean;
  /**
   * The initial state the view should be in
   */
  viewState: {
    bounds?: Rectangle;
    /**
     * When enabled determines how to auto resize the view with the parent window
     */
    autoResize?: {
      /**
       * Resize the width with the parent window
       */
      width?: boolean;
      /**
       * Resize the height with the parent window
       */
      height?: boolean;
      /**
       * How much to offset width by when resizing
       *
       * Percent is offset first and then pixels
       */
      offsetWidth?: {
        pixels?: number;
        percent?: number;
        /**
         * @default "Left"
         */
        anchor?: "Left" | "Right";
      };
      /**
       * How much to offset height by when resizing
       *
       * Percent is offset first and then pixels
       */
      offsetHeight?: {
        pixels?: number;
        percent?: number;
        /**
         * @default "Top"
         */
        anchor?: "Top" | "Bottom";
      };
    };
  };
  /**
   * The backing electron view options
   */
  electronOptions: WebContentsViewConstructorOptions;
};

export class AppView extends EventEmitter<AppViewEventMap> {
  private parentWindow: AppWindow<AppWindowType>;
  private electronView: WebContentsView;
  private options: AppViewOptions;

  private destroyed = false;
  private attachedParentEvents: {
    [eventName: string]: { (...args: unknown[]): void };
  } = {};
  private viewReady = false;
  private lastViewIndex = -1;
  private ipcEventProxy = new EventEmitter();

  public readonly name: string;
  public get webContents() {
    return this.electronView?.webContents;
  }

  public constructor(viewOptions: AppViewOptions) {
    super();

    this.options = viewOptions;
    this.name = viewOptions.name;
    this.options.autoCreate = this.options.autoCreate ?? true;

    if (this.options.autoCreate) this.createElectronView();
  }

  public _attachToWindow(appWindow: AppWindow<AppWindowType>, index?: number) {
    assert(this.destroyed === false, new Error("This AppView is destroyed"));

    if (this.parentWindow && this.parentWindow !== appWindow) this.parentWindow.detachView(this);

    this.parentWindow = appWindow;
    this.parentWindow._getElectronWindow().contentView.addChildView(this.electronView, index);
    this.lastViewIndex = index;

    // Execute a parent window resize so the bounds are adjusted on attach
    this.parentWindowResize();

    this.attachParentElectronWindowEvents();

    if (!app.isPackaged) this.electronView.webContents.openDevTools();

    log.debug(`AppView '${this.name}' attached to parent ${this.parentWindow.name} with index '${index ?? "end"}'`);
  }

  public _detachFromWindow(appWindow: AppWindow<AppWindowType>) {
    assert(this.destroyed === false, new Error("This AppView is destroyed"));

    if (this.parentWindow != appWindow) {
      log.warn(`Attempted to detach AppView '${this.name}' from ${appWindow.name} but the window isn't the current parent window of this AppView`);
      return;
    }

    this.detachParentElectronWindowEvents();
    this.parentWindow._getElectronWindow().contentView.removeChildView(this.electronView);
    log.debug(`AppView '${this.name}' detached from parent ${this.parentWindow.name}`);
    this.parentWindow = null;
  }

  public _getElectronView(): WebContentsView {
    assert(this.destroyed === false, new Error("This AppView is destroyed"));

    return this.electronView;
  }

  /**
   * Creates the backing electron view
   */
  public create() {
    assert(this.destroyed === false, new Error("This AppView is destroyed"));

    if (this.options.autoCreate) throw new Error("This function cannot be called while autoCreate is enabled");
    if (this.electronView) throw new Error("View already created");

    this.createElectronView();
  }

  /**
   * Asynchronously waits for the view to be ready then returns
   *
   * @remarks Returns immediately if the view is already ready
   */
  public async ready(): Promise<void> {
    if (!this.viewReady)
      await new Promise<void>(resolve => {
        const interval = setInterval(() => {
          if (this.viewReady) {
            clearInterval(interval);
            resolve();
          }
        }, 250);
      });
  }

  /**
   * Hides this view
   *
   * @param waitForWebContents Whether to wait for the web contents to signal it's ready to be hidden
   */
  public async hide(waitForWebContents?: boolean) {
    if (waitForWebContents) {
      await new Promise<void>(resolve => {
        this.electronView.webContents.ipc.once("appView:hide", () => {
          resolve();
        });
        this.electronView.webContents.send("appView:hide");
      });
    }

    log.debug(`AppView '${this.name}' hidden`);
    this.electronView.setVisible(false);
  }

  /**
   * Shows this view
   *
   * @param notifyWebContents Whether to notify the web contents of the view being shown
   */
  public show(notifyWebContents?: boolean) {
    if (notifyWebContents) this.electronView.webContents.send("appView:show");

    log.debug(`AppView '${this.name}' shown`);
    this.electronView.setVisible(true);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- This is OK to have as any
  public ipcOn(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    this.ipcEventProxy.on(channel, listener);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- This is OK to have as any
  public ipcOff(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    this.ipcEventProxy.off(channel, listener);
  }

  public setAutoResize(autoResize: Partial<AppViewOptions["viewState"]["autoResize"]>) {
    const updatedAutoResize = { ...this.options.viewState.autoResize, ...autoResize };
    this.options.viewState.autoResize = updatedAutoResize;
    this.parentWindowResize();
  }

  private createElectronView() {
    // Silently ignore this call as the AppView is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring createElectronView because this AppView is destroyed");
      return;
    }
    log.debug(`AppView '${this.name}' created`);

    this.electronView = new WebContentsView(this.options.electronOptions);
    this.electronView.webContents.loadURL(this.options.url);
    this.attachElectronViewEvents();
    if (this.parentWindow) this._attachToWindow(this.parentWindow, this.lastViewIndex);
  }

  private attachElectronViewEvents() {
    // Silently ignore this call as the AppView is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring attachElectronViewEvents because this AppView is destroyed");
      return;
    }

    this.electronView.webContents.on("render-process-gone", () => {
      log.debug(`AppView '${this.name}' webContents render process gone`);
      this.viewReady = false;
      if (this.options.autoRecreate) {
        this.createElectronView();
        this.emit("recreated");
      } else {
        this.destroyed = true;
        this._detachFromWindow(this.parentWindow);
      }
    });
    this.electronView.webContents.on("dom-ready", () => {
      log.debug(`AppView '${this.name}' webContents dom ready`);
      this.viewReady = true;
      this.emit("ready");
    });
    this.electronView.webContents.on("ipc-message", (event, channel, ...args: unknown[]) => {
      this.ipcEventProxy.emit(channel, event, ...args);
    });

    //#region Proxy rest of events
    this.electronView.webContents.on("enter-html-full-screen", () => {
      this.emit("webcontents-enter-html-full-screen");
    });
    this.electronView.webContents.on("leave-html-full-screen", () => {
      this.emit("webcontents-leave-html-full-screen");
    });
    this.electronView.webContents.on("did-navigate", () => {
      this.emit("webcontents-did-navigate");
    });
    this.electronView.webContents.on("did-navigate-in-page", () => {
      this.emit("webcontents-did-navigate-in-page");
    });
    this.electronView.webContents.on("context-menu", (event, params) => {
      this.emit("webcontents-context-menu", event, params);
    });
    this.electronView.webContents.on("will-navigate", event => {
      this.emit("webcontents-will-navigate", event);
    });
    this.electronView.webContents.on("will-redirect", event => {
      this.emit("webcontents-will-redirect", event);
    });
    this.electronView.webContents.on("unresponsive", () => {
      this.emit("webcontents-unresponsive");
    });
    this.electronView.webContents.on("responsive", () => {
      this.emit("webcontents-responsive");
    });
    //#endregion
  }

  private parentWindowResize() {
    if (this.options.viewState.autoResize) {
      const newBounds = this.electronView.getBounds();
      const parentBounds = this.parentWindow._getElectronWindow().getContentBounds();
      if (this.options.viewState.autoResize.width) {
        newBounds.width = parentBounds.width;
      }

      if (this.options.viewState.autoResize.height) {
        newBounds.height = parentBounds.height;
      }

      if (this.options.viewState.autoResize.offsetWidth) {
        if (this.options.viewState.autoResize.offsetWidth.percent)
          newBounds.width -= (this.options.viewState.autoResize.offsetWidth.percent / 100) * newBounds.width;

        if (this.options.viewState.autoResize.offsetWidth.pixels) newBounds.width -= this.options.viewState.autoResize.offsetWidth.pixels;

        if (this.options.viewState.autoResize.offsetWidth.anchor === "Right") newBounds.x = parentBounds.width - newBounds.width;
        else if (this.options.viewState.autoResize.offsetWidth.anchor === "Left") newBounds.x = 0;
      }

      if (this.options.viewState.autoResize.offsetHeight) {
        if (this.options.viewState.autoResize.offsetHeight.percent)
          newBounds.height -= (this.options.viewState.autoResize.offsetHeight.percent / 100) * newBounds.height;

        if (this.options.viewState.autoResize.offsetHeight.pixels) newBounds.height -= this.options.viewState.autoResize.offsetHeight.pixels;

        if (this.options.viewState.autoResize.offsetHeight.anchor === "Bottom") newBounds.y = parentBounds.height - newBounds.height;
        else if (this.options.viewState.autoResize.offsetHeight.anchor === "Top") newBounds.y = 0;
      }

      this.electronView.setBounds(newBounds);
    }
  }

  private attachParentElectronWindowEvents() {
    // Silently ignore this call as the AppView is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring attachParentElectronWindowEvents because this AppView is destroyed");
      return;
    }

    if (this.parentWindow) {
      this.attachedParentEvents["resize"] = this.parentWindowResize.bind(this);

      this.parentWindow._getElectronWindow().on("resize", this.attachedParentEvents["resize"]);
    }
  }

  private detachParentElectronWindowEvents() {
    // Silently ignore this call as the AppView is destroyed
    if (this.destroyed) {
      log.verbose("Silently ignoring detachParentElectronWindowEvents because this AppView is destroyed");
      return;
    }

    if (this.parentWindow) {
      this.parentWindow._getElectronWindow().off("resize", this.attachedParentEvents["resize"]);

      delete this.attachedParentEvents["resize"];
    }
  }
}
