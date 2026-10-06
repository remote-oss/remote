# ADR-0007: The editor version floor is 1.139, and proposed API is pinned to it

- Status: accepted (the lead, 2026-10-06; raised only by a new ADR)
- Date: 2026-10-06
- Deciders: `remote-architect`
- Scope: all packages
- Requirements: constraint 33 (F-3903 rule 6: `engines.vscode` pinned to the versions the proposals were checked
  against), constraint 72 (`engines.vscode` is a build floor, not the reference's value), the conformance suites
  (recorded on VS Code 1.139.1), ADR-0002's open item

## Context

Every package declares `engines.vscode`. The specs were recorded against VS Code 1.139.1 and Insiders 1.140.0; the
conformance profiles run 1.139.1. Four extensions use proposed API (`resolvers`, `tunnels`, `contribViewsRemote`,
`extensionsAny`, `contribRemoteHelp`, `terminalDataWriteEvent`), whose declaration files change between editor
versions and are not covered by the stable API's compatibility promise. A floor below the recorded version would
promise behaviour nobody has observed; a floor above it would exclude the editor the suite runs.

## Decision

1. `engines.vscode` is `^1.139.0` in every extension package, set from one constant in the root configuration.
2. `@types/vscode` is pinned to the same minor; the proposed-API declaration files are taken from the VS Code OSS
   tag of that minor (`vscode-dts`) and committed per package next to the manifest that declares the proposal.
3. The floor is raised only by a new ADR, together with the suite's profiles, the pinned declarations and a run of
   every package's cases against the new version.
4. A package that needs an API newer than the floor does not raise the floor on its own: it waits for the ADR or
   finds a stable route within the floor.

## Options considered

| Option | For | Against |
|---|---|---|
| Floor = the recorded version, 1.139 (chosen) | Matches the suite and the specs' observations; the proposals are known to exist in that shape | Users on older editors cannot install; acceptable for a product that does not exist yet |
| The reference's own floors (older) | Wider reach on paper | Unobserved behaviour; proposals differ between versions; F-4003 BR-9 quotes a reference floor that no case checks |
| Latest stable at release time | Newest API | Moving target; breaks the recorded suite |

## Consequences

- The esbuild target of ADR-0002 (`NODE_TARGET`) is the Node.js version that VS Code 1.139 ships; the first coding
  worker sets the constant from `[oss]` and records the source.
- Explorer's and server's browser bundles target the same editor version's web runtime.
- The pack's engine floor (F-9001) follows this ADR per release.

## Check

`tools/check-layout` verifies that every extension manifest's `engines.vscode` equals the root constant and that a
package declaring `enabledApiProposals` carries the pinned declaration files; CI runs the suites on the floor's
editor.
