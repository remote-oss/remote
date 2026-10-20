# Task card connect-81: SSH windows default `remote.autoForwardPortsSource` to `output` (F-2507 AC-20, 21, 22, 38)

Issue: #1146. Release 0.2, **priority** (hermes, 2026-10-20: first of the 0.2 product cards). Size: M. Builder: `task:claude`.
Spec: remote-oss/remote-ssh#65 (F-2507, `spec:reviewed`), §3.3 "Port source", §6.4, BR-8. Read it with plain
`gh issue view 65 -R remote-oss/remote-ssh`.

## 1. The defect, and what's on main (checked by daedalus, 2026-10-20)

An SSH window shows an auto-forwarded port nobody asked for on every connect: the server's own listener (for example
33767). Our resolver doesn't declare a port source, so core keeps its `process` default for
`remote.autoForwardPortsSource`. Core then scans the host's processes and forwards every loopback listener, our
server's included.

F-2507 §3.3 and BR-8: "the resolver declares the output source; VS Code core then uses `output` as the default of
`remote.autoForwardPortsSource` in that window only; a user value (`process`, `hybrid`, `output`) wins; local windows
keep core's `process` default; the user's settings file is never written."

How core does it, [oss] at 1.139.1: `ExtHostTunnelService.setTunnelFactory`
(`src/vs/workbench/api/common/extHostTunnelService.ts`) reads `candidatePortSource` from the
**`RemoteAuthorityResolver` object** registered for the window's authority, not from the resolve's result.
`MainThreadTunnelService.$setCandidatePortSource` (`src/vs/workbench/api/browser/mainThreadTunnelService.ts`) then
registers `{overrides: {'remote.autoForwardPortsSource': 'output'}}` as a default configuration once the remote
environment is up. That is a default for this window only, and nothing is written to a settings file. The field is
`candidatePortSource?: CandidatePortSource` in `packages/lib-authority/vscode-dts/vscode.proposed.resolvers.d.ts`
(enum `None = 0, Process = 1, Output = 2, Hybrid = 3`).

On main, `editorResolverOf` (`packages/lib-authority/src/resolver/vscode-resolver.ts`) builds that object with
`resolve` and, when the host has one, `getCanonicalURI`. It sets nothing else. Tunnels already go over the SSH
connection with origin "Remote - SSH": core's own factory carries them through the server connection (BR-1), the
default forwards are open (F-2507 AC-2, the `default-ports` launch), and the row "neither tunnel features nor a tunnel
factory" (BR-9) holds. That stays as it is. **Only the port source is missing.**

## 2. Product (lib-authority, remote-ssh)

1. `ResolverEditorOptions` (`vscode-resolver.ts`) gains
   `/** The source of the window's candidate ports that the resolver declares to the editor; none keeps the editor's default. */ candidatePortSource?: 'output';`.
2. `editorResolverOf(editor, resolver)` becomes `editorResolverOf(editor, resolver, options)` (its only caller is
   `resolverEditorOf`). When `options.candidatePortSource === 'output'`, it sets
   `editorResolver.candidatePortSource = editor.CandidatePortSource.Output`. Take the enum from `editor`, as the file
   does for `ResolvedAuthority`. When it's absent, the object has no such key. Extend the function's comment:
   "…and, when the extension declares one, the source of its candidate ports."
3. `packages/remote-ssh/src/extension.ts`: `resolverEditorOf(vscode, {detailsCommand: runtimeCommands.showDetails, candidatePortSource: 'output'})`.
   Dev Containers' call (`packages/remote-containers/src/extension.ts`) doesn't change: its own spec decides its port
   source, so it isn't part of this card.
4. The scripted wrapper (`acceptanceResolverEditorOf` in `remote-ssh/src/surfaces/scripted-adapters.ts`) wraps the
   host-level `EditorResolver`, not the editor's object, so it needs no change. Check that this is so.

Unit rows in `packages/lib-authority/test/unit/resolver-vscode.test.ts` (the fake editor gains
`CandidatePortSource: {None: 0, Process: 1, Output: 2, Hybrid: 3}`):
- `F-2507 BR-8: with the output source declared, the registered resolver carries candidatePortSource Output, before any resolve`
  (`seen.registered?.candidatePortSource === 2`).
- `F-2507 BR-8: without a declared source, the registered resolver has no candidatePortSource key`.
- The existing BR-9 row stays: still no `tunnelFactory`, and no `tunnelFeatures`, with the source declared. Add the
  option to that row's call, or add one assertion next to it.
- remote-ssh's wiring or activation test: if one asserts `resolverEditorOf`'s options, it gains the key. Otherwise
  the acceptance rows prove the wiring.

## 3. Harness (`tests/acceptance/`)

- **Window agent** (`window-agent/src/extension.ts`):
  - `acceptance.agent.setting`'s event gains `defaultValue: vscode.workspace.getConfiguration().inspect(settingId)?.defaultValue ?? null`.
  - New command `acceptance.agent.tunnels`, reporting
    `{event: 'tunnels', tunnels: (await vscode.workspace.tunnels).map(each => ({remotePort: each.remoteAddress.port, localAddress: typeof each.localAddress === 'string' ? each.localAddress : `${each.localAddress.host}:${String(each.localAddress.port)}`}))}`.
    `workspace.tunnels` comes from the `tunnels` proposal the agent's manifest already enables. If 1.140's types
    name it differently, follow the d.ts and tell me.
- **`windows/harness.ts`**: `settingDefaultIn(name, settingId): Promise<unknown>`, the latest `setting` event's
  `defaultValue`, built like `settingIn` (share the waiting; no duplicated code). Also
  `tunnelsOf(name): Promise<Array<{remotePort: number; localAddress: string}>>`, after the pattern of the other
  agent readouts.
- **The `default-ports` launch** (`tools/acceptance-launches.ts`) becomes a renderer launch, `{...RENDERER_LAUNCH,
  label: 'default-ports', suite: 'default-ports', settings: {...RENDERER_LAUNCH.settings, <its setting as now>}}`, so
  the rows can read core's notifications. The launch-table unit rows follow.

## 4. Rows: `tests/acceptance/default-ports/port-source.test.ts`

Use host ports 8640–8649, none of them used elsewhere. Every listener is started on the host with `nc -lk -p <port>
-s 127.0.0.1 -e /bin/echo <greeting>` and killed in `after` with the bracket pattern of `forward.test.ts`. Close the
windows a row opens in `finally`.

- **`F-2507 AC-20 (source-default)`**: open the SSH window `ps1`. `settingDefaultIn('ps1',
  'remote.autoForwardPortsSource')` is `'output'`, and the local window's is `'process'`. `settingIn` gives the same
  two values (no user value), and `readUserSettings()` has no `remote.autoForwardPortsSource` key before or after.
- **`F-2507 AC-21 (outside-not-forwarded)`**: open `ps2` and wait until it forwards the default port. Then start a
  listener on 8641 outside VS Code (`onHost`). After **20 s** (spec §6.4 step 2's watch), `tunnelsOf('ps2')` has
  exactly one entry, remote port 8632 (the launch's default forward). This row is about something *not* happening,
  so it's a fixed wait, not a poll. The listener starts after the connect because core's process scan skips the
  ports already listening when the window opened (§6.4 step 4). Measured: a listener started before the window
  passed even without the fix, and one started after it is auto-forwarded without the fix. That's the 33767 defect's
  class.
- **`F-2507 AC-21, AC-38 (terminal-forwarded)`**: in `ps3`, run `workbench.action.terminal.new`, then
  `workbench.action.terminal.sendSequence` with
  `{text: "printf 'Serving on http://127.0.0.1:8642\\n'; nc -lk -p 8642 -s 127.0.0.1 -e /bin/echo ps-8642\r"}`.
  Poll for up to 10 s until `tunnelsOf('ps3')` has a tunnel for remote port 8642. A connection to its local address
  gives `ps-8642`. Core's notification shows "Your application running on port 8642 is available. See all forwarded
  ports" (`notifications('ps3')`), with buttons "Open in Browser" and "Preview in Editor" (`notificationButtons`).
  About 10 s later the toast is gone from `notifications` (poll for up to 20 s) and the text is still in
  `notificationCentre('ps3')`. If 1.140 draws the primary button differently, assert the order only.
- **`F-2507 AC-22 (user-process)`**: `userSettings({'remote.autoForwardPortsSource': 'process'})` (restore in
  `finally`). Open `ps4`, then start a listener on 8643 outside VS Code. Poll for up to 20 s until `tunnelsOf('ps4')`
  has remote port 8643, and its local address gives the greeting. Per §6.4 step 4, ports that were already
  listening when the window opened aren't forwarded, which is why the listener starts after the window.

If a row shows the product doing something other than the spec says, beyond §2's fix, mark it open and tell me, with
the measured outcome.

## 5. Coverage, notes, done

- `docs/architecture/catalogue/coverage-slice1.tsv`: F-2507 AC-20, AC-21, AC-22 and AC-38 go from `todo` to
  `acceptance`. `node tools/check-coverage.ts` passes, and the acceptance tags follow.
- `docs/architecture/l3/transport-and-server/release-0.2-notes.md`: nothing. This is the spec's behaviour, not a
  deviation.
- Done when `node tools/acceptance.ts --editor vscodium --launches default-ports` passes locally, with AC-2's row still
  green, and the four rows fail on main without §2 (show that run's AC-21 failure in the PR: the extra tunnel's remote
  port). Also `pnpm test`, the whole diff linted, and `jscpd` and `knip` clean.
- PR title: `remote-ssh: SSH windows declare the output port source, so core forwards no listener of its own scan (card connect-81, #1146)`.
  Request athena only.
