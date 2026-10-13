# Task card cli-06: a connect's CLI ends with its window (#412)

Issue: #518. Why: triton's review of #477, then athena's ruling on #412 (contracts V7a, 2026-10-13). Measured by
daedalus on the harness host with the user's CLI build (alpine-arm64, 1.140.06729, commit `b969547887c4…`):
- **a `command-shell` whose control connection closes keeps running.** It ends only with its `--parent-process-id`,
  the shared session's `sh` (cli-03b). So every connect over a live shared session (a reload, a second window, a
  reconnect) leaves one more CLI on the host, holding a token and a loopback port, until the shared session ends;
- **`kill <cli pid>` (SIGTERM) ends the CLI and leaves the server it started running.** A new CLI's `serve` then
  reports `Found running server (pid=…)` and serves it. The server also outlives the shared session (F-2103 BR-10).

The ruling: `release()` and the extension's deactivation stop **this connect's own CLI**, best effort. Leftovers of a
crash end with the shared session. The stop kills **the CLI process only**, with no `pkill -P`, because the server it
started is the one the other windows' CLIs serve (F-2103 BR-8: one CLI per SSH connection, BR-10, AC-33). Rejected:
stopping earlier CLIs at the next start (with two live windows it stops the other window's working CLI), and reusing a
running CLI (it needs the control token in the shared record). Builder: daedalus. **Depends on cli-04 (PR #477).**

## 1. Changes

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | `STOP_CLI_BODY`: drop the `pkill -P "$CLI_STOP_PID"` branch; after the guard it runs only `kill "$CLI_STOP_PID"` |
| `packages/lib-server/test/unit/bootstrap-script.test.ts`, `cli-lifecycle.test.ts` | the rows that named `pkill`; one row that the stop script holds no `pkill` |
| `packages/remote-ssh/src/cli/cli-connect.ts` | `release()`: close the bridge, close the tunnel, then `stopCli` with the connect's CLI pid and an abort signal that fires after the request bound (10 s, contracts S9). The lease is given back when the stop settles or the bound passes, whichever comes first, whatever the outcome, so a hung stop never holds the shared session's lease (athena on #519). A second `release()` does nothing |
| `packages/remote-ssh/src/pipeline/steps.ts`, `server-steps.ts` | `stopCli` takes that cancellation, and passes it to lib-server's `stopCli` in place of today's own never-firing signal |
| `packages/remote-ssh/src/pipeline/connector.ts` | check that the extension's deactivation reaches the held connection's `release()`. If it doesn't, the connector's `dispose` releases what it holds |
| `packages/remote-ssh/test/unit/cli-connect.test.ts`, `connector.test.ts` | rows (section 2) |
| `tests/acceptance/server/cli.test.ts` | the real-host rows (section 2), opt-in on `REMOTE_OSS_CLI_ARCHIVE` as today |

The serve rows must name the CLI's own commit, which `<cli file> --version` prints (`… (commit <hash>)`). It's the
VSCodium build's commit, not upstream vscode's, and the patched CLI expands its template for no other.

## 2. Rows

| Cite | Given | Expected |
|---|---|---|
| athena on #412 | a resolved CLI connect, then `release()` | the steps saw `closeBridge`, the tunnel's close, `stopCli 88`, then the lease's release, in that order |
| athena on #412 | the same, with `stopCli` rejecting | the lease is still given back |
| athena on #519 | the same, with a `stopCli` that never settles, on a fake scheduler | the lease is given back once the 10 s bound passes, not before, and the stop's signal is aborted |
| athena on #412 | `release()` twice | `stopCli` ran once |
| athena on #412 | the connector holding a CLI connection, then `dispose()` | the connection's `release()` ran |
| athena on #412 | the stop script | it holds `kill "$CLI_STOP_PID"` and no `pkill` |
| athena on #412 (real host) | a CLI that served the real server, then `stopCli` with its pid | within 5 s the CLI's pid is gone, and the server's process still runs |
| athena on #518 (real host) | two connects over one session, each `serve`d | exactly one `<cli> --cli-data-dir …` process (the agent-host supervisor) runs, a child of the first `command-shell` |
| athena on #518 (real host) | the same, then both `command-shell`s stopped, then the session ended | the supervisor still runs (re-parented), one, with the server |
| F-2103 BR-8 (real host) | the same, then a new CLI and `serve` | the reply is `serving`, a `serverlog` line reads `Found running server`, and a server socket opened with the connection token the second connect hands its editor connects (triton on #519; which token that is waits on athena's ruling, section 4) |

## 4. Open: the found server's connection token (triton on #519)

Measured 2026-10-13: the CLI starts the server with `--connection-token=<the first serve's token>` on its command line,
and a later `serve` that finds it keeps that token. Two consequences are with athena: a second window is handed a token
the server refuses, and the token is visible in `ps` (S10). This card builds no token change. Its last row waits for
the ruling.

## 3. Gates and review

The repository's gates, with the changed files at 100/100/100. The real-host rows' run with the archive goes in the PR
body. PR title `remote-ssh, lib-server: a connect's CLI ends with its window, its server stays (card cli-06, #412)`.
triton (security) and athena.
