# Task card coverage-24: a row that sees core's Ports features on, for connect-33's context key

Issue: #621. Why: athena on #619. connect-33's build sets core's context key `forwardedPortsViewEnabled` once a window
has connected. Its acceptance row (the Ports view's focus command listed) passed with or without the fix, so it was
dropped: no extension API reads a context key's value.

The key has a second effect that an extension can observe. In [oss] `src/vs/workbench/contrib/remote/browser/remoteExplorer.ts`:
- `ForwardedPortsView.enableForwardedPortsFeatures` both registers the view and calls
  `remoteExplorerService.enablePortsFeatures(false)`, which means "additional features";
- core's terminal URL finder and candidate listener start only then (`startUrlFinder`, `startCandidateListener`
  return early otherwise).

So a URL a server prints in a terminal of a connected window is forwarded automatically with the key, and not without
it. F-2507 AC-21 (`remote-oss/remote-ssh#65`) states this behaviour. Builder: hestia or iris (hermes assigns). Size: S (the AC-24 row adds about two hours).
**Depends on:**
- connect-34 (#616): core's own tunnel carries the forward, and the window agent gets the `tunnels` proposal;
- coverage-14 (#568): the windows helpers.

## 1. The agent

`acceptance.agent.tunnels()` appends `{event: 'tunnels', tunnels: [{remotePort, localAddress}]}` from
`vscode.workspace.tunnels` (the `tunnels` proposal, which connect-34 gives the agent).

## 2. The rows (`tests/acceptance/windows/ports-features.test.ts`)

| Name | Steps | Assertions |
|---|---|---|
| `F-2507 AC-21, F-2501 AC-35: a URL a server prints in a terminal of a connected window is forwarded automatically` | `openWindow('harness', 'pf1')`; in `pf1`, `acceptance.agent.runInTerminal` (new: `createTerminal` + `sendText`) with `nc -lk -p 8621 -s 127.0.0.1 -e /bin/echo pf & sleep 1; echo http://localhost:8621/` | within 15 s, `tunnels()` lists `remotePort` 8621. A TCP connect to its local address reads `pf` |
| `F-2501 AC-24: a forwarded port reaches the host over the connection, with no new login and no further ssh process` | before `openWindow('harness', 'pf1')` in the first row, note `since` (the clock); once `pf1` has connected, note `acceptedKeyLogins(since)` as `logins` and `sshProcesses()` as `processes`. After the first row's forward of 8621 has read `pf` | `acceptedKeyLogins(since)` still equals `logins`, and `sshProcesses()` still equals `processes` |
| `F-2507 AC-21: a server started on the host outside the editor is not forwarded` | the same window: on the host, `onHost('sh', '-c', 'nc -lk -p 8622 -s 127.0.0.1 -e /bin/echo out &')`; wait 10 s | `tunnels()` has no 8622 |

The first row cites F-2501 AC-35 too (triton on #622): the features run only once core has registered the Ports view
through the key, so the same row proves AC-35's view half. No second window or terminal is needed for it.

**The helpers of the AC-24 row** (in `tests/acceptance/windows/`, beside the windows helpers):
- `sshdLog(since)` and `acceptedKeyLogins(since)`, as coverage-19 (#590) §1 defines them: the host container's `docker
  logs --since <since>` lines, and the count of `Accepted publickey for harness` among them. If coverage-19 has merged
  first, reuse its helpers; otherwise add them here, and coverage-19 reuses these.
- `sshProcesses()`: the sorted process ids of the client's `ssh` processes, from `ps -eo pid=,comm=`, whose command is
  exactly `ssh`.

The row cites F-2501 AC-24 as republished on remote-ssh#59 (2026-10-14): the forward rides the extension's SSH
connection, so sshd sees no further login and the client starts no further `ssh`. It proves both halves: the
connection to the host (the first row's `pf`) and nothing new.

**It must fail without the fix.** Run the first row once with connect-33's call disabled (a local edit, not committed):
it must fail. Say so in the PR, as hestia measured for connect-33.

End the host listeners and close the terminal in `after`.

## 3. The catalogue

F-2507 AC-21 goes to `acceptance` (record it on #41 if slice 2 isn't in the catalogue). The build PR retags
`F-2501.AC-35` in `coverage-slice1.tsv` from `todo` to `acceptance`, since the first row cites it (triton on #622), and
moves it out of "Needs an acceptance row" in #142. It retags `F-2501.AC-24` from `todo` to `acceptance` the same way. Core halves: the "Your application running on port …" notification's
rendering (AC-21), and the view's own rendering.

## 4. Review

PR title `tests: core's Ports features are on in a connected window (card coverage-24, #621)`. themis or triton
reviews; athena gives the tag check.
