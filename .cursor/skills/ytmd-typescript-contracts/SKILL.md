---
name: ytmd-typescript-contracts
description: Establishes TypeScript conventions for shared contracts (IPC/API payloads) across main/renderer/companion, module boundaries, and where runtime validation is required even with TS types. Use when adding IPC channels, shared state fields, or API payloads.
---

# ytmdesktop TypeScript contracts and boundaries

## Key anchors

- **Shared types/config**: `src/shared/**`
- **Store schemas**: `src/shared/store/schema.ts`
- **Renderer IPC store wrappers**: `src/renderer/store-ipc/**`
- **Window API typings**: `src/renderer/@types/global.d.ts`
- **Main IPC handlers**: `src/main/index.ts`
- **Companion server schemas**: `src/main/integrations/companion-server/api-shared/**`

## Goal: avoid “stringly typed” contracts

This repo currently uses string literal IPC channel names (`"target:action"`). To keep this safe and evolvable:

- Put **payload shapes** in `src/shared/**` when they cross boundaries.
- Keep **`window.ytmd` method signatures** accurate in `src/renderer/@types/global.d.ts`.
- Prefer exposing capabilities as **typed functions** over passing “bags of unknown”.

## Module boundaries

- **`src/shared/**`**: safe to import from both main and renderer (no Electron-only APIs).
- **`src/main/**`**: main process only (Electron/Node allowed).
- **`src/renderer/**`**: renderer only (Vue/UI; no Node/Electron except via preload).

## IPC contract workflow (recommended)

When adding/changing an IPC interaction:

1. **Define contract types** in `src/shared/**` (payload, return type, event args).
2. **Expose a typed method** via preload (`contextBridge.exposeInMainWorld("ytmd", …)`).
3. **Add/adjust `global.d.ts`** so `window.ytmd` reflects the new API.
4. **Implement handler in main** with sender + payload validation.
5. **Update call sites in renderer** to use `window.ytmd.*` (avoid raw `window.ipcRenderer` for new code).

## Runtime validation vs compile-time (where validation is mandatory)

Even if TS types exist, validate at runtime when inputs are:

- **IPC payloads** coming from a renderer process (treat renderer as untrusted)
- **HTTP requests** in the companion server (use TypeBox schemas)
- **Socket.IO handshake/auth** (token present, valid session)
- **Any data derived from the web view** (YTM site internals can change)

## Patterns to prefer

- **Explicit mapping** from upstream/internal formats to your public/stable formats (see `player-state-store` mapping logic).
- **Narrow union types** for commands (TypeBox unions in companion server).
- **Allow-lists** for any channel/script execution requests.

