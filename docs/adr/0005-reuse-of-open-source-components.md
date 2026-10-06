# ADR-0005: Reuse existing open-source components where they fit

- Status: proposed (the user's wish, 2026-10-05; admissibility under the clean-room rules and the fit with the
  specifications are to be confirmed before acceptance)
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

## Decision (proposed)

1. **Dev Containers uses `@devcontainers/cli` as a dependency** for everything the specification delegates to the
   dev container specification: configuration parsing, features, image build, container create and start, lifecycle
   hooks, `devcontainer up`/`exec`/`read-configuration`. The extension owns what the CLI does not: the editor side
   (commands, pickers, views, the remote authority, the server install into the container, port forwarding, the
   recovery and error flows the specs name). The CLI is driven as a library or as a spawned program; the component
   view decides, and the conformance cases decide whether its observable behaviour matches the recorded one.
2. **The editor's CLI is the remote-side launcher candidate** wherever a design needs the server started on a
   machine: Remote - Tunnels by definition, and Remote-SSH and WSL where the specs' observable behaviour allows it.
   Per R-47 the binary follows the running editor's product: VSCodium's CLI with VSCodium, VS Code's with VS Code, from
   the product's own download location, with the R-68 licence gate for Microsoft-licensed artefacts. The design states,
   per resolver, which steps the CLI performs and which the extension performs itself.
3. **Admissibility**: once the register admits them, the two components' source and documentation become allowed
   reading, cited as `[cli] path` and `[devcontainers-cli] path`; `AGENTS.md` lists them. Until then nobody on the
   clean side opens their source.

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
