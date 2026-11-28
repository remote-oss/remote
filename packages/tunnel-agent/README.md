# tunnel-agent

The family's tunnel host agent: a program, not an extension, that a user runs on the machine they want to reach. It
signs in, registers the machine's tunnel with the family's relay, holds the tunnel's host leg, and serves the editor's
server to the Remote - Tunnels client through it. Its design is `docs/architecture/l3/tunnels/brief-agent.md`; its
build and releases are ADR-0016's.

It keeps its state in `~/.remote-oss-tunnel-agent/`, readable by its user only: the tunnel's record, the host's key and
the sign-in's credential. The relay's domain and the GitHub app it signs in with are shipped defaults, in the
`config.json` beside its code.

`tunnel-agent --version` prints its version. It has no update command and never updates itself.

## For maintainers

| | |
|---|---|
| Maintainers | daedalus |
| Kind | service (layout.md, rule 5) |
| Imports | `lib-identifiers` |
| Coverage exclusions | `src/main.ts`, which starts the agent |
