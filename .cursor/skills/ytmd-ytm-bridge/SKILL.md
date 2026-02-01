---
name: ytmd-ytm-bridge
description: Documents ytmdesktop’s YTM BrowserView bridge (preload + injected scripts), resilience techniques, and event propagation via stable ytmView:* IPC signals into playerStateStore/memoryStore. Use when fixing YTM site breakages or adding new player metadata/state signals.
---

# ytmdesktop YTM BrowserView bridge

## Key anchors

- **YTM preload**: `src/renderer/ytmview/preload.ts`
- **Injected scripts**: `src/renderer/ytmview/scripts/*.script.js`
- **Main handlers + view lifecycle**: `src/main/index.ts`
- **State stores**: `src/main/player-state-store/index.ts`, `src/main/memory-store/index.ts`
- **SSOT diagrams**: `docs/Workflows.md`

## DOM/internals integration

The YTM BrowserView loads `music.youtube.com`. The preload + injected scripts:

- hook into YTM internals (store/player API),
- observe player and navigation signals,
- forward stable app-level events to main as `ytmView:*`.

## Stable event propagation (“signals contract”)

Treat `ytmView:*` IPC as a stable contract for the rest of the app. Typical signals include:

- `ytmView:loaded`
- `ytmView:videoProgressChanged`
- `ytmView:videoStateChanged`
- `ytmView:videoDataChanged`
- `ytmView:storeStateChanged`
- playlist observed events

Main consumes these and updates `playerStateStore` (canonical) and mirrors into `memoryStore` (for integrations/companion).

## Resilience techniques

- **Feature-detect** before using internal properties or DOM nodes.
- **Retry with timeout/backoff** when the page is still booting.
- **Throttle** high-frequency events (e.g. progress).
- **Isolate failures**: catch and log in the bridge without breaking the entire pipeline.
- **Avoid brittle selectors**; prefer stable store/player API hooks when available.

## Version drift handling

When YTM changes break the bridge:

1. Identify which assumption broke (DOM node, internal API name, store structure).
2. Add a fallback path (alternate selector/hook) and keep the event contract stable.
3. Guard risky behaviors behind feature detection so partial functionality still works.

