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

## 2a. Servers of the CLI path (athena's ruling on #532)

lib-server's scripts today reach only a direct install's servers: `stop_servers` matches a recorded process only when its
command line holds `$DATA_DIR/bin/`, and uninstall's clean-up removes `bin` and the pid files.
- **Kill (F-2411 BR-3):** stop the user's server processes, never the launcher. `stop_servers` also matches servers
  under `$DATA_DIR/cli/servers/`, with the same guard. The CLI path writes no pid file for its server, so these are
  found by scanning `ps` for command lines that hold `$DATA_DIR/cli/servers/`, each checked with `is_server_process`
  (iris's measurement on #561). The CLI's `command-shell` and its agent-host supervisor keep running.
- **Kill's layout rule (F-2411 BR-4):**
  - a direct install (`bin/`) is removed, as today;
  - a CLI install stays: `cli/servers/…`, the two token files, data, extensions and logs. The two token files are:
    - `cli/connection-token`: the server's connection token, made by cli-07 (#542). This card's CLI rows need #542
      merged; on main before it, the file doesn't exist;
    - `cli/agent-host-token`: the CLI's own agent-host supervisor's token, a UUID minted by the CLI itself ([cli]
      `src/commands/agent_host.rs`, `mint_connection_token`). Its value differs from the connection token (measured
      2026-10-13 with the user's CLI build 1.140.06729: 32 and 36 bytes, both mode 600).
- **Uninstall (F-2412):** already removes the whole data folder, the CLI's included. No change.
- **Recovery:** a deleted token file is recovered by Kill. It ends the server holding the old token, and the next
  connect makes a fresh token and a fresh server. lib-server's README says so in this card's PR.

## 3. Rows

- **Unit rows** over fakes, per step and error path, named by the ACs.
- **The CLI path's rows (athena on #532):**
  - unit, over the shell fake host: Kill stops a server process under `cli/servers/`; it leaves a process named
    `<cli> command-shell …` and a process `<cli> --cli-data-dir …` running; it keeps `cli/servers/`,
    `cli/connection-token` and `cli/agent-host-token`;
  - real host, opt-in on `REMOTE_OSS_CLI_ARCHIVE` in `tests/acceptance/server/cli.test.ts`: after a CLI served the real
    server, Kill ends the server's `node`, the CLI and the supervisor still run, and `cli/servers/`,
    `cli/connection-token` and `cli/agent-host-token` are still there, unchanged.
- **Acceptance rows:**
  - on the harness host: the server's processes gone after Kill, and its folder gone after Uninstall, observed with
    `onHost`;
  - the notices, which need tooling-24's `notice` surface;
  - Kill Current's reload or close of the window, which needs tooling-20 (#492).

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `remote-ssh: the server maintenance commands,
registered (card connect-23)`. athena, triton.
