import { StoreSchema } from "~shared/store/schema";
import configStore from "./config-store";
import Manager from "./manager";
import watchdog from "./watchdog";

function shallowEqual<T extends Record<string, unknown>>(obj1: T, obj2: T): boolean {
  return Object.keys(obj1).length === Object.keys(obj2).length && Object.keys(obj1).every(key => Object.hasOwn(obj2, key) && obj1[key] === obj2[key]);
}

class StateManager implements Manager {
  private currentState: StoreSchema["state"];
  private diskWriteTimer: NodeJS.Timeout = null;
  private diskStale = false;
  private stateUpdates = 0;
  private panicked = false;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public initialize() {
    if (this._initialized) throw new Error("StateManager is already initialized!");
    this._initialized = true;

    this.currentState = configStore.get("state");
    watchdog.on("crash", () => {
      this.panic();
    });
  }

  public updateState(partialState: Partial<StoreSchema["state"]>) {
    if (this.panicked) return;
    if (!this._initialized) return;

    const newState = { ...this.currentState, ...partialState };
    if (!shallowEqual(this.currentState, newState)) {
      this.currentState = newState;
      this.diskStale = true;
      this.stateUpdates++;
      if (this.diskWriteTimer) clearTimeout(this.diskWriteTimer);
      // If a significant amount of changes to the state happen then we just force write it immediately
      if (this.stateUpdates >= 512) {
        this.write();
      } else {
        this.diskWriteTimer = setTimeout(() => {
          this.write();
        }, 30 * 1000);
      }
    }
  }

  public forceWrite() {
    if (this.panicked) return;
    if (!this._initialized) return;

    if (this.diskWriteTimer) clearTimeout(this.diskWriteTimer);
    this.write();
  }

  private write() {
    if (this.panicked) return;

    if (this.diskStale) {
      configStore.set("state", this.currentState);
      this.diskStale = false;
      this.stateUpdates = 0;
    }
  }

  /**
   * Stops and prevents any state writing
   */
  private panic() {
    this.panicked = true;
    if (this.diskWriteTimer) clearTimeout(this.diskWriteTimer);
  }
}

export default new StateManager();
