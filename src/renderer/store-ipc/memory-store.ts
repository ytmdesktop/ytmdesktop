import { ipcRenderer } from "electron";

if (process.type !== "renderer") {
  throw new Error("This module can only be used from the renderer process");
}

export default class MemoryStore<TSchema> {
  public set(key: string, value?: unknown) {
    return ipcRenderer.send("memoryStore:set", key, value);
  }

  public async get(key: keyof TSchema) {
    return await ipcRenderer.invoke("memoryStore:get", key);
  }

  public onStateChanged(callback: (newState: TSchema, oldState: TSchema) => void) {
    return ipcRenderer.on("memoryStore:stateChanged", (event, newState, oldState) => {
      callback(newState, oldState);
    });
  }
}
