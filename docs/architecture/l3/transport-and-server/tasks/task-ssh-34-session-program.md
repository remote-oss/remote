# Task card ssh-34: every session hands its commands to POSIX `sh`, whatever the login shell (#443)

Why: #444 for #443, a 0.2 blocker under #299 (athena, contracts §S10 d49cac7). The shared `ssh` session is started with **no
remote command**, so the user's login shell reads `ShellRuns`' commands (`commandsFor`) from standard input. Those
commands are POSIX: `NAME='v' sh -c '…'`, `"$?"`, a here-document. Measured over real `ssh` on Alpine 3.22, one user per
login shell, both scripts of section 3.2 sent at once:

| Login shell | Today (no remote command) | This card's session program |
|---|---|---|
| bash, zsh, dash, mksh | both end markers, status 0 | both end markers, status 0 |
| tcsh, csh | first run `m1:end 1`, the second never ends (`Unmatched '`) | both end markers, status 0 |
| fish | no end marker; every run waits for its deadline | both end markers, status 0 |

athena's first idea, a fixed first line on standard input that `exec`s `sh`, doesn't work for fish. fish runs
nothing until it has decided its input is complete, so the first line either waits or swallows later lines (measured:
a line sent after the first was lost). The card uses the **remote command** instead. That command is ssh-32's prelude
form, `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`, which every login shell passes to `sh` unchanged (contracts
§S10). Its prelude, the first `<n>` bytes of standard input, is the **session bootstrap**. It takes layer 1 from the
user's own login shell (F-2704 BR-4) and then `exec`s `sh`, which reads `commandsFor`'s commands from the rest of
standard input. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/connection-server/session-bootstrap.ts` | new: `SESSION_BOOTSTRAP_LINES`, `sessionStart` (section 2) |
| `packages/lib-ssh/src/connection-server/helper.ts` | builds `sessionStart` from its wait; the invocation's `remoteProgram` (section 2) |
| `packages/lib-ssh/src/connection-server/handler.ts` | `sessionPrelude`, written first on the shared session (section 2) |
| `packages/lib-ssh/src/terminal/terminal-runs.ts` | writes it first on the install terminal (section 2) |
| `packages/lib-ssh/src/index.ts` | export `sessionStart` |
| `packages/remote-ssh/src/pipeline/connection-request.ts` | `installRequestOf` takes `sessionStart(…).remoteProgram` (section 2); `connectionRequestOf` is unchanged |
| `packages/lib-ssh/test/unit/shell-runs.test.ts`, `packages/remote-ssh/test/unit/connection-request.test.ts` | unit rows (section 3.1) |
| `tests/acceptance/server/shared-session.ts` | unchanged: the helper it runs builds the session start itself |
| `tests/acceptance/server/login-shells.test.ts` | new: the real-`ssh` rows (section 3.2) |
| `tests/acceptance/host/Dockerfile`, `tests/acceptance/host/start-sshd` | the shells and `HOST_SHELL` (section 3.2); tooling-14 builds on this |

## 2. Contract

### 2.1 The bootstrap script

`SESSION_BOOTSTRAP_LINES` is a `readonly string[]` holding exactly this POSIX script (measured as written, section
3.2):

```sh
LAYER1_DIR=$(mktemp -d 2>/dev/null) || LAYER1_DIR=
if [ -n "$LAYER1_DIR" ] && [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then
  printf '%s\n' 'exec sh -c "echo LAYER1-START; export -p" </dev/null' >"$LAYER1_DIR/in"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>/dev/null &
  else
    "$SHELL" -l <"$LAYER1_DIR/in" >"$LAYER1_DIR/out" 2>/dev/null &
  fi
  LAYER1_PID=$!
  (
    sleep "$LAYER1_SECONDS" &
    LAYER1_SLEEP=$!
    trap 'kill -9 "$LAYER1_SLEEP" 2>/dev/null; exit 0' TERM
    wait "$LAYER1_SLEEP"
    kill -9 -"$LAYER1_PID" "$LAYER1_PID" 2>/dev/null
  ) >/dev/null 2>&1 </dev/null &
  LAYER1_WATCH=$!
  wait "$LAYER1_PID" 2>/dev/null
  kill -TERM "$LAYER1_WATCH" 2>/dev/null
  wait "$LAYER1_WATCH" 2>/dev/null
  kill -9 -"$LAYER1_PID" 2>/dev/null
  eval "$(sed -n '/^LAYER1-START$/,$p' "$LAYER1_DIR/out" | sed 1d)"
fi
[ -n "$LAYER1_DIR" ] && rm -rf "$LAYER1_DIR"
unset LAYER1_DIR LAYER1_PID LAYER1_WATCH LAYER1_SECONDS
exec sh
```

Why each part (each was measured, and each first attempt without it failed):
- **The login shell itself, as a login shell** (`"$SHELL" -l`), so each shell reads its own startup files, as BR-4's
  table records: bash `.bash_profile` (or `.profile`), zsh `.zshenv` and `.zprofile` (never `.profile`), dash and
  mksh `.profile`, fish `config.fish`, csh and tcsh `.login`. `-l` is the only argument because csh and tcsh accept
  `-l` only alone (`tcsh -l -c …` is "Unknown option"). The command goes on the login shell's standard input, from a
  file, so a profile that reads standard input gets the command or end of file, never the session's commands.
- **`exec sh -c "echo LAYER1-START; export -p"`** is parsed by every login shell alike (double quotes, no `$`). `sh`
  prints the environment the login shell built, in POSIX's re-readable form. A value with `'`, a newline and `$x`
  round-tripped. Everything before the marker line (the motd, a profile's `echo`) is dropped.
- **The bound.** A watchdog subshell owns its own `sleep` and kills the login shell, and with `setsid` its whole
  process group, after `LAYER1_SECONDS`. When the login shell ends first, the watchdog gets `TERM` and kills its
  `sleep`, so no process outlives the bootstrap. Measured: a `.bash_profile` of `sleep 30` held the session 3.1 s with
  a bound of 3, and `ps` showed no `sleep` during or after the session. (A first version killed only the watchdog,
  which left its `sleep` running under init for the whole bound.) The watchdog's output goes away from the session's,
  or `ssh` would wait for it. When the bound fires, layer 1 is empty and the session goes on.
- A profile that exits, fails or is killed loses only its own variables. The session always reaches `exec sh`.

### 2.2 `sessionStart`

```ts
/** The remote command of a session that `ShellRuns` writes to, and the prelude written before any of its commands. */
export function sessionStart(layerOneSeconds: number): {remoteProgram: string; prelude: string};
```

- `prelude` is `LAYER1_SECONDS=<layerOneSeconds>\n` followed by `SESSION_BOOTSTRAP_LINES.join('\n')` and a final
  `\n`. `layerOneSeconds` is a whole number from 1 to 600; any other value throws `RangeError`.
- `remoteProgram` is `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`, with `<n>` the prelude's length in UTF-8 bytes:
  ssh-32's form, built by the same function as `planScript`'s. Extract it as `preludeProgram(byteCount)` in
  `remote-program.ts` and use it in both places, so the form exists once.

**Where it applies:**
- **The shared session.** The helper (`helper.ts`) builds `start = sessionStart(seconds)` from the `waitSettings` it
  already computes. Its invocation takes `remoteProgram: start.remoteProgram`, and `ConnectionHandler` gets
  `sessionPrelude: start.prelude`, which it writes to the session's standard input once, right after the spawn and before
  `ShellRuns` writes anything. The client's request is unchanged, so the program and the prelude have one source.
- **The install terminal of terminal mode.** `installRequestOf`'s `remoteProgram: 'sh'` becomes `start.remoteProgram`
  for `start = sessionStart(seconds)` of the connect's wait, and `TerminalRuns` gets `start.prelude` and writes it
  before its first run.
- **The bound, `seconds`,** is the connect wait in whole seconds, rounded up and at least 1: the host's
  `ConnectTimeout` or the setting, as `waitSettings` already reads them. An unbounded wait (the host's `0`) uses its
  `unboundedWaitSeconds` (600).

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Unit

| Cite | Given | Expected |
|---|---|---|
| #443 | `sessionStart(15).prelude` | it starts with `LAYER1_SECONDS=15\n` and ends with `exec sh\n` |
| #443 | `sessionStart(15).remoteProgram` | `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`, `<n>` the prelude's UTF-8 byte length |
| #443 | `sessionStart(0)`, `sessionStart(601)`, `sessionStart(1.5)` (one `it` each) | `RangeError` |
| §S10 | `sessionStart(15).remoteProgram` | it holds exactly two `'` and no newline |
| #443 | `planScript` with input and an environment | its `remoteProgram` equals `preludeProgram` of its prelude's length (the shared form) |
| #443 | the helper with a request whose `effective.connectTimeout` is `20` | the spawned `ssh`'s last argument is `sessionStart(20).remoteProgram` |
| #443 | the same with `effective.connectTimeout` `0` and `unboundedWaitSeconds` 600 | `sessionStart(600).remoteProgram` |
| #443 | the same with no host value and the setting `7.5` | `sessionStart(8).remoteProgram` |
| #443 | `installRequestOf(…)` | `remoteProgram` is `sessionStart(<wait>).remoteProgram` |
| #443 | `ConnectionHandler`, over the recording spawner, with `sessionPrelude: 'P\n'` and one run | the session's standard input starts with `P\n`, and the run's commands follow |
| #443 | `TerminalRuns` with a prelude and two runs | the terminal got the prelude once, before the first run's commands |

### 3.2 Real `ssh`, per login shell (`tests/acceptance/server/login-shells.test.ts`, `pnpm test:acceptance:server`)

**The host.** The Dockerfile's `apk add` gains `bash zsh dash fish tcsh mksh shadow`, and each shell's path is
appended to `/etc/shells` unless present (`csh` is tcsh's link). `start-sshd` reads `HOST_SHELL` (unset: `/bin/sh`,
today's) and runs `usermod -s "$HOST_SHELL" harness` before sshd starts. `host-fixture.ts`'s `startHost` takes an
optional `{shell}` and passes `-e HOST_SHELL=<path>`. Each row writes its startup files to `/home/harness` with
`onHost` (owned by `harness`) and removes them after.

**The rows**, over `openSharedSession` with a connect wait of 5 s, one `describe` per shell on its own host.

For every shell (`/bin/sh`, `/bin/bash`, `/bin/zsh`, `/usr/bin/dash`, `/usr/bin/fish`, `/bin/tcsh`, `/bin/csh`,
`/bin/mksh`):

| Cite | Expected |
|---|---|
| #443, F-2704 AC-10 | two scripts run one after the other on the session, each exiting 0 |
| F-2102 | a run's environment `{A: "a!b'c"}` reaches the script as written |
| F-2102 | a text input of 70 000 random bytes arrives byte for byte |

Layer 1, one row per line of BR-4's table that this host can show. The startup file sets `LAYER1` and prints `noise`.
The script prints `$LAYER1`:

| Login shell | Startup file | `$LAYER1` | Also |
|---|---|---|---|
| bash | `.bash_profile` | its value | |
| bash | `.profile` only | its value | |
| zsh | `.zshenv` and `.zprofile` (two variables) | both values | |
| zsh | `.profile` only | empty | BR-4: zsh never reads `.profile` |
| dash, mksh, sh | `.profile` | its value | |
| fish | `.config/fish/config.fish` with `set -gx` | its value | |
| tcsh, csh | `.login` with `setenv` | its value | |
| mksh | `.profile` exporting `it's`, a newline, `two $x` | exactly that | |
| any (bash) | every row | | no run's output contains `noise` |

Bound and failure rows:

| Cite | Login shell, startup file | Expected |
|---|---|---|
| #443 | bash, `.bash_profile` `sleep 30` | both scripts run, the first within 5 s + 2 s of the session's start |
| #443 | the same | right after the session ends, `ps -o args` on the host shows no `sleep` (neither the profile's nor the watchdog's) |
| #443 | zsh, `.zprofile`, a 5 s bound | while the first script runs, `ps -o args` on the host shows no `sleep` (the watchdog is gone once the login shell ended) |
| #443 | dash, `.profile` `read x; exit 3` | both scripts run, and `$LAYER1` is empty |

**Before the fix.** Run the "two scripts" rows with `remoteProgram` absent and paste the counts into the PR. tcsh, csh
and fish must fail.

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets. The real-host rows need Docker; put the local run's
output in the PR.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: every session hands its commands to POSIX sh (card ssh-34, #443)`. Security review by
themis or triton: the bootstrap `eval`s the login shell's `export -p`, so the PR states that only the user's own
startup files can reach it and that the remote command carries no value.

## 6. Open rows

None.
