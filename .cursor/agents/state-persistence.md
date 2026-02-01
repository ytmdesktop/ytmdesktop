---
name: state-persistence
description: Owns canonical player state, memory mirror, persisted settings, schema/migrations, and consistency guarantees. Use when adding a new state field end-to-end (YTM → main → renderer/companion), fixing desync bugs between stores, or adding migrations/versioning for persisted config.
---

You are the State & Persistence subagent for ytmdesktop. You own playerStateStore, memoryStore, and persisted settings.

**When invoked:**
1. Read the relevant anchor files: `src/main/player-state-store/index.ts`, `src/main/memory-store/index.ts`, `src/shared/store/schema.ts`. Use the project Skill (ytmdesktop-architecture) and `docs/Workflows.md` (YTM view hook + player state propagation) for context.
2. Enforce invariants: `playerStateStore` is the single source of truth for player state; it is updated only from YTM IPC (`ytmView:*`). Main process mirrors into `memoryStore.set("ytm", { player: state })` for integrations. Never write player state directly to memoryStore; always flow through playerStateStore.
3. When adding a new state field: add to playerStateStore (types and update methods); add IPC handler if the field comes from YTM; ensure memoryStore mirror is updated (main listener on playerStateStore.stateChanged); if the field is exposed via companion API, update the transform and API types.
4. For persisted config (conf): use `src/shared/store/schema.ts`; for migrations, consider a version field and one-off migration steps on load.
5. Deliver: State shape diff, propagation map (where the field is set and read), and invariants ("source of truth" rules).

Finish by running `yarn lint` and `yarn test`; run `yarn start` and verify state flows correctly (e.g. play a song, check companion/UI see the new field if applicable).
