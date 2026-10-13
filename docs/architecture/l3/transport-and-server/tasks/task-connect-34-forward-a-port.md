# Task card connect-34: Forward a Port works, through the editor's own server tunnel

Issue: #616 (#613's second defect, found by proteus). **Priority: high**: no port can be forwarded in 0.2 (#41). Why: core's
"Forward a Port" fails with `Unable to forward localhost:8613. this._forwardPortProvider is not a function`.
- core's extension host takes the resolver's `tunnelFactory` as its forward-port provider and calls it as a function
  `(tunnelOptions, tunnelCreationOptions) => Thenable<Tunnel>` ([oss] `src/vs/workbench/api/common/extHostTunnelService.ts`,
  `setTunnelFactory`; `vscode.proposed.resolvers.d.ts`).
- Our resolver's getter (`lib-authority/src/resolver/vscode-resolver.ts`, `editorResolverOf`) hands it lib-forwarding's
  `TunnelFactory` **object**.
- The `tunnelFeatures` we put on the result are lib-forwarding's `{elevation, privacy}`, cast to the editor's
  `{elevation, privacyOptions, protocol}`, which they don't match.

Builder: hestia or iris (hermes assigns). Size: S. Design check: athena.

## 1. The decision: hand the editor no tunnel factory

F-2507 says how a hand-forwarded port is carried: "on the host the connection to the application is opened by a VS
Code Server process, not by sshd", with one "Creating a socket (renderer-Tunnel-<id>)" line in the extension host's log
per connection (6.3 step 4). §16 adds that core builds the tunnel itself. athena ruled this way on #617 (contracts §3.2,
f3f4aee).

That is core's own tunnel through the server connection, which core uses when the resolver gives no `tunnelFactory`. Our
`factoryFor` dials the port through the SSH forward, so sshd would open the connection: not what 6.3 step 4 observes.

So:
- **`editorResolverOf` gives the editor no `tunnelFactory`.** The getter goes, and `EditorResolver.tunnelFactory`,
  `Memory.tunnelFactory` and `ConnectedResult.tunnelFactory` go with it (`lib-authority`'s host and connector results).
- **The result's tunnel features are the editor's shape**: `{elevation: false, public: false, privacyOptions: [],
  protocol: true}` (athena on #617). Core offers "Change Port Visibility" when `privacyOptions.length > 0` ([oss]
  `src/vs/platform/tunnel/common/tunnel.ts`, `canChangePrivacy`), so the empty list gives no visibility choice (F-2507
  BR-9, AC-19). `protocol: true` keeps "Change Port Protocol" (F-2501 AC-35). `lib-authority` takes them as plain data:
  `ResolvedConnection.tunnelFeatures: {elevation: boolean; public: boolean; privacyOptions: never[]; protocol: boolean}`,
  with no cast.
- **The tunnel step** (`remote-ssh/src/pipeline/tunnel-step.ts`) no longer makes a `factoryFor`. It returns the features
  above, a constant beside the step, and its `close` closes only the window tunnel.
- **lib-forwarding's `factoryFor`** (and `TunnelFactory`, `ForwardRequest`, `ForwardedPort`, `ReviveReport` and
  `TunnelFeatures`) then has no user in the product. Under ADR-0003 (no dead code) it is removed, with its unit rows and
  `tests/acceptance/server/tunnel-factory.test.ts`. The relay tunnel it was built on (`openRelayTunnel`) stays: the window
  tunnel uses it. #163's "revives forwards after a reconnection" is then core's: core re-opens its tunnels after it
  reconnects (F-2507 6.1). Say so on #163 and #294 in the PR.

If athena rules the other way (keep our factory and adapt it to the function shape), this card changes before it's
built. It doesn't go both ways.

## 2. Rows

Unit rows:

| Name | Expected |
|---|---|
| `F-2507 6.3: the editor's resolver has no tunnel factory` | `editorResolverOf(...)`'s `tunnelFactory` is `undefined` before and after a connected resolve |
| `F-2507 BR-9, F-2501 AC-35: the result offers no visibility choice, protocol and no elevation` | the connected result's `tunnelFeatures` equal the object above, with `privacyOptions` empty |
| `the tunnel step's close ends the window tunnel` | as today, with no factory |

**Acceptance rows** (windows suite):
- The window agent declares `enabledApiProposals: ["tunnels"]`, and the plain launch enables the proposal for it as it
  does for us (`acceptance-plain.ts`, `PROPOSED_API_EXTENSIONS` gains the agent's id).
- New agent command: `acceptance.agent.forwardPort(remotePort)`. It calls `vscode.workspace.openTunnel({remoteAddress:
  {host: 'localhost', port: remotePort}})` and appends `{event: 'forwarded', localAddress, remotePort}`, or `failed`
  with the message.

| Name | Steps | Assertions |
|---|---|---|
| `F-2507 AC-18: a port forwarded in a connected window reaches the host's port` | on the host, a BusyBox `nc -lk -p 8613 -s 127.0.0.1 -e /bin/echo forwarded-8613` listener (harness user, ended in `after`); `openWindow('harness', 'f1')`; `inWindow('f1', 'acceptance.agent.forwardPort', 8613)` | a `forwarded` event whose `localAddress` names a local port; a TCP connect to it reads `forwarded-8613` |
| `F-2507 6.3: the host-side connection is opened by the VS Code Server, not by sshd` | while a connection through the forward is held open, `netstat -tnp` on the host, run as harness | the established connection to 127.0.0.1:8613 belongs to a `node` process under the server's folder, not `sshd` |

The row menu's lack of "Change Port Visibility" (F-2507 AC-19, F-2501 AC-35) is core's rendering of
`privacyOptions: []` (`canChangePrivacy`): a core half, resting on the unit row above. Name it in the PR.

Tag F-2507 AC-18 `acceptance`. F-2507 is slice 2; record the tag in the TSV and in #142 only if the catalogue holds
slice 2's rows, otherwise list it on #41.

## 3. Review

PR title `lib-authority, remote-ssh, lib-forwarding: Forward a Port goes through the editor's own tunnel (card connect-34,
#616)`. athena gives the design check (the removal), themis or triton reviews, and proteus reruns #613's manual check:
Forward a Port 8613, then the local port answers.
