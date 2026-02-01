---
name: ytmd-testing-ci
description: Documents testing and CI/CD in ytmdesktop (Vitest strategy for pure logic/contracts, and GitHub Actions workflows for quality/build/publish). Use when adding tests, changing contracts, or modifying CI workflows.
---

# ytmdesktop Testing + CI/CD

## Key anchors

- **Vitest config**: `vitest.config.ts`
- **Example tests**: `src/main/utils/weak-cache.test.ts`
- **CI workflows**: `.github/workflows/quality.yml`, `.github/workflows/build.yml`, `.github/workflows/publish.yml`
- **Build/release docs**: `docs/Workflows.md`

## Vitest strategy

- Prefer unit tests for **pure logic**:
  - state transforms/mappers
  - schema validation behavior
  - utilities and helpers
- For Electron-adjacent behavior, test the pure parts (payload transforms, validation) rather than spinning up full Electron in tests unless you have a stable harness.

## Contract tests (recommended)

When changing IPC/API payloads:

- add tests that assert payload shapes match shared TS types / TypeBox schemas,
- ensure transforms handle null/undefined safely,
- cover backwards-compatible defaults if clients exist.

## GitHub Actions mental model

- **quality.yml**: checks (lint/test/format)
- **build.yml**: builds artifacts via `yarn make` across platform/arch matrix
- **publish.yml**: tag-based publishing (often dry-run then publish-from-dry-run)

