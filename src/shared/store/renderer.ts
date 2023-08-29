import { ipcRenderer } from "electron";

if (process.type !== "renderer") {
  throw new Error("This module can only be used from the renderer process");
}

export default class Store<TSchema> {
  public set(key: string, value?: unknown) {
    return ipcRenderer.send("settings:set", key, value);
  }

  public async get(key: keyof TSchema) {
    return await ipcRenderer.invoke("settings:get", key);
  }

  public reset(key: keyof TSchema) {
    return ipcRenderer.send("settings:reset", key);
  }

  public onDidAnyChange(callback: (newState: TSchema, oldState: TSchema) => void) {
    return ipcRenderer.on("settings:stateChanged", (event, newState, oldState) => {
      callback(newState, oldState);
    });
  }
}
