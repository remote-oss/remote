# Task card cli-03b: the CLI's install and start on the host (#412, contracts V7a)

Why: #412, the CLI path, brief `brief-cli-path.md` §3, §4 and §10. cli-02 plans the `cli` kind (`cliPath`,
`cliDataFolder`, `download`, `where`). This card places the CLI on the host and starts it, as lib-server operations
over the host channel. The CLI's control client is cli-03a (#424); the wiring into the connect is cli-04. Reviewing
coder: `remote-coding-worker-1`.

**Depends on ssh-32 (#429)**: the token is passed through a script's `environment`, and only ssh-32 keeps that out of
every process's command line (contracts §S10). **Start after #429 is merged.** It merges after #422, without waiting
for step 0 (brief §10: unwired, no behaviour change).

**Not in this card:** any rule for when the CLI ends (contracts V7a's Lifetime is provisional, pending
`remote-oss/remote-ssh#21`). `--parent-process-id` is **not** passed: tying the CLI to a process is open until metis
answers. The CLI is started detached (`nohup`), as the server is.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | `ScriptParameters.cli` (section 2.1); the steps `installCli` and `startCli` (section 2.2) |
| `packages/lib-server/src/scripts/posix-script.ts` | `CLI_STAGING` and `CLI_FILE` beside `INSTALL_DIR`; `cli_ready_port` (section 2.2) |
| `packages/lib-server/src/lifecycle/run-step.ts` | `StepOptions.environment` (section 2.3) |
| `packages/lib-server/src/lifecycle/cli.ts` | new: `installCli`, `startCli` (section 2.4) |
| `packages/lib-server/src/index.ts` | the new exports |
| `packages/lib-server/test/unit/bootstrap-script.test.ts`, `cli-lifecycle.test.ts` | unit rows (section 3.1) |
| `tests/acceptance/server/cli.test.ts` | the real-host rows (section 3.2) |

## 2. Contract

### 2.1 Parameters

`ScriptParameters` gains `cli?: {name: string; dataFolder: string}`. `name` is `<applicationName>-<commit>`, the
CLI's file name in the data folder (brief §3; F-2103 POST-2 observes the reference's `code-<commit>`). `dataFolder` is
the CLI's `--cli-data-dir`, `<data folder>/cli`. The parameter block writes `CLI_NAME` and `CLI_DATA` (empty when
`cli` is absent).

### 2.2 The script steps

`ScriptStep` gains `'installCli' | 'startCli'` (single-script mode; stepwise mode is not offered for the CLI).
`posix-script.ts` sets, after `INSTALL_DIR`: `CLI_STAGING=$DATA_DIR/cli-bin/$COMMIT` and `CLI_FILE=$DATA_DIR/$CLI_NAME`.

**`installCli`**, the install body against the staging folder, then one move:
1. `[ -n "$DATA_ROOT" ] && [ -n "$CLI_NAME" ] || finish CreateInstallDirFailed`.
2. `lock_take "$COMMIT" || finish LockBusy` (the same host lock as the server's install).
3. `[ -x "$CLI_FILE" ]`: `fact cli.path "$CLI_FILE"; leave Ok` (already placed).
4. `mkdir -p "$CLI_STAGING"`, `prepare_environment`, then the archive exactly as `INSTALL_BODY` gets it (`ARCHIVE_PATH`
   when given, else `fetch_archive "$ARCHIVE_URL"` into the staging folder), and `unpack_into "$ARCHIVE" "$CLI_STAGING"`.
5. The archive holds one file named `<applicationName>` (ADR-0006's patch facts). `[ -f "$CLI_STAGING/$LAUNCHER" ] ||
   leave UnpackFailed`. Then `chmod +x`, `mv "$CLI_STAGING/$LAUNCHER" "$CLI_FILE"`, and `rm -rf "$CLI_STAGING"`.
   `LAUNCHER` is the application name for this step.
6. `fact cli.path "$CLI_FILE"`, timings as `INSTALL_BODY`, then `leave Ok`.

**`startCli`**, the start body's shape with the CLI's own command and ready line:
1. `[ -x "$CLI_FILE" ] || finish ServerFailedToStart`.
2. The log is `$DATA_DIR/.cli.$COMMIT.log` (F-2103's `.cli.<commit>.log`), created with `umask 077`.
3. `nohup "$CLI_FILE" command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "$CLI_DATA" </dev/null
   >"$LOG_FILE" 2>&1 9>&- &`. **No token on the command line:** `VSCODE_CLI_REQUIRE_TOKEN` is in the script's
   environment (section 2.3), and the `nohup` child inherits it. Record `CLI_PID=$!`.
4. The ready wait, as `start`'s (the same `READY_SECONDS` and ticks): `cli_ready_port` reads the first line matching
   `^Listening on 127\.0\.0\.1:[0-9]+$` in the log and prints the port. When it gives one: `fact cli.port <port>`,
   `fact cli.pid "$CLI_PID"`, `fact cli.log "$LOG_FILE"`, and `leave Ok`. A CLI that exits first, or no port when the
   wait ends, is `leave ServerFailedToStart`.
5. **The token is never a fact** (unlike the server's `started`, which reports its own token file): the caller made
   it and already knows it.

### 2.3 `run-step.ts`

`StepOptions` gains `environment?: Readonly<Record<string, string>>`, passed as the `ScriptRequest`'s `environment`
(today's runs pass `{}`).

### 2.4 `cli.ts`

```ts
export interface CliPlacement {
  /** The plan's `cli` kind (cli-02). */
  plan: Extract<Plan, {kind: 'cli'}>;
  /** The CLI archive's address, `cliDownloadUrlTemplate` expanded with `cliArchiveTemplateVariables` (cli-02). */
  address: string;
}

/** Places the CLI on the host: in the host lock loop; the client fallback as the server transfer's. */
export function installCli(channel, base: ScriptParameters, placement: CliPlacement, dependencies: TransferDependencies, cancellation): Promise<{kind: 'placed'; path: string} | TransferFailure>;

/** Starts the placed CLI; `token` goes in `VSCODE_CLI_REQUIRE_TOKEN` only. */
export function startCli(channel, base: ScriptParameters, token: string, dependencies: RuntimeDependencies, cancellation): Promise<StartOutcome>;
```

- `installCli` runs `installCli`'s script step through the same `transfer` machinery as a server archive (host-first
  with the client fallback of `where` and `clientFallback`; the client copy through the channel's `copyToHost`, which
  the window gives as the hidden copy terminal, card ssh-29). With `plan.download` false it runs the script step only,
  which reports the placed file. Its phases are today's (S041, S044 and S029 on the fallback, S084).
- `startCli` runs `startCli`'s step with `environment: {VSCODE_CLI_REQUIRE_TOKEN: token}`, inside the lock loop, and
  returns `StartOutcome`'s `started` with `server: {endpoint: {kind: 'port', port}, processId, connectionToken: token,
  reused: false}` (brief §4: the CLI's port and token, in today's shape). A `ServerFailedToStart` result is
  `serverStart`, as `startOrReuse`'s.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Unit (`bootstrap-script.test.ts`, `cli-lifecycle.test.ts` over a recording channel)

| Cite | Given | Expected |
|---|---|---|
| brief §3 | the `installCli` script with `cli: {name: 'codium-insiders-c1', dataFolder: '/h/.d/cli'}` | the parameter block has `CLI_NAME='codium-insiders-c1'` and `CLI_DATA='/h/.d/cli'` |
| V7a | the `startCli` script | it contains `command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "$CLI_DATA"` and no `--require-token` and no `--parent-process-id` |
| §S10 | `startCli(channel, base, 'tok-xyz', …)` | the channel's `runScript` request has `environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'}` |
| §S10 | the same | the request's `script` text does not contain `tok-xyz` |
| V7a | a recorded result block with `cli.port 41234` and `cli.pid 77` | `started`, endpoint `{kind: 'port', port: 41234}`, `processId` 77, `connectionToken` `'tok-xyz'`, `reused` false |
| V7a | `ServerFailedToStart` | `serverStart` |
| brief §4 | `installCli` with `plan.download` false | one script run (no download, no copy) |
| F-3902 rule 6 | `installCli` with `where: 'host'`, the host download failing, `clientFallback: true` | the client download and the copy ran, as the server transfer's fallback |
| §S10 | every step's `runScript` over `installCli` | `environment` is `{}` (only `startCli` carries the token) |

### 3.2 Real host (`tests/acceptance/server/cli.test.ts`, `pnpm test:acceptance:server`)

These need a CLI archive. They take the path of a local archive from `REMOTE_OSS_CLI_ARCHIVE` and **skip** when it is
unset (the CI source is the user's decision, brief §11). For a local run, point it at the user's `alpine-<arch>` CLI
tarball. The archive is copied with `copyIn`, and `installCli` runs with `ARCHIVE_PATH` (no network).

| Cite | Expected |
|---|---|
| F-2103 POST-2 | after `installCli`, the host has the executable file `<data>/<applicationName>-<commit>` and no `<data>/cli-bin/` |
| F-2103 BR-8 | a second `installCli` reports the same path and runs no unpack (the staging folder is never made) |
| V7a | `startCli` reports a port, and `nc -z 127.0.0.1 <port>` on the host succeeds |
| §S10 | while the CLI runs, no line of `ps -eo args` on the host contains the token |
| V7a | the CLI's log `<data>/.cli.<commit>.log` holds `Listening on 127.0.0.1:<port>` with the reported port |
| V7a | a client of the control protocol (cli-03a's `openCliControl` over a forward to the port) authenticates with the token |
| V7a | the same with a wrong token is `challengeRefused` |

Stop the CLI after each row with `kill <pid>` (no lifetime rule is built; the test ends what it started).

## 4. Rule for the worker

As card log-01; coverage at lib-server's 100/100/100 ratchet. The real-host rows need Docker and a CLI archive; put the
local run's output in the PR.

## 5. Gates and review

PR title `lib-server: the CLI's install and start on the host (card cli-03b, #412)`.

## 6. Open rows

None for this card. The CLI's lifetime and `--parent-process-id` stay open (`remote-oss/remote-ssh#21`). The CI source
of a CLI archive is the user's decision (brief §11), so the real-host rows skip without one.
