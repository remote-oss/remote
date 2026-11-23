# tunnel-relay

The family's tunnel relay: a service, not an extension, that is wire-compatible with the dev tunnels service for
the Remote - Tunnels client and the family's host agent. It serves the dev tunnels management API at `https://cp.<domain>`
and the relay's two WebSocket legs. Its contract is `docs/architecture/l3/tunnels/brief-relay.md`; its protocol source is
`[dev-tunnels]` (ADR-0014); its language and build are ADR-0015's.

It runs on the repository's Node and is configured from its environment:

| Variable | What it holds |
|---|---|
| `RELAY_DOMAIN` | The domain of `cp.<domain>` |
| `RELAY_PORT` | The port it listens on |
| `TLS_CERT`, `TLS_KEY` | Its certificate and key |
| `RELAY_STORE` | The SQLite file of its store |
| `RELAY_CLUSTER` | Its one cluster id |

`node packages/tunnel-relay/src/main.ts` starts it.
