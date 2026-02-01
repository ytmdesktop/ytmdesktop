---
name: ytmd-electron-architecture
description: Documents ytmdesktop Electron architecture (main vs renderer vs preload), BrowserWindow+BrowserView composition, IPC patterns, security boundaries, and dev vs packaged runtime differences. Use when changing windows/views, preloads, IPC, or Electron security settings.
---

# ytmdesktop Electron architecture

## SSOT + key anchors

- **SSOT diagrams/workflows**: `docs/Workflows.md`
- **Main entry + IPC handlers**: `src/main/index.ts`
- **Preload bridges**: `src/renderer/windows/*/preload.ts`, `src/renderer/ytmview/preload.ts`
- **Window API typings**: `src/renderer/@types/global.d.ts`

## Process boundaries (what can touch what)

- **Main process (`src/main/**`)**: owns BrowserWindows/BrowserViews, Electron/Node APIs, IPC handlers, persistence (`conf`), integrations.
- **Renderer (`src/renderer/windows/**`)**: Vue UI only; treat it as untrusted (no Node/Electron APIs).
- **Preload (`src/renderer/**/preload.ts`)**: the only intended bridge; exposes a constrained API via `contextBridge.exposeInMainWorld("ytmd", …)`.

### Rules of thumb

- **Prefer `window.ytmd.*`**: When UI needs privileged work, add a typed method on `window.ytmd` that forwards to a specific IPC channel.
- **Avoid raw `window.ipcRenderer` in new code**: this repo currently exposes a broad `window.ipcRenderer` for legacy convenience; do not expand this surface. Prefer narrowing over time.
- **Validate sender and payload in main**: IPC handlers should verify `event.sender` is allowed (e.g. only the main window renderer can minimize the main window) and validate payload shape/bounds.

## BrowserWindow + BrowserView composition

### Main window + embedded YTM BrowserView

- The main app window is a **BrowserWindow** hosting Vue chrome.
- The YouTube Music view is a **BrowserView** attached to that window and placed inside a reserved content area.

### Bounds + focus

- On resize, the BrowserView bounds are updated (watch for titlebar height offsets).
- Focus switching is handled via `ytmView:switchFocus` (main webContents ↔ BrowserView webContents).

### Lifecycle (create/recreate)

- View recreation typically follows: **cleanup old** (remove listeners, destroy webContents, null refs) → **create new** → **load URL** → **re-bind listeners**.
- When touching lifecycle code, explicitly audit:
  - `ipcMain` listeners
  - `webContents` event handlers
  - timers/intervals/timeouts
  - retained references that prevent GC

## IPC design (Electron-side)

### Channel naming

- Convention is `target:action` or `target:action:${id}` (e.g. `mainWindow:minimize`, `ytmView:videoDataChanged`, `companionAuthorization:result:${requestId}`).

### When to use on vs handle

- **Fire-and-forget**: `ipcRenderer.send` + `ipcMain.on`
  - UI actions, one-way notifications, streaming updates (e.g. playback progress).
- **Request/response**: `ipcRenderer.invoke` + `ipcMain.handle`
  - when renderer needs a return value (version, settings reads, computed values).

### Payload typing + validation

- TypeScript helps at build time only. IPC payloads still need runtime validation in main (shape, bounds, allowlists).
- Shared payload types should live under `src/shared/**` (and `global.d.ts` should reflect what is exposed on `window.ytmd`).

## Security model

- Keep `contextIsolation: true` and `sandbox: true` for BrowserWindow and BrowserView.
- Do not enable `nodeIntegration` in renderers.
- Keep the exposed preload surface small; avoid passing raw user/network data directly into privileged APIs.

## Dev vs packaged runtime differences

- **Dev**: renderer is served by Vite dev server (Forge Vite plugin). Paths and assets may resolve from source tree.
- **Packaged**: renderer loads from packaged files; assets commonly come from `process.resourcesPath` and other packaged locations.
- Treat path handling as environment-dependent; verify both dev and packaged paths when changing asset loading or window preload paths.

