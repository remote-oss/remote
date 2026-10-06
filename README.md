# remote

Extensions that give Code - OSS and the editors built on it remote development: SSH hosts, containers, WSL and
tunnels, with a Remote Explorer and `ssh_config` language support. Published as `remote-oss.remote-<x>` under the
MIT licence. One repository, one package per extension and per shared library.

Status: **in development**; the repository is private until the first release (`docs/adr/0008`).

| Path | What it holds |
|---|---|
| `AGENTS.md` | The clean-side rules. Read them before anything else. |
| `docs/architecture/` | The design: context, containers, components, traceability, build order. |
| `docs/adr/` | Architecture decision records. |
| `packages/` | One folder per extension and per shared library ([layout](docs/architecture/layout.md)). |
| `tests/conformance/` | The conformance runner and how the suites are run against our builds. |
| `tools/` | Repository tools (`spec-watch`, `check-layout`). |

The specifications and the conformance suites live in the seven repos `remote-oss/remote-<x>` until they move here;
`docs/architecture` and `docs/adr` are private working documents (ADR-0008) and leave this repository before it
is published.
