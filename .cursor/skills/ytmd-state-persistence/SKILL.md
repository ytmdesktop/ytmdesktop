---
name: ytmd-state-persistence
description: Documents canonical vs mirrored state (playerStateStore vs memoryStore), persisted settings via conf (schema and migrations), and end-to-end propagation for new state fields (YTM → main → renderer/companion). Use when changing state shapes, persistence, or consistency rules.
---

# ytmdesktop State + persistence

## Key anchors

- **Canonical player state**: `src/main/player-state-store/index.ts`
- **Mirrored state**: `src/main/memory-store/index.ts`
- **Persisted settings schema**: `src/shared/store/schema.ts`
- **SSOT propagation diagrams**: `docs/Workflows.md`

## Canonical vs mirrored state

- **Canonical**: `playerStateStore` is the single source of truth for player/playback state.
  - Updated from `ytmView:*` IPC signals only.
  - Emits a `stateChanged` event on updates.
- **Mirror**: `memoryStore` is a convenient read model for integrations and renderer.
  - Main mirrors the canonical state into `memoryStore.set("ytm", { player: state })`.
  - Do not write player state directly to `memoryStore` from elsewhere.

## Persistence (conf)

- Persisted settings are stored via `conf` with a TS schema in `src/shared/store/schema.ts`.
- If you add/rename settings, consider a versioned migration step so existing installs upgrade safely.

## Adding a new state field end-to-end

1. Identify the source (YTM bridge signal vs derived value).
2. Add the field + mapping/update methods in `playerStateStore`.
3. Ensure the main process propagates/mirrors updates into `memoryStore`.
4. If exposed externally (companion server), update the API transform + schemas/types.
5. Update renderer typings (`window.ytmd`/stores) if the field is used in UI.

