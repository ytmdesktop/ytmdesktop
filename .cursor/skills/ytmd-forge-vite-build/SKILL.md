---
name: ytmd-forge-vite-build
description: Explains ytmdesktop’s Forge+Vite multi-target build (main/preloads/renderer), dev vs packaged path differences, sourcemaps/debugging, and release pipeline commands/artifacts. Use when changing build config, preload entries, packaging, or CI workflows.
---

# ytmdesktop Forge + Vite build and packaging

## Key anchors

- **Forge config**: `forge.config.ts`
- **Vite configs**: `viteconfig/**`
- **CI workflows**: `.github/workflows/*`
- **Builder config resolution**: `.scripts/resolve-builder-config.mjs`
- **Build/Release docs**: `docs/Workflows.md`

## Multi-target build mental model

This repo builds multiple targets via the Forge Vite plugin:

- **Main**: `src/main/index.ts` (target: `main`)
- **Preloads**: multiple entrypoints (target: `preload`)
- **Renderer**: one bundle with multiple HTML entrypoints (window pages) for chunk sharing

`forge.config.ts` is the authoritative mapping from entry → vite config → target.

## Dev vs packaged runtime differences

- **Dev** (`yarn start`): renderer served from Vite dev server; preloads and main are built then Electron launches.
- **Packaged**: renderer and preloads are loaded from packaged output; assets may be read from `process.resourcesPath`.

When changing asset loading or preload paths, verify both environments.

## Source maps + debugging

- Keep stack traces usable in both main and renderer (especially for Sentry/crash reporting).
- If you change Vite/Forge output settings, verify sourcemaps still map to TS sources.

## Release pipeline mental model

Commands:

- `yarn start` → `electron-forge start` (dev)
- `yarn package` → `electron-forge package` (packaged app dir)
- `yarn make` → `electron-forge make` (installers/artifacts)
- `yarn publish` / CI tag flow uses `publish:dry` then `publish:fromdry`

CI:

- `.github/workflows/quality.yml`: lint/test/format checks
- `.github/workflows/build.yml`: build artifacts
- `.github/workflows/publish.yml`: tag-based release publish

