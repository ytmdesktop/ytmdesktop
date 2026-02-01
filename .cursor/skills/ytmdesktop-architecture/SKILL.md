---
name: ytmdesktop-architecture
description: Teaches this repo's Electron/Vue/Forge architecture, main-renderer-preload boundaries, IPC conventions, YTM bridge, companion server, state stores, and build pipeline. Use when adding features, fixing bugs, or onboarding to the ytmdesktop codebase.
---

# ytmdesktop Architecture

## Quick start

- **SSOT for flows and diagrams**: [docs/Workflows.md](docs/Workflows.md)
- **Main process entry**: [src/main/index.ts](src/main/index.ts)
- **Preload bridges**: [src/renderer/windows/main/preload.ts](src/renderer/windows/main/preload.ts), [src/renderer/windows/settings/preload.ts](src/renderer/windows/settings/preload.ts), [src/renderer/windows/authorize-companion/preload.ts](src/renderer/windows/authorize-companion/preload.ts), [src/renderer/ytmview/preload.ts](src/renderer/ytmview/preload.ts)
- **Build config**: [forge.config.ts](forge.config.ts), [viteconfig/](viteconfig/)

## Electron boundaries

- **Main process**: Node/Electron APIs, windows/views, IPC handlers, integrations, `conf` persistence. Code in `src/main/**`.
- **Renderer**: Vue UI only. No direct Node/Electron; all cross-process communication via preload bridge.
- **Preload**: Runs in isolated context; has `contextBridge` and `ipcRenderer`. Exposes a **minimal** API on `window.ytmd` (and currently `window.ipcRenderer` for legacy use).

**Rules:**
- Prefer adding new capabilities as typed methods on `window.ytmd` rather than new raw IPC channel usage from renderer.
- Main process IPC handlers must validate sender (e.g. `event.sender === mainWindow.webContents`) where it matters.
- Do not disable `contextIsolation` or enable `nodeIntegration` in renderer. Sandbox is enabled.

## Window and BrowserView composition

- **Main window**: BrowserWindow (frameless). Contains chrome (titlebar) and a reserved area for the YTM BrowserView.
- **YTM view**: BrowserView loading music.youtube.com; added to main window, bounds set on resize (e.g. y offset 36 for titlebar).
- **Lifecycle**: Create main window → create YTM BrowserView → load YTM URL; on `ytmView:recreate`, cleanup (remove listeners, destroy webContents) then create again.
- **Focus**: `ytmView:switchFocus` toggles focus between main window webContents and YTM view webContents. Handlers restrict which senders can trigger this.

**Failure modes:** Listener/timer leaks on window or webContents; retaining references to destroyed BrowserView/webContents. When changing lifecycle code, audit for `removeListener` / `clearInterval` / nulling refs.

## IPC design

- **Channel naming**: `target:action` or `target:action:${id}` (e.g. `mainWindow:minimize`, `ytmView:videoProgressChanged`, `companionAuthorization:result:${requestId}`).
- **Fire-and-forget**: `ipcRenderer.send` + `ipcMain.on`. Use for UI actions, state pushes, one-way notifications.
- **Request/response**: `ipcRenderer.invoke` + `ipcMain.handle`. Use when renderer needs a return value (e.g. `app:getVersion`, `memoryStore:get`, `plugins:getList`).
- **Typing**: No central IPC channel enum yet. Define payload/event types in `src/shared/**` and keep [src/renderer/@types/global.d.ts](src/renderer/@types/global.d.ts) in sync with `window.ytmd`. When adding a new channel, add types for payloads and (if exposed on `ytmd`) the preload method signature.
- **Validation**: TypeScript is not enough. Validate IPC payloads in main (shape, bounds) before using them; for HTTP/API use TypeBox schemas in companion server api-shared.

## Security model

- **contextIsolation**: true. Preload is the only bridge.
- **Sandbox**: true for renderer and BrowserView.
- **Remote module**: Disabled (FusesPlugin in forge.config.ts).
- **Exposed surface**: Prefer narrow `window.ytmd` methods over broad `window.ipcRenderer` for new code. Validate IPC inputs in main; avoid passing raw user/network data to privileged APIs.

## Build and packaging

- **Forge + Vite**: One main build, four preload builds, one renderer bundle (multi-HTML). See [forge.config.ts](forge.config.ts) VitePlugin `build` and `renderer` entries.
- **Outputs**: Main → `.vite/main/index.js`. Preloads → `.vite/renderer/windows/*/preload.js` and `.vite/renderer/windows/ytmview/preload.js`. Renderer → `.vite/renderer/` (shared chunks).
- **Dev vs packaged**: Dev uses Vite dev server for renderer; packaged uses file protocol and `__dirname`/`process.resourcesPath` for assets. Asset path logic in main branches on `NODE_ENV === "development"`.
- **Commands**: `yarn start` (dev), `yarn package` (app dir), `yarn make` (installers), `yarn publish` (build + publish to GitHub). CI: [.github/workflows/build.yml](.github/workflows/build.yml), [.github/workflows/publish.yml](.github/workflows/publish.yml), [.github/workflows/quality.yml](.github/workflows/quality.yml).

## YTM BrowserView bridge

- **Preload** [src/renderer/ytmview/preload.ts](src/renderer/ytmview/preload.ts): Hooks YTM store, injects scripts from `src/renderer/ytmview/scripts/*.script.js`, forwards events to main via IPC (`ytmView:*`).
- **Stable events** (signals contract): e.g. `ytmView:loaded`, `ytmView:videoProgressChanged`, `ytmView:videoStateChanged`, `ytmView:videoDataChanged`, `ytmView:storeStateChanged`, `ytmView:createPlaylistObserved`, `ytmView:deletePlaylistObserved`. Main process updates `playerStateStore` from these; see [docs/Workflows.md](docs/Workflows.md) for the propagation diagram.
- **Resilience**: Feature detection, retries with backoff, throttling (e.g. progress), safe try/catch in listeners so one failure does not break the bridge. Prefer defensive checks over brittle selectors when YTM DOM/API changes.

## Companion server

- **Location**: [src/main/integrations/companion-server/](src/main/integrations/companion-server/). Fastify + Socket.IO; listens on `0.0.0.0:9863`.
- **API**: REST under `/api/v1` (auth, state, command, playlists). TypeBox schemas in [companion-server/api-shared/schemas.ts](src/main/integrations/companion-server/api-shared/schemas.ts). Validate all request bodies with schemas.
- **Auth**: Request code → user approves in a BrowserWindow → token issued and stored (encrypted via Electron safeStorage). Socket.IO namespace `/api/v1/realtime` authenticates on connect via handshake token.
- **Realtime**: Main process subscribes to `playerStateStore` stateChanged; server broadcasts `state-update` to connected clients. Rate limiting and error shapes are standardized; see api-shared.

## Integrations (third-party)

- **Locations**: [src/main/integrations/](src/main/integrations/) (notion, figma, last-fm, discord-presence, sentry, crash-reporter, etc.). Config/shared types in [src/shared/](src/shared/) (e.g. notion.config.ts, sentry.config.ts).
- **Patterns**: Retries, timeouts, rate limiting; user-configured keys/tokens; observability without logging secrets (redact tokens in logs).

## Plugin system

- **Manager**: [src/main/integrations/plugins/index.ts](src/main/integrations/plugins/index.ts). Builtins registered on construction; settings in `conf` (plugins.json in userData).
- **Lifecycle**: loadPluginSettings → autoEnablePlugins → onAppReady; at runtime `plugins:toggle` / `plugins:updateSetting` via IPC. On app close, onAppClose.
- **API boundary**: Plugins should use events and state contracts (e.g. playerStateStore, memoryStore) rather than reaching into internals. Integration scripts for YTM view are requested via `ytmView:getIntegrationScripts` and run via `ytmView:executeScript`.

## State and persistence

- **Canonical player state**: [src/main/player-state-store/index.ts](src/main/player-state-store/index.ts). Updated only from YTM IPC (`ytmView:videoProgressChanged`, etc.). Emits `stateChanged`; single source of truth for playback state.
- **Mirror for integrations**: [src/main/memory-store/index.ts](src/main/memory-store/index.ts). Main process copies `playerStateStore` state into `memoryStore.set("ytm", { player: state })` so companion and other integrations read from one place. Do not write player state directly to memoryStore; always flow through playerStateStore.
- **Persisted settings**: `conf` (electron-store) with schema in [src/shared/store/schema.ts](src/shared/store/schema.ts). For migrations/versioning, consider a version field and one-off migration steps on load.

## Reliability and debugging

- **Memory/leaks**: [docs/MemoryLeak*.md](docs/) and [src/main/utils/memory-monitor.ts](src/main/utils/memory-monitor.ts). Avoid retaining webContents/windows; remove IPC and event listeners on teardown; clear intervals/timeouts.
- **Errors**: Sentry in main and renderer; unhandled errors/rejections in renderer are forwarded to main via `renderer:unhandledError` / `renderer:unhandledRejection`. Add context (e.g. breadcrumbs) without leaking PII/tokens.

## Testing and CI

- **Vitest**: [vitest.config.ts](vitest.config.ts). Use for pure logic, state transforms, schema validation. Existing examples: [src/main/utils/weak-cache.test.ts](src/main/utils/weak-cache.test.ts). For Electron-adjacent code, prefer testing the logic in isolation (e.g. transform functions) rather than full process.
- **CI**: quality.yml (lint/test), build.yml (make artifacts), publish.yml (tag-based publish). See [docs/Workflows.md](docs/Workflows.md) for pipeline overview.

## When changing code

- **IPC/API contract changes**: Update types in `src/shared/**` and preload/global.d.ts; ensure main and renderer (and companion clients) stay in sync.
- **Window/View lifecycle**: Audit listener and timer cleanup; avoid stale refs.
- **New state field**: Add to playerStateStore (and schema if persisted); update YTM → main → memoryStore propagation; update companion/API shape if exposed.
- **New preload API**: Add to `contextBridge.exposeInMainWorld("ytmd", { ... })` and to `src/renderer/@types/global.d.ts` Window.ytmd.
