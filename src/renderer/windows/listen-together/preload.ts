import { contextBridge } from "electron";
import { createListenTogetherBridge } from "../../preload/listen-together";

contextBridge.exposeInMainWorld("ytmd", {
  listenTogether: createListenTogetherBridge({
    dispatch: true,
    togglePanel: true,
    closePanel: true,
  }),
});
