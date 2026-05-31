// Preload for the tray mini-player popover. Exposes a small, typed surface for reading
// live player state and sending playback commands (forwarded to the YTM view in main).
import { contextBridge, ipcRenderer } from "electron";
import type { PlayerState } from "~shared/player-state";

contextBridge.exposeInMainWorld("ytmd", {
  // Fetch the current state immediately when the popover opens (never wait for the next tick)
  requestPlayerState: (): Promise<PlayerState | null> => ipcRenderer.invoke("playerState:request"),
  // Live updates while the popover is open
  onPlayerState: (callback: (state: PlayerState) => void) => ipcRenderer.on("playerState:changed", (_event, state: PlayerState) => callback(state)),
  // Playback commands forwarded to remoteControl:execute on the YTM view
  sendCommand: (command: string, value?: unknown) => ipcRenderer.send("miniplayer:command", command, value),
  openSettings: () => ipcRenderer.send("miniplayer:openSettings"),
  toggleMainWindow: () => ipcRenderer.send("miniplayer:toggleMainWindow"),
  hide: () => ipcRenderer.send("miniplayer:hide")
});
