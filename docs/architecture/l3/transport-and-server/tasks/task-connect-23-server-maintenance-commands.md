# Task card connect-23: Kill VS Code Server on Host..., Kill Current VS Code Server and Uninstall VS Code Server from Host..., registered (F-2411, F-2412)

Issue: #532. Why: the user put these into 0.2 (hermes, 2026-10-13). `cleanRemoteServer` and
`cleanCurrentRemoteServer` (F-2411, `remote-oss/remote-ssh#56`, 33 ACs) and `cleanDevBox` (F-2412, `#57`, 37 ACs) are
declared and have no handler. Builder: daedalus (it reaches a host outside a window, which is integration over the
connection steps), or iris after #492. Size: L.

## 1. What exists

| Part | Where |
|---|---|
| the host pick and what a pick leads to | remote-ssh `maintenance/host-picker.ts` `maintenanceStep` (card remote-ssh-05, over connect-21's `pickerModel`) |
| the host part, own-host check, the two notices | `maintenance/target.ts` (card connect-10) |
| the own-host plans and result mapping | `maintenance/own-host.ts` (card connect-11) |
| the kill, uninstall and clean-up scripts | lib-server `lifecycle/maintenance.ts` `kill`, `uninstall`, `cleanup` |

## 2. What this card builds

- **A maintenance connect:** a connection to a picked host outside any window, by the same steps a window's connect
  takes up to the probe (validate, client lookup, terms, `openConnection`, probe), then the lib-server step, then
  the lease given back. It reuses `stepsOf` (wiring.ts) rather than a second pipeline. Where a step needs a window
  (the platform pick, the details link), follow what F-2411 and F-2412 say for a command; ask on #142 if they say
  nothing.
- **The three handlers,** registered as connect-21's are: the pick (`maintenanceStep`), the own-host branch (Kill
  Current reloads or closes the window as `own-host.ts` plans), the notices, and the log lines the specs give.

## 3. Rows

- **Unit rows** over fakes, per step and error path, named by the ACs.
- **Acceptance rows:**
  - on the harness host: the server's processes gone after Kill, and its folder gone after Uninstall, observed with
    `onHost`;
  - the notices, which need tooling-24's `notice` surface;
  - Kill Current's reload or close of the window, which needs tooling-20 (#492).

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `remote-ssh: the server maintenance commands,
registered (card connect-23)`. athena, triton.
