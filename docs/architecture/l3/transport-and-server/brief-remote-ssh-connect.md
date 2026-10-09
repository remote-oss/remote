# Coding brief: remote-ssh, the connect flow end to end — slice 1, build-order step 11

> Issued by `remote-architect` 2026-10-08; the PM allocates the seats. Design: `contracts.md` §7 (R1 pipeline, R2
> diagnostics, R3 pre-connection script, R4 platform decision) with the `remote-ssh` components in
> `l3/windows-and-explorer/components.md` (ssh.package, ssh.connect-flows, ssh.resolver-front, ssh.failure-ui,
> ssh.window-surfaces, ssh.companion-endpoints) and contracts §3 (how B's resolver host calls `connect`). Pure parts
> are cards: remote-ssh-00 (skeleton), remote-ssh-01 (manifest, waits for the identifier inventory), remote-ssh-02
> (typed input, picker model, window target). Depends on every library of slice 1 on main (lib-host, lib-product,
> lib-ssh with S3/S9/S10 and the askpass endpoint, lib-server V1–V8, lib-helper, lib-authority, lib-identifiers,
> lib-standdown, lib-log, lib-forwarding W1/W2 for the window tunnel) and the harness. Binding: ADR-0002, 0003, 0004,
> 0006, 0007, 0008; R-79, R-83, R-86.

## Slice 1 scope (the 21 P0 rows): F-2001, F-3901, F-3903; F-2101, F-2102, F-2201, F-2202, F-2206, F-2301, F-2304,
F-2305, F-2306, F-2307, F-2501, F-2601; F-2401, F-2403, F-2409, F-3902; F-2502. Key authentication to a POSIX host;
prompts (F-2305–F-2307) land through the askpass endpoint and S7's minimal input surface; terminals and forwarding
beyond the window tunnel are slice 2.

## Tasks, in order

| Task | Content | Seat |
|---|---|---|
| connect-00 (Claude, #185) | The two bundled programs of `remote-ssh`: the connection helper (lib-ssh's `runConnectionHelper` over lib-helper's node environment) and the askpass program (the `rh-askpass-<16hex>` launcher's target), as esbuild entry points `src/programs/connection-helper.ts` → `dist/connection-helper.js` and `src/programs/askpass.ts` → `dist/askpass.js`, Node target, no `vscode` import (a test asserts the bundles contain none), both in the VSIX; `lib-helper` exports `nodeFilePort`; the extension's acquire request passes the bundled helper path as `script` and the askpass path to S3's options. Its own small PR, before connect-05's acceptance run; connect-02's pure pipeline takes the paths as inputs and does not wait for it | Claude (whoever is free) |
| connect-01 (Claude) | `ssh.package`: activation per F-2001 (stand-down first through lib-standdown with `opensshremotes.standingDown` or the inventory's final name; the family gate; registrations only after `serving`); the identifier table from the manifest; the log channel through lib-log (F-2003's content, R2 `recordResolve`, no secrets); `remoteHelp` rows with our URLs; the manifest from card remote-ssh-01 (or the skeleton plus the contributions this slice needs, if the inventory is late: say which in the PR) | Claude |
| connect-02 (Claude) | R1 `connection-pipeline`: the ordered run behind B's resolver: validate (lib-ssh `validateTarget`), R3 pre-connection script (attempt 1 only, detached, never killed; the confirmation and stored hash; `preconnectFailed`), S1 client lookup, R4 platform decision (`remote.SSH.remotePlatform` match and write rule; B's picker through `pickRemotePlatform`), S9 `acquire` (or S3 directly when the local server is off), V2 probe over S10, V3 plan, V6 gate, V4 transfer, V7 start (inside the host lock loop), W2 window tunnel through W1's port, `Connected` with address, token, extension-host environment, `tunnelFeatures`; phase events exactly `initializing`, `downloading`, `downloadingLocally`, `copyingWithScp`, `installing`, `settingUpTunnel`, `waitingForForwarding`, `serverDownloadPercent`; `Failed` with the closed kind list, `retryable` from kind and `isReconnection`, `userAlreadyNotified` only after R3's dialog, hints and diagnostics; `remoteCommandInEffect` decided here; every wait bounded by a policy value (R-79) ending in `Failed`; `cancel` only from teardown; a fresh connection per attempt after `transportLost` | Claude |
| connect-03 (Claude) | B's package parts: `ssh.resolver-front` (registers `ssh-remote` on lib-authority's host with the codec, non-cancellable, the connector = R1); `ssh.failure-ui` (the F-2601 dialog and F-2602's mitigation picker rendered from `Failed`; S027 for `licenceDeclined`; S030 for an empty reason; F-3902 rule 8's dialog for `noServerSource`/`invalidServerTemplate`; `handled` returned at once); `ssh.connect-flows` (the commands of F-2301/F-2302/F-2303 over card remote-ssh-02's pure parts and lib-authority's opener; `pickRemotePlatform`); `ssh.window-surfaces` (label formatter `workspaceSuffix`, the indicator entries of this slice, F-2502 open folder in the current or a new window) | Claude |
| connect-04 (card after connect-02) | R2 `storeHints` (the two newest records, F-2605) and the log-content formatter of F-2003 BR-6 as pure functions with tables | local worker |
| connect-05 (Claude, acceptance) | the slice's acceptance tests in the harness, named by AC: F-2301 (picker rows from a config with two hosts; typed `user@harness`), F-2501 (resolve to the container; the window's remote name), F-2502 (open folder current/new), F-2304 (phases in order; no Cancel), F-2601 (an unreachable TEST-NET host: the dialog with reason and hints within the bound), F-2101 (client missing: the dialog), F-2102 (two windows share one connection server; Kill Local Connection Server), F-2206 (the platform prompt when `remotePlatform` is unset, with the answer stored), F-2305–F-2307 (a password-protected key and a host key prompt through the askpass endpoint, answered by the harness adapter), F-2401/F-2403/F-2409 (already in lib-server's brief, run end to end here), F-3902 (a VSCodium product fixture resolves its template; genuine VS Code without a user template shows the no-source dialog) | Claude |

## Behaviour to get right

- No failure dialog from `connect`; the presenter renders; no dialog during reconnection.
- Every string shown is an id from the table, resolved by the package's l10n; no literal UI text in libraries.
- No telemetry; the server starts with `--telemetry-level off` (R-83); nothing of the process in shipped prose.
- The harness-only adapter swap is the single reader of the ADR-0008 switch in this package.

## Done

All acceptance tests of connect-05 green in CI against the sshd container (the D-63 coding gate for slice 1);
gates green; PR bodies answer R1–R6; the traceability matrix's 21 rows marked "built" with their test names; the
release gate (D-65: the 8-row recorded set, pilot F-2301) is the kit's run at QA.
