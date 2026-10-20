# Task card containers-85: Dev Containers enables core's Ports features once connected, through lib-authority (F-1102 detection)

Containers increment 2, ports. Size: S. Builder: `task:local` (selene) or any coder. Design: athena's ruling on #1204
(2026-10-20), option (b). Found by dike on #1236: a dev container window never auto-forwards a listener. Everything
is decided here. If what you find differs, comment on this issue and stop.

## 1. Why

Core's two automatic forwarders (`remoteExplorer.ts`, `ProcAutomaticPortForwarding.startCandidateListener` and
`OutputAutomaticPortForwarding.startUrlFinder`, [oss] 1.139.1) start only when the window's ports features are
`AdditionalFeatures`. That needs the context key `forwardedPortsViewEnabled` to be true.

remote-ssh already sets it after its first resolve settles connected (connect-33). The code is `PORTS_VIEW_KEY`,
`PortsViewHost` and `enablePortsViewWhenConnected` in `packages/remote-ssh/src/surfaces/label-formatter.ts`, wired in
`register-connect.ts` and `extension.ts`. SSH's F-2507 AC-21 and AC-22 rows already prove that core's fallback tunnel
carries the forwards then. Dev Containers never sets it.

## 2. The change

1. **Move to lib-authority** (`packages/lib-authority/src/resolver/ports-view.ts`, new, exported from its index):
   - `PORTS_VIEW_KEY`, `PortsViewHost` and `enablePortsViewWhenConnected` as they are, with their comments;
   - the condition `shouldRegisterLabel(connection.state)` becomes `connection.state === 'connected'` inline. That's
     the same test `label-suffix.ts`'s `shouldRegisterLabel` makes, and that function stays in remote-ssh for its
     label;
   - the type it takes, `Pick<ResolverHandle, 'currentConnection' | 'onFirstResolveSettled'>`, is lib-authority's
     own.
2. **remote-ssh** imports them from `lib-authority` and keeps its wiring. Delete the moved code from
   `label-formatter.ts`, and move its unit rows (`label-formatter.test.ts`'s `enablePortsViewWhenConnected` rows and
   the `PORTS_VIEW_KEY` row) to `packages/lib-authority/test/unit/ports-view.test.ts`, unchanged except their imports.
3. **remote-containers**:
   - in `connect/register-connector.ts`, after `registration.kind === 'registered'`, call
     `enablePortsViewWhenConnected(resolver, host.portsView, served.logger)`;
   - `host` gains `portsView: PortsViewHost`;
   - in `extension.ts` pass `{enablePortsView: () => vscode.commands.executeCommand('setContext', PORTS_VIEW_KEY,
     true)}`, as remote-ssh's `extension.ts` does.
4. **Duty 2's unit row** (containers-75, #1236: `F-1102 duty 2: the resolver gives core no tunnel factory, no tunnel
   features and no candidatePortSource`) gains the key: rename it to `F-1102 duty 2: the resolver gives core no tunnel
   factory, no tunnel features and no candidatePortSource, and the window sets forwardedPortsViewEnabled once
   connected`. Assert that the registration's ports-view host is called once after a connected first resolve and not
   after a failed one. If #1236 hasn't added the row yet, add it here with that name, and tell dike.

## 3. Done when

- The lib-authority, remote-ssh and remote-containers unit tests pass, with `ports-view.ts` at 100 %.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches default-ports,containers-ports` passes, the
  second only if tooling-56 (#1228) has merged. Paste the summary lines.
- The whole diff is linted, and `pnpm dupes`, `pnpm dead` and `node tools/check-coverage.ts` are clean.
- PR title: `lib-authority, remote-containers: Dev Containers enables core's Ports features once connected (card
  containers-85, #1268)`. Request athena only.
