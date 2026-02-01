---
name: ytmd-reliability-debugging
description: Guides reliability/performance work in ytmdesktop: listener/timer leak awareness (Electron+BrowserView), safe logging/telemetry, and error reporting via Sentry/crash reporter. Use when investigating memory leaks, crashes, or adding diagnostics.
---

# ytmdesktop Reliability, performance, and debugging

## Key anchors

- **Leak docs**: `docs/MemoryLeakAnalysis-2024.md`, `docs/MemoryLeakFixes-Summary.md`, `docs/MemoryLeakTesting.md`
- **Memory monitor**: `src/main/utils/memory-monitor.ts`
- **Main process lifecycle**: `src/main/index.ts`
- **Sentry**: `src/main/integrations/sentry/**`, `src/renderer/integrations/sentry/**`

## Memory/leak awareness (high risk areas)

- `BrowserView`/`webContents` lifecycle (create/recreate)
- event listeners registered on `ipcMain`, `webContents`, windows
- intervals/timeouts in preloads, injected scripts, and main
- retaining references to destroyed windows/webContents

## Mitigation checklist

- Always remove listeners on teardown (`removeListener` / `off`).
- Clear timers (`clearInterval` / `clearTimeout`) and null references.
- Avoid long-lived closures capturing `BrowserView`/`webContents`.

## Error reporting

- Capture unhandled errors/rejections and route them through the repo’s crash reporting/Sentry patterns.
- Add debugging context (breadcrumbs/tags) without leaking secrets or tokens.

## Logging hygiene

- Do not log secrets (tokens, API keys, auth headers).
- Prefer structured, scoped logs with safe identifiers and operation context.

