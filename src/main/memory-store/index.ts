import EventEmitter from "events";

export default class MemoryStore<T extends Record<string, unknown>> {
  private state: Record<string, unknown>;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.state = {};
    this.eventEmitter.on("error", error => {
      console.log("MemoryStore EventEmitter threw an error", error);
    });
  }

  public get(key: string): unknown {
    return this.state[key as string];
  }

  public set(key: string, value: unknown) {
    const oldState = structuredClone(this.state);
    this.state[key as string] = value;
    this.eventEmitter.emit("stateChanged", this.state, oldState);
  }

  public onStateChanged(callback: (newState: T, oldState: T) => void) {
    this.eventEmitter.addListener("stateChanged", callback);
  }

  public removeOnStateChanged(callback: (newState: T, oldState: T) => void) {
    this.eventEmitter.removeListener("stateChanged", callback);
  }
}
