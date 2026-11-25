
# YTMD Listen Together System Tests

Playwright Electron tests exercise the real compiled Electron Main process, IPC channel authorization, and live Vue renderer windows (`WebContentsView`).

## Running

1. Package or build the app first:
   ```bash
   ./node_modules/.bin/electron-forge package
   ```
2. Run the system test suite:
   ```bash
   pnpm test:system
   ```
   Or directly:
   ```bash
   ./node_modules/.bin/playwright test
   ```

## Environment Hooks (`YTMD_E2E_MODE=1`)

- `YTMD_TEST_USER_DATA_DIR`: isolates Electron `userData` storage per test instance so multiple Electron apps can run concurrently.
- `YTMD_E2E_MODE=1`: skips auto-updater network checks / dev splash delay and exposes `globalThis.__ytmdE2E` (`serviceHost`, `listenTogetherService`, `mainWindow`, `listenTogetherView`, `ytmViewManager`) for deterministic inspection and event simulation without hitting external YouTube servers.
- `YTMD_E2E_ALLOW_PACKAGED=1`: allows launching the packaged Linux binary in `out/` when `.vite/main/index.cjs` is not present.
