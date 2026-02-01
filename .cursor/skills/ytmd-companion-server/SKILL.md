---
name: ytmd-companion-server
description: Documents the ytmdesktop companion server (Fastify + Socket.IO) including route/plugin structure, auth flow, realtime state fanout, and schema-driven validation with TypeBox. Use when changing API routes/events, auth/token handling, or realtime behavior.
---

# ytmdesktop Companion Server

## Key anchors

- **Integration root**: `src/main/integrations/companion-server/**`
- **API shared (schemas/errors/auth)**: `src/main/integrations/companion-server/api-shared/**`
- **Shared types**: `src/shared/integrations/companion-server/types.ts`
- **SSOT flow diagrams**: `docs/Workflows.md`

## Fastify fundamentals in this repo

- The server runs inside the Electron main process.
- Routes are registered via plugins (v1 API under `/api/v1`).
- Errors are standardized via api-shared helpers.

## Auth flow (request-code → user approval → token)

1. Client requests a short-lived code.
2. Client requests authorization using the code.
3. App opens an authorization BrowserWindow; user approves/denies.
4. On approve, a token is issued and stored (encrypted via Electron safeStorage).

## Socket.IO realtime

- Namespace: `/api/v1/realtime`
- Authenticate on connect (handshake token).
- Broadcast stable events (e.g. `state-update`) sourced from `playerStateStore` updates.
- Consider backpressure/fanout when adding high-frequency events.

## Schema-driven APIs (TypeBox)

- Define request body schemas in `api-shared/schemas.ts`.
- Validate all inputs; never rely on TS types alone.
- Keep error shapes consistent and avoid leaking secrets in logs.

