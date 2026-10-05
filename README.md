# remote

Clean-room reimplementation of the VS Code remote extensions, published as `remote-oss.remote-<x>` under the MIT
licence. One repository, one package per extension and per shared library.

Status: **architecture preparation.** There is no code yet. The design starts when the first-pass specifications of
all seven extensions are published.

| Path | What it holds |
|---|---|
| `AGENTS.md` | The clean-side rules. Read them before anything else. |
| `docs/architecture/` | The design: context, containers, components, traceability, build order. |
| `docs/adr/` | Architecture decision records. |
| `packages/` | One folder per extension and per shared library ([layout](docs/architecture/layout.md)). |
| `tests/conformance/` | The conformance runner and how the suites are run against our builds. |
| `tools/` | Repository tools (`spec-watch`, `check-layout`). |

The specifications and the conformance suites live in the seven repos `remote-oss/remote-<x>` until they move here.

These extensions are not Microsoft's products and are not affiliated with Microsoft.
