import { StoreSchema } from "~shared/store/schema";
import Service from "../service";
import ConfigStore from "../configstore";
import WatchDog from "../watchdog";
import { DependencyConstructor } from "~shared/types";

function shallowEqual<T extends Record<string, unknown>>(obj1: T, obj2: T): boolean {
  return Object.keys(obj1).length === Object.keys(obj2).length && Object.keys(obj1).every(key => Object.hasOwn(obj2, key) && obj1[key] === obj2[key]);
}

export default class StateManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [ConfigStore, WatchDog];

  private currentState: StoreSchema["state"];
  private diskWriteTimer: NodeJS.Timeout = null;
  private diskStale = false;
  private stateUpdates = 0;
  private panicked = false;

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public override onPreInitialized() {}

  public onInitialized() {
    if (this._initialized) throw new Error("StateManager is already initialized!");
    this._initialized = true;
  }

  public override onPostInitialized() {
    const configStore = this.getDependency(ConfigStore);
    const watchDog = this.getDependency(WatchDog);

    this.currentState = configStore.get("state");
    watchDog.on("crash", () => {
      this.panic();
    });
  }

  public override onTerminated() {
    this.forceWrite();
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
      const configStore = this.getDependency(ConfigStore);
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
