---
name: ytmd-plugin-system
description: Documents ytmdesktop plugin system lifecycle, persistence, builtin plugins, and stable plugin API boundaries. Use when modifying PluginManager behavior, adding/modifying builtin plugins, or evolving plugin settings and migrations.
---

# ytmdesktop Plugin system

## Key anchors

- **Plugin manager**: `src/main/integrations/plugins/**`
- **Builtin plugins**: `src/main/integrations/plugins/builtin/**`
- **SSOT plugin lifecycle diagram**: `docs/Workflows.md`

## Lifecycle + persistence

- Plugins are registered (builtins) and configured via a persisted settings store (plugins.json under userData).
- Startup typically: register → load settings → auto-enable → `onAppReady`.
- Runtime: enable/disable and settings changes flow through IPC (e.g. `plugins:toggle`, `plugins:updateSetting`).

## Designing stable plugin APIs

- Plugins should not reach into application internals directly.
- Prefer stable contracts:
  - app-level events/state (playerStateStore, memoryStore)
  - explicit IPC requests handled by main
  - YTM integration scripts delivered via allow-listed script execution paths

## Migrations

- If plugin settings schema changes, provide migration logic rather than breaking existing user configs.

