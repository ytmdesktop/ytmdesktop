import { app, clipboard, crashReporter, dialog } from "electron";
import log, { LogMessage } from "electron-log";
import Manager from "../manager";

export type WatchDogEvent = "crash";
export type WatchDogEventCallback = () => void;
export enum WatchDogApplicationState {
  Normal,
  Crashed
}

class WatchDog implements Manager {
  private eventCallbacks: { [key in WatchDogEvent]: WatchDogEventCallback[] } = {
    crash: []
  };

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  private _applicationState = WatchDogApplicationState.Normal;
  public get applicationState() {
    return this._applicationState;
  }

  private sanitizeMessage(message: LogMessage): false | LogMessage {
    for (let i = 0; i < message.data.length; i++) {
      const data = message.data[i];

      if (data instanceof String) {
        if (data.includes("Third-party cookie will be blocked.")) return false;

        message.data[i] = data.replaceAll(/(?<=((https|http):\/\/)?.{1,64}(\..{1,64})?\..{1,64}\/)([\S]+)/gm, "[REDACTED]");
      }
    }

    return message;
  }

  public initialize() {
    if (this._initialized) throw new Error("WatchDog is already initialized!");
    this._initialized = true;

    crashReporter.start({ uploadToServer: false });

    log.transports.console.format = "[{processType}][{level}]{text}";
    log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}][{processType}][{level}]{text}";
    log.eventLogger.format = "Electron event {eventSource}#{eventName} observed";

    log.hooks.push((message, transport) => {
      if (transport !== log.transports.file) return message;

      return this.sanitizeMessage(message);
    });

    log.errorHandler.startCatching({
      showDialog: false,
      onError: async ({ error, processType, versions }) => {
        if (processType === "renderer") return;

        log.info("Unhandled error caught in application!");
        this._applicationState = WatchDogApplicationState.Crashed;

        log.info("Running crash callbacks for application cleanup");
        for (const crashCallback of this.eventCallbacks["crash"]) {
          try {
            await crashCallback();
          } catch (callbackError) {
            log.warn("An error occurred while running a crash callback and could indicate improper application cleanup");
            log.error(callbackError);
          }
        }

        let result = 1; // Default to Exit

        const dialogMessage =
          `Environment Details:\n    ${versions.app}\n    ${versions.electron}\n    ${versions.os}\n\n` +
          `Name: ${error.name}\nMessage: ${error.message}\nCause: ${error.cause ?? "Unknown"}\n\n` +
          `${error.stack}`;

        if (!app.isReady()) {
          dialog.showErrorBox(`YouTube Music Desktop App Crashed`, `Application crashed before ready\n\n${dialogMessage}`);
        } else {
          const options = ["Copy to Clipboard and Exit", "Exit"];
          if (!app.isPackaged) {
            options.push("Copy to Clipboard and Continue", "Continue");
          }

          result = dialog.showMessageBoxSync({
            title: "Error",
            message: "YouTube Music Desktop App Crashed",
            detail: dialogMessage,
            type: "error",
            buttons: options
          });

          // Copy to Clipboard
          if (result === 0 || result === 2) {
            clipboard.writeText(`YouTube Music Desktop App Crashed\n\n${dialogMessage}`);
          }
        }

        // Exit
        if (result === 0 || result === 1) {
          app.exit(1);
        }
      }
    });

    log.info("WatchDog initialized");
  }

  public on(event: WatchDogEvent, callback: () => void) {
    this.eventCallbacks[event].push(callback);
  }

  public off(event: WatchDogEvent, callback: () => void) {
    const index = this.eventCallbacks[event].indexOf(callback, 0);
    if (index > -1) this.eventCallbacks[event] = this.eventCallbacks[event].splice(index, 1);
  }
}

export default new WatchDog();
