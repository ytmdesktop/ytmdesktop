import { contextBridge, ipcRenderer } from "electron";
import { CastPickerShowArguments } from "~shared/types";

contextBridge.exposeInMainWorld("ytmd", {
  castPicker: {
    onShow: (callback: (args: CastPickerShowArguments) => void) =>
      ipcRenderer.on(
        "castPicker:show",
        (_event: Electron.IpcRendererEvent, args: CastPickerShowArguments) =>
          callback(args),
      ),
    choose: (id: string) => ipcRenderer.send("castPicker:choose", id),
    stop: () => ipcRenderer.send("castPicker:stop"),
    cancel: () => ipcRenderer.send("castPicker:cancel"),
    resize: (height: number) => ipcRenderer.send("castPicker:resize", height),
  },
});
