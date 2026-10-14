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

## Tooling

Node.js (the version in `.node-version`) and pnpm (the version in `package.json`). From a fresh clone:

```sh
pnpm install --frozen-lockfile
pnpm check-layout && pnpm check-identifiers && pnpm check-public-surface && pnpm check-licences && pnpm lint:shell   # shellcheck
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:unit && pnpm dupes && pnpm dead && pnpm coverage
pnpm package
```

`pnpm identifiers` writes each extension's git-ignored `src/identifiers.generated.ts`. The scripts that read it
(`typecheck`, `lint`, `test:unit`, `build`, `dead`, `coverage`) run it first, and `package` runs `build` first, so
every script works on a cold tree. CI runs the same scripts.

`pnpm check-consumed` fails on a contributed setting, command or view that no production source consumes: it reads
the generated identifier tables, decides a reference with the TypeScript checker, finds the modules only tests
import with a production-mode knip run, and reports them against the one allowlist `tools/unconsumed-allowlist.json`,
whose entries name the key, the card that wires it, and its slice. On the tag of a release the check runs
`--consumed --release`, where every entry without a recorded decision must be wired already.

The specifications and the conformance suites live in the seven repos `remote-oss/remote-<x>` until they move here;
`docs/architecture` and `docs/adr` are private working documents (ADR-0008) and leave this repository before it
is published.
