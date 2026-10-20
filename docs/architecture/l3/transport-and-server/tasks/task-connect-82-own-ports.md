# Task card connect-82: no port of the connection itself is ever auto-forwarded, under either source (F-2507 AC-43)

Issue: #1164. Release 0.2. Size: S. Builder: daedalus. Spec: remote-oss/remote-ssh#65 (F-2507, republished), 6.4 step 5 and
the new AC-43. Context: card connect-81 (#1146, PR #1151) made SSH windows declare the `output` source. The
reference's half of the port comparison (#65, comment 6283800660) found the reference never forwards a port of its
own connection, within 60 s of a fresh connect, a reload, or a close and reconnect, under `output` and under
`process`. That's stronger than #1151's rows, which prove the default and an outside listener only.

## 1. The risk this guards

Under `process`, core forwards any loopback listener that appears on the host after the window's first scan. A port
of our own connection would surface if the product started a new listener on the host while a window is connected:
a server started or restarted for a later attempt, or a helper listening on the host. Under `output` nothing is
scanned. The row proves neither happens, in the three moments the spec names.

## 2. Row: `tests/acceptance/default-ports/port-source.test.ts`

Two rows, one per source (athena's ruling on #737): **`F-2507 AC-43 (own-ports-output)`** with no user value, and
**`F-2507 AC-43 (own-ports-process)`** with the user value `"remote.autoForwardPortsSource": "process"` (set with
`userSettings`, restored in `finally`). Each does:
1. Set `remote.SSH.defaultForwardedPorts` to `[]` for the row with `userSettings`, so the launch's default forward
   doesn't count. Restore it in `finally`.
2. **Connect:** open window `po<n>`. For **60 s** after its agent activates, `tunnelsOf` stays `[]`, read every
   5 s. Also read the forwarded-ports status item with `statusItem` (measure core's DOM id; its text reads "No Ports
   Forwarded") at the start and the end.
3. **Reload:** `reloadWindow`, then the same 60 s watch.
4. **Close and reconnect:** run `workbench.action.remote.close`, reopen the window on `harness`, then the same 60 s
   watch.

This row is about something not happening, so it's fixed waits, not polls.

Also assert, once per source, that the window's resolved local port, the local port of its `ssh` and the server's
port on the host (`serverPort()`) are not among the remote ports of any tunnel.

## 3. Coverage, done

- `coverage-slice1.tsv`: add `F-2507.AC-43` (the republished spec adds it; regenerate the line the way coverage-44
  does) as `acceptance`. `check-coverage` passes.
- `node tools/acceptance.ts --editor vscodium --launches default-ports` passes (about 7 minutes longer).
- **Measure `process` on main first.** If a listener of ours is forwarded, the product change puts our listeners in
  the class core's process scan leaves out. Read that class from [oss] (the remote server's candidate scan) and cite
  the path. Constraints: no tunnel factory, nothing written to the user's settings, no new API proposal. If a
  proposal turns out to be the only way, it goes to proteus and athena with the [oss] reading before any code.
- The default row should pass with #1151 as it is.
