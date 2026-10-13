# Task card connect-33: a connected SSH window enables core's Ports view

Issue: #614 (from #613, the user's run). Why: in a connected SSH window the Ports panel is empty ("Drag a view here to
display."). VS Code core registers the Ports view only when the window's context key `forwardedPortsViewEnabled` is
true ([oss] `src/vs/workbench/contrib/remote/browser/remoteExplorer.ts`, `ForwardedPortsView.enableForwardedPortsFeatures`;
the key is `forwardedPortsFeaturesEnabled` in `src/vs/workbench/services/remote/common/tunnelModel.ts`).
- The other way in, an extension with the `onTunnel` activation event, is skipped in a remote window until a tunnel has
  opened (`tunnelModel.ts`, `checkExtensionActivationEvents`).
- OSS's own resolver sets the key with `setContext` ([oss] `extensions/vscode-test-resolver/src/extension.ts`).
- We set it nowhere, and the resolver result's `tunnelFeatures` don't enable the view.

Spec: F-2507 §16 calls the view core's. F-2501 AC-35 (slice 1) and F-2507 AC-2, 18, 19, 23 and 35 all act in it.
Builder: hestia or iris (hermes assigns). Size: XS. Design check: athena.

## 1. The change

Once the window's first resolve has settled with the connection up, the extension runs
`setContext('forwardedPortsViewEnabled', true)` for its window. That's the same moment and the same condition as the
window's label (`surfaces/label-formatter.ts`, `registerWindowLabel`: `onFirstResolveSettled`, `shouldRegisterLabel`).
- A local window, or a window whose resolve failed, doesn't set it.
- Nothing sets it back. Core drops a window's context keys with the window, and a reconnection keeps the view.
- The setting goes through a port of the editor, `PortsViewHost { enablePortsView(): PromiseLike<unknown> }`, that
  `register-connect.ts` takes beside `labels`. `extension.ts` passes `() =>
  vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true)`.
- The key's name is a constant with an `[oss]` citation, as other core names are.
- Put the helper (`enablePortsViewWhenConnected(resolver, host, logger)`) beside `registerWindowLabel` in
  `surfaces/label-formatter.ts`, with the same connected-first-resolve condition shared between them. Containers and WSL
  then reuse one place (athena on #615; contracts §3.2, 8961677, makes it a family-wide rule).
- A rejected `setContext` is logged at `warn` (`the Ports view could not be enabled: <message>`) and changes nothing
  else.

## 2. Rows

Unit rows (`label-formatter.test.ts` or a new `ports-view.test.ts`, with the fakes of the label rows):

| Name | Expected |
|---|---|
| `F-2501 AC-35: a connected first resolve enables the Ports view once` | `enablePortsView` called once after `onFirstResolveSettled` with a connected state |
| `F-2501 AC-35: a failed first resolve doesn't enable the Ports view` | no call for `failed`, `transportLost`, `transportClosed` |
| `the Ports view's enabling failure is logged and nothing else changes` | `enablePortsView` rejects; one `warn` line; no unhandled rejection |
| `register-connect passes the editor's setContext of forwardedPortsViewEnabled` | the fake command host records `setContext` with `forwardedPortsViewEnabled` and `true` |

**Acceptance row** (`suite-remote/remote-window.test.ts`, a connected window): `F-2501 AC-35: the connected window has
core's Ports view`. `vscode.commands.getCommands(true)` lists `~remote.forwardedPorts.focus`, the view's focus command,
which core makes when the view is registered (the view id is `~remote.forwardedPorts`, [oss] `tunnelView.ts`,
`TUNNEL_VIEW_ID`). Check the id against the pinned VSCodium build first, and use what it lists.

AC-35's other halves (no "May Require Sudo", no "Port Visibility", the client's environment) stay as tagged. This row
only makes the view reachable.

## 3. Review

PR title `remote-ssh: a connected SSH window enables core's Ports view (card connect-33, #614)`. athena checks the use of
the core key, and themis or triton reviews. proteus reruns #613's manual check on the build.
