# Warning: This is untested entirely and vibed. I will put attention to this later but throwing it out there as is for anyone looking to experiment. You have been warned. 
## ------Here be Dragons------




# ytmd-listen-relay

Standalone, self-hostable blind WebSocket relay for YTMD Listen Together.
The relay forwards opaque E2EE frames (`RELAY_FRAME`) without inspecting payloads, track metadata, or client IPs in logs.

## Security & Limits

- **Ed25519 Host Authentication:** `HOST_CREATE` and `HOST_RESUME` require signing a per-connection server `HOST_CHALLENGE` nonce to prevent room hijacking during the 20s host grace window.
- **Admission & Room Cap:** Max `8` admitted peers per room (`1` Host + `7` Guests). Only Host-confirmed `RELAY_PEER_ADMITTED` guests count toward the cap; unauthenticated pending `GUEST_JOIN` sockets expire after `10s`.
- **Heartbeats & Expiry:** WebSocket `ping/pong` every `20s` reaps dead sockets; rooms expire after `10m` without a Host heartbeat or `20s` after Host disconnect without `HOST_RESUME`.
- **Rate Limiting:** `5` lookups/min/IP (HTTP & WebSocket upgrades), respecting `TRUST_PROXY`.

## Quick Start (Docker)

```bash
docker build -t ytmd-listen-relay .
docker run -d --name ytmd-listen-relay -p 8787:8787 -e TRUST_PROXY=true ytmd-listen-relay
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Quick Start (Node.js 22+)

```bash
pnpm install
pnpm build
TRUST_PROXY=false PORT=8787 pnpm start
```

Run typecheck and tests:

```bash
pnpm typecheck
pnpm test
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Listening TCP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TRUST_PROXY` | `false` | Set `true` or `1` behind a reverse proxy so `X-Forwarded-For` drives per-IP rate limiting |
| `RATE_LIMIT_MAX` | `5` | Max lookups/upgrades per IP per minute |
| `LOG_LEVEL` | `info` | Fastify JSON log level (`info`, `warn`, `error`, `silent`) |

## Reverse Proxy Setup

Always run behind TLS (`wss://`) when exposing the relay publicly, and set `TRUST_PROXY=true`.

### Nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

### Caddy

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```
