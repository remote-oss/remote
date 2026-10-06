# Architecture decision records

One file per decision, `NNNN-short-title.md`, copied from [0000-template.md](0000-template.md). Numbers are never
reused. An accepted ADR is changed only by a new ADR that supersedes it. Decisions that belong to the user (scope,
money, licensing, public identity) are recorded in the family register first; the ADR cites the D-xx or R-xx number
and does not re-decide it.

| ADR | Title | Status |
|---|---|---|
| [0002](0002-language-and-toolchain.md) | TypeScript, pnpm workspaces and esbuild for every package | accepted (D-49) |
| [0003](0003-coding-standards.md) | Google TypeScript style, enforced by lint and coverage gates | accepted |
| [0004](0004-ssh-transport-native-openssh.md) | The SSH transport is the native OpenSSH client | accepted (D-51) |
| [0005](0005-reuse-of-open-source-components.md) | Reuse existing open-source components (dev container CLI, the editor CLI) | accepted (R-76) |

Planned, in this order (titles may change):

1. Monorepo with one package per extension and per shared library (records D-48)
2. Language and toolchain
3. Packaging and bundling of the extensions and their libraries
4. Testing: the conformance runner as acceptance, unit tests, CI profiles
5. Error-reporting style
6. Logging and output channels
7. Identifier tables (D-14) and invented identifiers (R-27)
8. Use of proposed VS Code API
