# Project Workflows (Generic → Detailed)

This document explains how this project runs and ships, starting at a system level and drilling down into the concrete event/data flows used in the codebase.

## Big picture

At runtime this is an **Electron** app with:

- **Main process**: owns windows/views, IPC routing, background integrations, persistence (`conf`), and the embedded YouTube Music view.
- **Renderer processes**: Vue UI for the main window + settings + authorization window.
- **BrowserView (YouTube Music)**: loads `music.youtube.com` and is “bridged” into the app via a dedicated preload that injects scripts and forwards player state back to the main process.

### System context diagram

```mermaid
flowchart TB
  user([User]) --> app[YouTube Music Desktop App]

  subgraph electron[Electron Runtime]
    main[Main process<br/>src/main/index.ts]
    mw[Main window<br/>BrowserWindow + Vue renderer]
    sw[Settings window<br/>BrowserWindow + Vue renderer]
    aw[Authorize Companion window<br/>BrowserWindow + Vue renderer]
    ytmv[YouTube Music view<br/>BrowserView]
  end

  app --> main
  main --> mw
  main --> sw
  main --> aw
  main --> ytmv

  ytmv --> ytmweb[(music.youtube.com)]
  main --> companion[Companion Server<br/>Fastify + Socket.IO<br/>:9863]
  companion --> clients[(Remote clients)]

  main --> updates[(GitHub Releases<br/>autoUpdater feed)]
  main --> sentry[(Sentry)]
  main --> lastfm[(Last.fm)]
  main --> discord[(Discord Presence)]
  main --> notion[(Notion)]
  main --> figma[(Figma)]
```

### Process model (what runs where)

```mermaid
flowchart LR
  subgraph MP[Main process]
    idx[src/main/index.ts]
    pss[src/main/player-state-store]
    integ[src/main/integrations/*]
    plugins[src/main/integrations/plugins]
  end

  subgraph RP1[Renderer: main window]
    vue1[src/renderer/windows/main/*]
    pre1[src/renderer/windows/main/preload.ts]
  end

  subgraph RP2[Renderer: settings window]
    vue2[src/renderer/windows/settings/*]
    pre2[src/renderer/windows/settings/preload.ts]
  end

  subgraph RP3[Renderer: authorize companion window]
    vue3[src/renderer/windows/authorize-companion/*]
    pre3[src/renderer/windows/authorize-companion/preload.ts]
  end

  subgraph BV[BrowserView: YouTube Music]
    ypre[src/renderer/ytmview/preload.ts]
    scripts[src/renderer/ytmview/scripts/*.script.js]
  end

  idx <--> |IPC| pre1
  idx <--> |IPC| pre2
  idx <--> |IPC| pre3
  idx <--> |IPC| ypre
  ypre --> |inject| scripts
  ypre <--> |DOM + YTM internals| ytm[(music.youtube.com)]
  idx --> pss
  idx --> integ
  idx --> plugins
```

## Build & release workflows (generic)

This repo uses **Electron Forge** + the **Forge Vite plugin**.

- **Dev run**: `yarn start` → `electron-forge start`
- **Package**: `yarn package` → `electron-forge package`
- **Make installers/artifacts**: `yarn make` → `electron-forge make`
- **Publish**: `yarn publish` (or the CI tag workflow uses `publish:dry` then `publish:fromdry`)

### Build pipeline (local + CI)

```mermaid
flowchart TD
  dev[Developer / CI runner] --> yarn[yarn]
  yarn --> forge[electron-forge]
  forge --> vite[Vite (Forge Vite plugin)]

  vite --> mainBuild[Build main<br/>entry: src/main/index.ts<br/>out: .vite/main]
  vite --> preloadBuild[Build preloads<br/>entries: windows/*/preload.ts + ytmview/preload.ts<br/>out: .vite/renderer/...]
  vite --> rendererBuild[Build renderers<br/>inputs: src/renderer/windows/*/index.html<br/>out: .vite/renderer]

  forge --> make[Make artifacts<br/>Squirrel/ZIP/DEB/RPM]
  make --> outdir[out/make/...]
```

### CI workflows (GitHub Actions)

```mermaid
flowchart TD
  push[push / pull_request] --> buildWF[.github/workflows/build.yml]
  tags[push tag v*] --> publishWF[.github/workflows/publish.yml]

  buildWF --> make1[yarn make --arch x64/arm64]
  make1 --> artifacts[Upload build artifacts]

  publishWF --> dry[yarn publish:dry --arch x64/arm64]
  dry --> fromDry[yarn publish:fromdry]
  fromDry --> ghrel[GitHub Release assets]
```

## Deployment “builder config” resolution

Some build runners use `builder.config*.json` to locate a companion server (`serverUrl`) and related settings. Resolution is performed by `.scripts/resolve-builder-config.mjs`.

### Config selection logic

```mermaid
flowchart TD
  start([Start]) --> cfgFile{BUILDER_CONFIG_FILE set?}
  cfgFile -- Yes --> useExplicit[Use that path]
  cfgFile -- No --> env{NODE_ENV}
  env -- production --> prod[builder.config.production.json]
  env -- staging --> stag[builder.config.staging.json]
  env -- other/undefined --> local[builder.config.local.json]

  prod --> resolve[Resolve serverUrl]
  stag --> resolve
  local --> resolve

  resolve --> override{BUILDER_SERVER_URL set?}
  override -- Yes --> serverUrl[serverUrl = BUILDER_SERVER_URL (ensure trailing /)]
  override -- No --> expand[Expand ${VAR} and ${VAR:-default}]
  expand --> validate{Valid URL?}
  validate -- Yes --> serverUrl
  validate -- No --> fallback[Fallback: http://localhost:9863/]

  serverUrl --> write[Write builder.config.resolved.json]
  write --> done([Done])
```

## Runtime workflows (generic)

### App startup lifecycle (high level)

```mermaid
sequenceDiagram
  participant OS as OS
  participant E as Electron
  participant M as Main process (src/main/index.ts)
  participant MW as Main window renderer (Vue)
  participant YV as BrowserView: YTM
  participant YP as YTM preload (src/renderer/ytmview/preload.ts)

  OS->>E: Launch app
  E->>M: app.on("ready")
  M->>MW: createMainWindow()
  M->>YV: createYTMView() (BrowserView)
  M->>YP: preload runs (contextIsolation)
  YP->>YV: load music.youtube.com + inject scripts
  YP->>M: ipcRenderer.send("ytmView:loaded")
  M->>MW: mainWindow.addBrowserView(ytmView) + setBounds
```

### Window & view composition (main window + embedded BrowserView)

```mermaid
flowchart TB
  subgraph MW[Main BrowserWindow]
    chrome[Titlebar overlay / window controls]
    ui[Vue UI<br/>src/renderer/windows/main/Index.vue]
    slot[Reserved area for BrowserView]
  end

  subgraph BV[BrowserView]
    ytm[YouTube Music Web App]
    preload[ytmview preload<br/>src/renderer/ytmview/preload.ts]
  end

  ui -->|IPC via window.ytmd| mainIPC[ipcMain handlers]
  preload -->|IPC: ytmView:* events| mainIPC
  mainIPC -->|state| store[playerStateStore + memoryStore]
```

## Runtime workflows (detailed)

### 1) Main window UI ↔ main process (IPC bridge)

The main window’s preload exposes a typed-ish `window.ytmd` bridge that forwards UI actions to `ipcMain` handlers (window controls, opening settings, focusing, update checks, etc.).

```mermaid
sequenceDiagram
  participant UI as Vue UI (renderer)
  participant P as Main preload (src/renderer/windows/main/preload.ts)
  participant M as Main process (src/main/index.ts)

  UI->>P: window.ytmd.openSettingsWindow()
  P->>M: ipcRenderer.send("settingsWindow:open")
  M->>M: createOrShowSettingsWindow()

  UI->>P: window.ytmd.ytmViewRecreate()
  P->>M: ipcRenderer.send("ytmView:recreate")
  M->>M: cleanupYTMView(); createYTMView()
```

### 2) YTM view hook + player state propagation

The YouTube Music BrowserView preload (`src/renderer/ytmview/preload.ts`) does three core jobs:

- **Hook** the internal YTM store (via a `Reflect.decorate` interception).
- **Inject** scripts (`src/renderer/ytmview/scripts/*.script.js`) to subscribe to player/store events.
- **Forward** changes to the main process via IPC (`ytmView:*` channels).

Main process updates the canonical `playerStateStore`, and also mirrors it into `memoryStore` (used by integrations like the companion server).

```mermaid
sequenceDiagram
  participant Y as music.youtube.com
  participant YP as ytmview preload
  participant S as injected scripts (*.script.js)
  participant M as Main process
  participant PSS as playerStateStore
  participant MS as memoryStore

  YP->>Y: Hook YTM store (window.__YTMD_HOOK__.ytmStore)
  YP->>S: Inject hookplayerapievents.script.js etc.

  S->>YP: detect progress/state/metadata/store changes
  YP->>M: ytmView:videoProgressChanged(progress)
  M->>PSS: updateVideoProgress(progress)

  YP->>M: ytmView:videoStateChanged(state)
  M->>PSS: updateVideoState(state)

  YP->>M: ytmView:videoDataChanged(videoDetails, playlistId, album, likeStatus, hasFullMetadata)
  M->>PSS: updateVideoDetails(...)

  YP->>M: ytmView:storeStateChanged(queue, likeStatus, volume, muted, adPlaying)
  M->>PSS: updateFromStore(...)

  PSS-->>M: stateChanged(state) (event emitter)
  M->>MS: set("ytm", { player: state })
```

### 3) Companion Server: API + auth + realtime updates

The companion server runs inside the main process as a Fastify server with Socket.IO:

- **Host/port**: `0.0.0.0:9863`
- **HTTP API**: under `/api/v1/*`
- **Realtime namespace**: `/api/v1/realtime`

#### 3.1 Auth flow (request code → request token → store token)

```mermaid
sequenceDiagram
  participant C as Remote client
  participant CS as Companion Server (Fastify)
  participant M as Main process
  participant AW as Authorization window (BrowserWindow)
  participant U as User

  C->>CS: POST /api/v1/auth/requestcode (appId, appName, appVersion)
  CS-->>C: { code }

  C->>CS: POST /api/v1/auth/request (appId, code)
  CS->>AW: Create authorization window (preload + args)
  AW->>U: Prompt approve/deny
  U-->>AW: Approve or deny
  AW-->>CS: ipcMain once companionAuthorization:result:{requestId}
  alt approved
    CS-->>C: { token }
  else denied / timeout
    CS-->>C: 4xx error (AuthorizationDenied/TimeOut/etc.)
  end
```

#### 3.2 State & command flow (HTTP)

```mermaid
sequenceDiagram
  participant C as Remote client
  participant CS as Companion Server
  participant M as Main process
  participant YV as BrowserView (YTM)
  participant PSS as playerStateStore

  C->>CS: GET /api/v1/state (Authorization: Bearer <token>)
  CS->>PSS: getState()
  CS-->>C: transformed player + video + playlistId

  C->>CS: POST /api/v1/command { command, data }
  CS->>YV: ytmView.webContents.send("remoteControl:execute", ...)
  CS-->>C: 204 No Content
```

#### 3.3 Realtime state updates (websocket)

```mermaid
sequenceDiagram
  participant C as Remote client
  participant WS as Socket.IO (/api/v1/realtime)
  participant PSS as playerStateStore

  C->>WS: Connect with handshake.auth.token
  WS-->>C: connection accepted (or UnauthenticatedError)

  loop on PlayerState changes
    PSS-->>WS: stateChanged(state)
    WS-->>C: emit "state-update" (transformed state)
  end
```

### 4) Plugin lifecycle (built-in plugins)

Plugins are managed by `PluginManager` (`src/main/integrations/plugins/index.ts`) using a dedicated `conf` store (`plugins.json` in `userData`).

```mermaid
flowchart TD
  subgraph Startup
    start([App starts]) --> pmNew[PluginManager created]
    pmNew --> reg[registerBuiltinPlugins()]
    reg --> load[loadPluginSettings() from Conf store]
    load --> auto[autoEnablePlugins()]
    auto --> ready[pluginManager.onAppReady()]
  end

  subgraph Plugin Enable/Disable
    toggle[User toggles plugin in UI] --> ipc[ipcMain.handle("plugins:toggle")]
    ipc --> en{Toggle enabled?}
    en -- "Enable" --> onEnable[plugin.onEnable()\nsetEnabled(true)\npersist to settings]
    en -- "Disable" --> onDisable[plugin.onDisable()\nsetEnabled(false)\npersist to settings]
  end
```

### 5) Error reporting & crash reports (renderer → main → crash reporter)

The main window preload installs global handlers for uncaught errors and unhandled promise rejections and forwards them to the main process. The main process then routes them into the crash reporter integration.

```mermaid
sequenceDiagram
  participant R as Renderer (window)
  participant P as Renderer preload
  participant M as Main process
  participant CR as Crash reporter integration

  R-->>P: window.onerror / unhandledrejection
  P->>M: ipcRenderer.send("renderer:unhandledError", payload)
  M->>CR: reportError(Error, context)

  P->>M: ipcRenderer.send("renderer:unhandledRejection", payload)
  M->>CR: reportError(Error, context)
```

## “Where do I look?” index

- **Main runtime entry**: `src/main/index.ts`
- **Player state canonical store**: `src/main/player-state-store/index.ts`
- **Main window preload bridge**: `src/renderer/windows/main/preload.ts`
- **YTM BrowserView preload (hook/injection/IPC)**: `src/renderer/ytmview/preload.ts`
- **YTM injected scripts**: `src/renderer/ytmview/scripts/*.script.js`
- **Companion server**: `src/main/integrations/companion-server/*`
- **Plugins**: `src/main/integrations/plugins/*`
- **Build config**: `forge.config.ts`, `viteconfig/*`, `.github/workflows/*`
