# ADR-0005: Reuse existing open-source components where they fit

- Status: accepted (the user's wish, 2026-10-05; admissibility ruled R-76 and R-47 extended for the CLI archive,
  2026-10-05; the fit with the specifications is checked when they are read)
- Date: 2026-10-05
- Deciders: the user through the register for admissibility; the lead for the fit
- Scope: Dev Containers; the server lifecycle and tunnels of every resolver
- Requirements: the Dev Containers decision issues on server download and proposed API (F-1402, F-1403); R-47 and R-68
  (server distribution and licence gate); the Remote - Tunnels specifications; `AGENTS.md` (what may be read)

## Context

The user does not want the wheel rebuilt. Two existing components do a large part of what two of the extensions
must do:

1. **The dev container CLI** (`@devcontainers/cli`, MIT): reads `devcontainer.json`, resolves features and
   templates, builds images, creates and starts containers, runs lifecycle commands, and is the reference
   implementation of the open dev container specification (containers.dev).
2. **The editor's own command-line interface**, published by VSCodium per release (for example
   `vscodium-cli-darwin-arm64-1.135.06055.tar.gz`; the source is the `cli/` crate of VS Code OSS, MIT): it downloads
   and starts the server on a machine, serves it over a tunnel or a local port, and is how Remote - Tunnels connects.

Both are open source under MIT and neither is the reference extension. The clean-room rules forbid the reference
extensions' own code and files; they do not by themselves forbid an MIT library that the reference happens to
use as well. Admitting one as a dependency and as reading material is still a change to what the clean side may
open, which is the user's decision through the register.

## Decision

1. **Dev Containers uses `@devcontainers/cli` as a dependency** for everything the specification delegates to the
   dev container specification: configuration parsing, features, image build, container create and start, lifecycle
   hooks, `devcontainer up`/`exec`/`read-configuration`. The extension owns what the CLI does not: the editor side
   (commands, pickers, views, the remote authority, the server install into the container, port forwarding, the
   recovery and error flows the specs name). The CLI is driven as a library or as a spawned program; the component
   view decides, and the conformance cases decide whether its observable behaviour matches the recorded one.
2. **The editor's CLI: suspended for Tunnels, pending the user's decision (2026-10-06).** Reading the `cli/` crate
   showed it has no client relay mode and persists every token it is given, so it cannot meet F-8902; the options
   (an upstream client mode, the dev tunnels library in a detached helper under a scoped ADR-0004 exception, or
   native OpenSSH over a WebSocket bridge) are with the register. The earlier text follows for the record.
   **The editor's CLI serves Remote - Tunnels only.** Scoped 2026-10-06 after the specs were read: Remote-SSH
   installs every templated server source as one archive and never runs the CLI (F-3902 rule 5), and WSL and
   Dev Containers install the server themselves through the host channel; so the CLI is not a launcher for the
   resolvers. For Tunnels the local relay is the tunnel executable the running editor ships (`tunnelApplicationName`
   in its bin folder, F-8902); the family downloads no CLI (ADR-0006 decision 3). The alternative, the dev tunnels
   client library, is excluded because it carries a JavaScript SSH implementation (ADR-0004). The CLI's sign-in
   must take the editor's `vscode.authentication` token without storing its own (F-8902); how is area A's design,
   read from `[cli]`.
3. **Admissibility (R-76)**: the clean side may depend on both and read their source and documentation, cited
   `[devcontainers-cli] path` and `[cli] path`. The `cli/` crate is part of VS Code OSS, already allowed as `[oss]`;
   `@devcontainers/cli` is MIT open source distinct from the reference extensions. The wall stays around the
   `ms-vscode-remote.*` and `ms-vscode.*` extension packages and the dirty rooms. The editor CLI archive is fetched
   like the server archive, from the product's own download location per `product.json` (R-47 extended).

## Options considered

| Option | For | Against |
|---|---|---|
| Reuse both (proposed) | Large, maintained, specification-grade code is not rewritten; the dev container specification is followed by construction | The extension's behaviour is bound to the CLI's; version pinning and a licence/update story per release; conformance may show differences from the recorded reference behaviour that we cannot change in the CLI |
| Reuse the CLI as a spawned program only | Smallest coupling; the CLI's own releases | Startup cost per operation; output parsing |
| Rebuild in the extension | Full control | Months of work on a solved problem; the user rules it out |

## Consequences

- The Dev Containers container view is drawn around the CLI's command surface; the traceability matrix marks which
  feature ids are satisfied by the CLI and which by our code.
- The server-lifecycle library (ADR-0002's `lib-server` candidate) is designed around the editor's CLI where the
  specs allow; where a spec's observable behaviour differs from what the CLI does, the spec wins and the design says
  how.
- Open until the specifications are read: whether F-1402/F-1403 and the Tunnels specs are compatible with each
  component; which CLI version pins to which editor version; how a VSCodium CLI archive is fetched, verified and cached.

## Check

The register's ruling on admissibility; `AGENTS.md` updated; the traceability matrix shows the split; dependency
versions pinned and listed by `check-licences`.
