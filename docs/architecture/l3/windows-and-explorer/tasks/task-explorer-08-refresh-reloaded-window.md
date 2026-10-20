# Task card explorer-08: Refresh doesn't list a host added to the configuration in the explorer gate's SSH window (F-5101 AC-9, F-5102 AC-5)

Explorer slice 1. Size: M. Builder: `task:claude`. Found by hestia on #1206. The gate row `F-5101.AC-9, F-5102.AC-5: a
host added to the ssh_config appears last in file order after Refresh` (`tests/acceptance/explorer/gate.test.ts`, in
the `explorer` launch) fails 4 of 4 locally, on main and at the commit that added it (#1144), so it may never have
been green. CI doesn't run the launch on PRs. Every other row of the launch passes.

## 1. What is known

**hestia measured on main:**
- `Host gate-added` / `HostName 127.0.0.1` is at the end of the run's `ssh_config`, the file `remote.SSH.configFile`
  names (`tools/acceptance.ts` writes that setting for every launch).
- After the view's Refresh, and after `remote-explorer.refresh` run directly, 3 s apart each, the view still shows
  the SSH group and the 28 hosts of `hostAliases()`, and no `gate-added`. `rowsSettled` times out after 15 s.

**daedalus, reading main:**
- **The SSH side reads the file at every call:** `serveSliceEndpoints` → `hostnamesOf` → `listHosts` →
  `configuredHosts(host)` (`extension.ts`), which reads `remote.SSH.configFile` and parses the files each time. No
  cache in `lib-companion` or in the explorer's `companion-calls.ts`.
- **The explorer's Refresh is a full rebuild:** `window-activation.ts`'s handler `refresh: {execute: () =>
  session?.targets.rebuild()}` → `start(true)`, which asks `activeRemote`, `history` and `hostnames` again, and
  `settle` stores the new aliases and fires `onDidChange` → the tree adapter fires `onDidChangeTreeData(undefined)`.
- **The row runs in `empty-2`:** the window the gate's "Connect in Current Window" reloaded onto `ssh-remote+harness`.
  Its view was shown with `remoteTargets.focus` by the row before.

The likeliest gap is that in `empty-2` the handler's `session` is `undefined` (the session was made for a view or an
activation that the reload replaced), so Refresh does nothing, while the rows came from the first build.

## 2. Find the layer, then fix it

Reproduce with `node tools/acceptance.ts --editor vscodium --launches explorer`, with temporary log lines that you
don't commit. Rule each candidate in or out, in this order:
1. **The handler:** is `session` defined when Refresh runs in `empty-2`? Is `rebuild` called?
2. **The companion:** does a `getConfiguredHostnames` query reach remote-ssh after the click, and what does
   `listHosts` give?
3. **The view:** does `settle` store `gate-added`, does the tree adapter fire, and does core call `getChildren`
   again?
4. **The row:** run the same steps in the `local` window before the connects. If it passes there, the cause is
   specific to the reloaded SSH window.

**Then fix it at the layer that's wrong:**
- **A product cause:** fix it in remote-explorer or remote-ssh, with a unit row that fails before the fix.
- **A row cause** (a wrong window or wrong timing): fix the row, and explain in the PR why the row was never green.
- If the fix needs a contract change (lib-companion's protocol), comment here with the finding and stop.

## 3. Done when

- `node tools/acceptance.ts --editor vscodium --launches explorer` passes three times in a row. Paste the three summary
  lines.
- All gates pass.
- PR title: `remote-explorer: Refresh lists a host added to the configuration, also in a reloaded SSH window (card
  explorer-08, #1252)` (or `tests: …` if the cause is the row). Request athena only.
