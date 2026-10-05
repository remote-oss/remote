# Architecture decision records

One file per decision, `NNNN-short-title.md`, copied from [0000-template.md](0000-template.md). Numbers are never
reused. An accepted ADR is changed only by a new ADR that supersedes it. Decisions that belong to the user (scope,
money, licensing, public identity) are recorded in the family register first; the ADR cites the D-xx or R-xx number
and does not re-decide it.

| ADR | Title | Status |
|---|---|---|
| — | none yet | |

Planned, in this order (titles may change):

1. Monorepo with one package per extension and per shared library (records D-48)
2. Language and toolchain
3. Packaging and bundling of the extensions and their libraries
4. Testing: the conformance runner as acceptance, unit tests, CI profiles
5. Error-reporting style
6. Logging and output channels
7. Identifier tables (D-14) and invented identifiers (R-27)
8. Use of proposed VS Code API
