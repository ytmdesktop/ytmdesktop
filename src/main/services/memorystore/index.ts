import { ipcMain } from "electron";
import EventEmitter from "events";
import { DependencyConstructor, Paths, ValueAtPath } from "~shared/types";
import Service from "../service";
import AppWindowManager from "../windowmanager";

export default class MemoryStore<T extends Record<string, unknown>> extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [AppWindowManager];

  private state: Record<string, unknown> = {};
  private eventEmitter = new EventEmitter();

  public override onPreInitialized() {}
  public override onInitialized() {
    ipcMain.handle("memoryStore:get", (_event, key) => {
      return this.get(key);
    });

    ipcMain.on("memoryStore:set", (_event, key, value) => {
      return this.set(key, value);
    });
  }
  public override onPostInitialized() {}
  public override onTerminated() {}

  public get<Key extends Paths<T>>(key: Key): unknown {
    return this.state[key as string];
  }

  public set<Key extends Paths<T>>(key: Key, value: ValueAtPath<T, Key>) {
    const oldState = structuredClone(this.state);
    this.state[key as string] = value;
    this.eventEmitter.emit("stateChanged", this.state, oldState);
    for (const window of this.getDependency(AppWindowManager).getWindows()) {
      window.ipcBroadcast("memoryStore:stateChanged", this.state, oldState);
    }
  }

  public onStateChanged(callback: (newState: T, oldState: T) => void) {
    this.eventEmitter.addListener("stateChanged", callback);
  }

  public removeOnStateChanged(callback: (newState: T, oldState: T) => void) {
    this.eventEmitter.removeListener("stateChanged", callback);
  }
}
