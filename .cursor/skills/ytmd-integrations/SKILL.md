---
name: ytmd-integrations
description: Documents ytmdesktop third-party integrations (Notion/Figma/Last.fm/Discord/Sentry/crash reporter) focusing on API usage patterns, retries/timeouts, rate limiting, secrets handling, and observability. Use when adding or extending integrations or changing telemetry/error handling.
---

# ytmdesktop Integrations

## Key anchors

- **Main integrations**: `src/main/integrations/**`
- **Shared configs**: `src/shared/*.config.ts`
- **Sentry integrations**: `src/main/integrations/sentry/**`, `src/renderer/integrations/sentry/**`

## API client usage + rate limiting

- Prefer explicit timeouts, retries with backoff, and API-specific rate limiting.
- Handle user-configured keys/tokens carefully (validate presence/format; clear error messages).

## Secrets handling

- Never log raw tokens/API keys.
- Prefer redaction in logs/telemetry; include only safe identifiers.
- Use Electron safeStorage where appropriate for sensitive tokens stored locally.

## Observability

- Capture failures with enough context to debug (operation name, status, retry count, safe IDs).
- Avoid leaking secrets/PII in Sentry breadcrumbs, logs, or crash reports.

