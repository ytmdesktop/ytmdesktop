---
name: ytmd-vue-renderer-ui
description: Guides Vue 3 renderer UI work in ytmdesktop (window composition, components, store-driven updates from main, debounced IPC actions, and Electron renderer performance constraints). Use when changing UI in main/settings/authorize windows or renderer components.
---

# ytmdesktop Vue 3 renderer UI

## Key anchors

- **Windows**: `src/renderer/windows/**`
- **Components**: `src/renderer/components/**`
- **Renderer IPC stores**: `src/renderer/store-ipc/**`
- **Preload API**: `src/renderer/windows/*/preload.ts`
- **Window typings**: `src/renderer/@types/global.d.ts`

## Component composition

- Prefer reusable components in `src/renderer/components/**` and thin window-level pages in `src/renderer/windows/**`.
- Keep settings UX cohesive: plugin toggles/settings, update/crash settings, integration settings.

## State + side effects

- Treat main process as source of truth for app state/settings; renderer reacts to updates from IPC-backed stores (store-ipc + memoryStore).
- Debounce user actions that trigger IPC (volume sliders, toggles, repeated buttons) to avoid IPC spam and UI jank.

## Electron renderer constraints

- Avoid blocking the renderer with synchronous heavy work.
- Minimize re-render loops and high-frequency watchers.
- Prefer async patterns and move privileged/background work to main via `window.ytmd`.

## IPC usage from the renderer

- Prefer `window.ytmd.*` for new features and keep typings updated in `src/renderer/@types/global.d.ts`.
- If legacy `window.ipcRenderer` exists, treat it as deprecated; do not expand its usage.

