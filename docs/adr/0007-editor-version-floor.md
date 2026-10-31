# ADR-0007: The editor version floor is 1.125, the recorded version stays 1.139.1, and proposed API is pinned to the floor

- Status: accepted (the lead, 2026-10-06); amended 2026-10-20 by the user's instruction (D-102): the floor moves from
  1.139 to 1.125. Raised or lowered only by an amendment like this one.
- Date: 2026-10-06; amended 2026-10-20
- Deciders: `remote-architect`; the floor of 2026-10-20 is the user's
- Scope: all packages
- Requirements: constraint 33 (F-3903 rule 6: `engines.vscode` pinned to the versions the proposals were checked
  against), constraint 72 (`engines.vscode` is a build floor, not the reference's value), the conformance suites
  (recorded on VS Code 1.139.1), ADR-0002's open item

## Context

Every package declares `engines.vscode`. The specs were recorded against VS Code 1.139.1 and Insiders 1.140.0; the
conformance profiles run 1.139.1. The extensions use proposed API (`resolvers`, `tunnels`, `contribViewsRemote`,
`contribRemoteHelp`, `extensionsAny`, `terminalDataWriteEvent`, `terminalDimensions`, `workspaceTrust`,
`contribEditSessions`), whose declaration files change between editor versions and are not covered by the stable
API's compatibility promise.

Two versions matter, and until 2026-10-20 they were the same one:
- **the floor:** the oldest editor a user may install on (`engines.vscode`);
- **the recorded version:** the editor the specs observed and the conformance suite runs.

A floor below the recorded version promises behaviour nobody has observed. On 2026-10-20 the user instructed a floor
of 1.125 (D-102), so that is now accepted, and the decisions below keep its cost small and visible.

**Measured on 1.125.0** ([oss] tags 1.125.0 and 1.139.1, 2026-10-20):
- **Proposals:** all nine proposal declaration files are byte-identical at the two tags.
- **Types:** the whole repository typechecks against `@types/vscode` 1.125.0 (`tsc --build`, 33 projects, no
  error), so no code uses a stable API newer than 1.125.
- **Node:** 1.125.0's tag names Electron 42.3.0 (`.npmrc`), and the released build reports Electron 42.2.0
  (proteus, 2026-10-20). Both ship Node.js 24.15.0, and so does its server (`remote/.npmrc`; Electron's `DEPS`).
- **Core differences** in what the extensions touch (all in [oss] `src/vs/workbench/contrib/remote/browser/`):
  - the Forwarded Ports status item focuses the Ports view on 1.125 and toggles it on 1.139 (`remoteExplorer.ts`);
  - automatic forwarding lacks the filter for a remapped tunnel's local end (`isCandidateRemappedTunnelLocalEndpoint`,
    `remoteExplorer.ts`);
  - the Ports view's protocol context is always `https` on 1.125 (`tunnelView.ts`, a core bug fixed later).

  `tunnelModel.ts`, `remoteExplorerService.ts`, `nativeExtensionService.ts`, `extHostExtensionService.ts` and
  `remoteAuthorityResolver.ts` are unchanged.

## Decision

1. **The floor is 1.125.** `engines.vscode` is `^1.125.0` in every extension package and every acceptance runner
   package, set from one constant in the root configuration (`EDITOR_ENGINE`, `tools/editor-floor.ts`).
2. **`@types/vscode` is pinned to the newest published version at or below the floor:** today `1.125.0`. Code can
   then use nothing newer than the floor. If a stable API introduced in the floor's own version is needed, the
   floor's own `vscode.d.ts` from the VS Code OSS tag replaces the package, by a note to this ADR.
   - **The proposed-API declaration files** are taken from the VS Code OSS tag of the floor (`vscode-dts`, today
     1.125.0). They're committed per package, next to the manifest that declares the proposal. When the extensions
     only import a library's adapters, they go in the library whose code compiles against the proposal (lib-authority
     today). An extension that calls a proposed member itself gets its own copy (ruled 2026-10-08, #168).
   - Since #201 (tooling-06, merged 2026-10-09) consumers compile libraries by their declarations. So an extension
     needs its own `vscode-dts` copy only for the rule's own reason: its manifest declares the proposal, or its code
     calls a proposed member (remote-ssh does both). The copies are byte-identical vendored data, not code.
3. **The recorded version stays 1.139.1:** the specs' observations, the conformance profiles, the recorded gate
   and the acceptance launches (`EDITOR_VERSION`). A `core` tag in the coverage catalogue describes core on the
   recorded version.
4. **A floor run proves what it can of the floor.** The daily genuine job runs over the versions [1.139.1, 1.125.0],
   with the editor version taken from the job and limited to those two (D-97 allows genuine VS Code in CI). VSCodium
   has no 1.125 release: its stable tags go from 1.121 to 1.126.
   - **On 1.125.0 it covers:**
     - install at `^1.125.0`;
     - activation with the proposals (the genuine launch). The `ssh-no-proposals` launch runs at the recorded
       version only. Genuine 1.125.0 let Remote - SSH resolve with the proposals not enabled, so the "without the
       proposals" case doesn't occur there as it does on 1.139.1 (tooling-69, #1402). Why it doesn't is measured
       in tooling-72 (#1385). Until that's settled, the floor run makes no claim about the no-proposals path;
     - a connect up to the declined licence;
     - the Remote Explorer's rows without a connect, through the genuine launch's explorer row (tooling-69).
   - **It doesn't cover a connect, a container open or the Ports view.** Those need the server of genuine 1.125.0's
     own commit, which is Microsoft's server under its licence. The genuine job runs on the opposite terms: nothing
     accepts that licence for the user, and no server comes from the publisher. VSCodium's server doesn't match a
     1.125.0 client.
   - **Connect coverage on the floor** would need a Code - OSS 1.125.0 build (the client and its server, built from
     the MIT tag). That's a card of its own and the user's call.

   Rows asserting core's own rendering stay on the recorded version, and the three core differences above aren't
   failures of ours. A row that asserts one of those surfaces names the version it describes.
5. **The floor moves only by an amendment** like this one, raising or lowering it, together with the pinned
   declarations, the floor run on the new floor, and the measurements above taken again.
6. **A package that needs an API newer than the floor** doesn't move the floor on its own. It waits for the
   amendment, or finds a stable route within the floor.

## Options considered

| Option | For | Against |
|---|---|---|
| Floor = the recorded version, 1.139 (chosen 2026-10-06) | Matches the suite and the specs' observations; the proposals are known to exist in that shape | Users on older editors can't install |
| Floor 1.125, recorded version 1.139.1, a floor run (the user's, 2026-10-20) | Wider reach; the proposals, the types and the Node target are measured equal | Core behaviour between 1.125 and 1.139 isn't observed by the specs; the floor run reaches no connect without a Code - OSS 1.125.0 build |
| The reference's own floors (older) | Wider reach on paper | Unobserved behaviour; proposals differ between versions; F-4003 BR-9 quotes a reference floor that no case checks |
| Latest stable at release time | Newest API | Moving target; breaks the recorded suite |

## Consequences

- **The esbuild target of ADR-0002** (`NODE_TARGET`) is the Node.js version the floor ships, `node24`, recorded in
  `tools/editor-floor.ts`. Both 1.125.0 (Electron 42, Node.js 24.15.0) and 1.139.1 (Electron 43.6.0, Node.js
  24.20.0) ship Node.js 24, so the target is unchanged.
- **The browser bundles** of the Explorer and the server target the floor's web runtime. Their `es2022` target
  (`tools/build.ts`) is below what Electron 42 supports, so it's unchanged.
- **The pack's engine floor** (F-9001) follows this ADR per release.
- **The specs' observations stay** on 1.139.1. Which criteria cite the three surfaces above is asked of the dirty
  side as pointers, so their `core` tags can name the version.

## Check

- **The constant:** `tools/check-layout` verifies that every extension manifest's `engines.vscode` equals the root
  constant, and that a package declaring `enabledApiProposals` carries the pinned declaration files.
- **The recorded suite** runs on 1.139.1.
- **The floor run** (decision 4) runs the genuine launch, with the explorer, on 1.125.0. `ssh-no-proposals` runs on 1.139.1.
