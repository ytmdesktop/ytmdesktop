import { AppWindow, AppWindowOptions, AppWindowType } from "./appwindow";

export class AppWindowManager {
  private activeWindows: { [windowName: string]: AppWindow<AppWindowType> } = {};

  public createWindow<T extends AppWindowType>(windowType: T, windowOptions: AppWindowOptions<T>): AppWindow<T> {
    if (this.activeWindows[windowOptions.name]) throw new Error(`Window with the name '${windowOptions.name}' already exists`);

    const appWindow = new AppWindow(windowType, this, windowOptions);
    this.activeWindows[appWindow.name] = appWindow;

    return appWindow;
  }

  public closeWindow(window: AppWindow<AppWindowType>) {
    if (this.activeWindows[window.name] != window) throw new Error(`AppWindow '${window.name}' is not managed by this WindowManager`);

    window.closeWindow();
  }

  public destroyWindow(window: AppWindow<AppWindowType>) {
    if (this.activeWindows[window.name] != window) throw new Error(`AppWindow '${window.name}' is not managed by this WindowManager`);

    window.destroyWindow();
    delete this.activeWindows[window.name];
  }

  public hasWindow(name: string) {
    return this.activeWindows[name] ? true : false;
  }

  public getWindow(name: string) {
    return this.activeWindows[name];
  }

  public getWindows() {
    return Object.values(this.activeWindows);
  }

  public forceWindowClosures() {
    for (const window of Object.values(this.activeWindows)) {
      window.forceWindowClosure();
    }
  }
}

export default new AppWindowManager();
