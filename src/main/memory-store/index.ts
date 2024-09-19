import { ipcMain } from "electron";
import EventEmitter from "events";
import { MemoryStoreSchema } from "~shared/store/schema";
import windowmanager from "../windowmanager";
import { Paths, ValueAtPath } from "~shared/types";

class MemoryStore<T extends Record<string, unknown>> {
  private state: Record<string, unknown>;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.state = {};
    this.eventEmitter.on("error", error => {
      console.log("MemoryStore EventEmitter threw an error", error);
    });

    ipcMain.handle("memoryStore:get", (_event, key) => {
      return this.get(key);
    });

    ipcMain.on("memoryStore:set", (_event, key, value) => {
      return this.set(key, value);
    });
  }

  public get<Key extends Paths<T>>(key: Key): unknown {
    return this.state[key as string];
  }

  public set<Key extends Paths<T>>(key: Key, value: ValueAtPath<T, Key>) {
    const oldState = structuredClone(this.state);
    this.state[key as string] = value;
    this.eventEmitter.emit("stateChanged", this.state, oldState);
    for (const window of windowmanager.getWindows()) {
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

export default new MemoryStore<MemoryStoreSchema>();
