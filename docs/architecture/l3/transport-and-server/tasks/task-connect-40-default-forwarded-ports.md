# Task card connect-40: remote.SSH.defaultForwardedPorts is forwarded at connect

Issue: #677. Slice 2 (#41), in 0.2 under the standing plan, not gating (athena, register 3289d3d). Spec: F-2507
(`remote-oss/remote-ssh#65`), contracts transport-and-server **W4 `applyDefaults`**. Size: about 1.5 agent-days.
Builder: assigned by hermes. Build order: after the gating cards.

## 1. What's missing

`remote.SSH.defaultForwardedPorts` (generated name `defaultForwardedPorts`) is declared. lib-forwarding parses it:
`parseDefaultForwards(settingValue)` gives `{requests: TunnelRequest[], skipped: SkippedEntry[], settingProblem?}`
(forwarding-02, `lib-forwarding/src/defaults/entries.ts`), with BR-2's rules:
- the first entry per remote port wins;
- a numeric string port is accepted;
- invalid entries are skipped with a reason.

Nothing reads the setting, so on main no default port is forwarded.

## 2. The rules (F-2507 5.0, BR-2 to BR-7, W4)

- **R1** (BR-5; athena, register e2e9bba): the decision is lib-forwarding's `shouldApplyDefaults(isReconnection)`
  (`defaults/policy.ts`), called at each resolve that settles connected, where `isReconnection` is true when **an
  earlier resolve in this extension host succeeded**.
  - A connect and a reload apply the defaults: a reload starts a new extension host.
  - A first connection's Retry applies them too: its first resolve failed, so no earlier resolve succeeded.
  - A reconnection's resolve doesn't (6.5 step 3).
  - The hook sits where connect-33 sets `forwardedPortsViewEnabled` when a resolve settles connected. The setting is read
    there with the settings port's precedence (BR-6: user, remote, folder), through
    `valueOf(host, 'defaultForwardedPorts')`.
- **R2** (BR-2, 5.0 step 2): for each `parseDefaultForwards(...).requests` entry, in order, call `openTunnel` with:
  - `remoteAddress: {host: 'localhost', port: remotePort}`;
  - `localAddressPort: localPort` (the parser gives the remote port when none is set);
  - `label: name`, when present.
- **R3** (W4 failures): a skipped entry is logged at info, `defaultForwardedPorts entry <index> is skipped: <reason>`,
  and so is a `settingProblem`. An `openTunnel` that rejects is logged at warn, and the others still open.
  - Nothing is shown (AC-6).
  - Calls don't wait on each other: start them all, then await them all.
- **R4** (BR-4): not gated on workspace trust. The call is made at once. Core's startup trust dialog may delay what core
  does, which isn't ours to bound.
- **R5** (7.E10, AC-10): a change of the setting while connected does nothing until the next connect or reload.

## 3. Changes

1. **`pipeline/connect-settings.ts`:** `defaultForwardsOf(host): DefaultForwards`, which is
   `parseDefaultForwards(valueOf(host, 'defaultForwardedPorts'))`.
2. **A module `forwarding/default-forwards.ts`** (remote-ssh): `applyDefaults(forwards, port, logger): Promise<void>`
   by R2–R3, over a port `{openTunnel(options): PromiseLike<unknown>}`, and its editor adapter over
   `vscode.workspace.openTunnel` (the `tunnels` proposal the manifest declares).
3. **The hook:** in the activation code where connect-33 sets `forwardedPortsViewEnabled` when a resolve settles
   connected, keep one flag per extension host, "a resolve has succeeded". When `shouldApplyDefaults(<that flag>)` is
   true, call `applyDefaults(defaultForwardsOf(settings), …)`, not awaited by the resolve, then set the flag.

## 4. Rows

**Unit rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2507.AC-2 | `[{name: 'web', remotePort: 8000, localPort: 18000}]` | one `openTunnel` with `{remoteAddress: {host: 'localhost', port: 8000}, localAddressPort: 18000, label: 'web'}` |
| F-2507.AC-3 | `[{remotePort: 8001}]` | `localAddressPort: 8001`, no `label` |
| F-2507 7.E6 | two entries with remote port 8002 | one call, the first entry's |
| F-2507 7.E4 | `[{remotePort: 'x'}, 5, {remotePort: 8003}]` | one call, for 8003; two info lines naming indexes 0 and 1 |
| F-2507 W4 | the first `openTunnel` rejects | the second is still called; one warn line; `applyDefaults` resolves |
| F-2507 BR-5 | the hook fired by a first resolve that succeeded, then a reconnection's resolve that succeeded | `applyDefaults` ran once |
| F-2507 BR-5 | a first resolve that failed, then the Retry's resolve that succeeded (no earlier success) | `applyDefaults` ran once, at the Retry |
| F-2507.AC-6 | any input | no notice port was called (the rows' fake surfaces) |

**Acceptance row** (VSCodium, a plain launch `default-ports`, settings
`{'remote.SSH.defaultForwardedPorts': [{name: 'web', remotePort: 8632, localPort: 18632}]}`; suite `default-ports/`,
added as the README's "To add a launch" says):
- **Row:** `F-2507 AC-2: a default forwarded port listens after the window connects`.
- **Steps:**
  1. Before opening the window, `onHost('sh', '-c', 'nc -lk -p 8632 -s 127.0.0.1 -e /bin/echo dflt-8632 &')`.
  2. `openWindow('harness', 'dp1')`.
  3. Poll a TCP connect to `127.0.0.1:18632` every 500 ms for at most 15 s, and read the greeting. If 18632 is busy
     on the test machine, read the next free higher port instead (BR-3): try 18632–18642.
- **Expected:** the greeting `dflt-8632` within 15 s.
- **It must fail on main:** nothing listens on 18632. Paste both runs.
- End the host listener in `after`.

## 5. Gates and review

All gates, the changed files at 100 %, and the VSCodium run green. PR title
`remote-ssh: remote.SSH.defaultForwardedPorts is forwarded at connect (card connect-40, #677)`. themis or triton
reviews; athena gives the design check.

## 6. Open rows (stop and report on #677)

1. connect-33's hook can't tell a resolve that settles connected from one that fails, so the flag can't be kept by
   R1's rule. Report what the hook gets.
2. `openTunnel` from the local extension host isn't allowed before core's Ports view is registered. Report the error
   text.
