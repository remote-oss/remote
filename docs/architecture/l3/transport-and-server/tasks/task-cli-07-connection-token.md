# Task card cli-07: one connection token per host on the CLI path (#412, remote-ssh#92)

Issue: #523. Why: athena's ruling on #412 after `remote-oss/remote-ssh#92` (2026-10-13). The reference keeps one
owner-only token file per host next to the server, reads the token back over SSH, and a second window reuses the
running server and its token. The file outlives closing every window and "Kill VS Code Server on Host..." (F-2409
BR-11). Today cli-04 sends each connect's `serve` a fresh token. But the CLI starts the server with the **first**
`serve`'s token in its argv, and a later `serve` that finds the running server keeps it, so every window after the first
is handed a token the server refuses. Measured by daedalus on the harness host with the user's CLI build (#92's
build-side comments). Builder: daedalus. **Depends on cli-04 (PR #477).**

**The argv deviation, recorded.** The CLI puts the token on the server's command line (`--connection-token=<token>`),
visible in `ps`. The user declined changing the CLI. athena ruled it a documented S10/V7a deviation in a CLI-owned
process, after three measurements by a second ordinary user on the host while a window was connected:
- the server's `node` listens on no TCP port; the two loopback listeners are the CLI's;
- the server's socket refuses that user (`EACCES`);
- the CLI's bridge port answers 403 to that user even with the token from `ps`.

This card doesn't change the argv. It only makes the token one per host.

## 1. The token file

`<CLI data folder>/connection-token`. The name is ours: `agent-host-token` is `[cli]`'s own supervisor file, and we
never touch it.
- **Made by the first connect, under `umask 077`:** a fresh 32-character token `[A-Za-z0-9]`, generated as the direct
  start does (`tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32`), written to a temporary file in the same folder, then
  `ln`ed to the name. `ln` fails when the name exists, so of two racing connects the loser reads the winner's token.
  The temporary file is removed either way.
- **Read by every connect** through the script's output, as the direct start reports its own token
  (`fact server.token …`): `fact cli.connectionToken "$(cat "$TOKEN_FILE")"`.
- **Checked:** a file whose content isn't 1 to 128 characters of `[0-9A-Za-z_-]` (the server's own token form, `[oss]`
  `src/vs/server/node/serverConnectionToken.ts`) is never replaced, since a running server may hold it. The step leaves
  `ServerFailedToStart` with `fact cli.tokenInvalid yes`, and the connect falls back (cli-04 §5).
- **Kept** after the window closes, after every window closes, and through our Kill Server command (F-2409 BR-11). The
  uninstall removes it with the data folder, as today.

## 2. Changes

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | `startCli`'s body: before the CLI starts, make or read the token file as section 1 says; `fact cli.connectionToken`; `cli.tokenInvalid` |
| `packages/lib-server/src/lifecycle/cli.ts` | `startCli`'s `started.server.connectionToken` is the file's token (`cli.connectionToken`), not the control token; a missing or empty fact is `serverStart` |
| `packages/remote-ssh/src/cli/cli-connect.ts` | `serve`'s `connection_token` and `Connected.connectionToken` are `started.server.connectionToken`; `newSecret()` stays for the control token and the probe only |
| `packages/lib-server/test/unit/bootstrap-script.test.ts`, `cli-lifecycle.test.ts`, `packages/remote-ssh/test/unit/cli-connect.test.ts` | rows (section 3) |
| `tests/acceptance/server/cli.test.ts` | the real-host rows (section 3), opt-in on `REMOTE_OSS_CLI_ARCHIVE` |
| `docs/architecture/l3/transport-and-server/contracts.md` | none: athena records the deviation in V7a and S10 |

## 3. Rows

| Cite | Given | Expected |
|---|---|---|
| F-2409 BR-11 | the `startCli` step on the shell fake host, first run | `<CLI data>/connection-token` exists, mode 600, 32 characters of `[A-Za-z0-9]`, and the fact equals it |
| F-2409 BR-11 | a second run | the fact is the same token, and the file is unchanged |
| athena on #412 | two runs started together | both facts are the same token |
| athena on #412 | a file holding `bad token!` | `ServerFailedToStart` with `cli.tokenInvalid yes`, and the file is unchanged |
| §S10 | the `startCli` script text | it holds no token, and makes the file under `umask 077` |
| §S10 | `startCli` over a recording channel | no log line holds the token |
| athena on #412 | a resolved CLI connect | `serve`'s `connectionToken` and `Connected.connectionToken` equal `started.server.connectionToken`, and neither is the control token |
| F-2103 BR-8 (real host) | two connects over one session, each `serve`d | both are handed the same token, and the running server's argv token equals it |
| F-2409 BR-11 (real host) | the same, then both CLIs stopped (cli-06) | the token file still exists, unchanged |

## 4. Gates and review

The repository's gates, with the changed files at 100/100/100. The real-host run with the archive goes in the PR body.
PR title `lib-server, remote-ssh: one connection token per host on the CLI path (card cli-07, #412)`. triton
(security) and athena.
