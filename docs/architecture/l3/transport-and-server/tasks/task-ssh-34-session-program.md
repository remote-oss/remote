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
a line sent after the first was lost). The card uses the **remote command** instead. sshd passes it to the login
shell as `<shell> -c '<command>'`, and every login shell parses a command made of `sh` and single-quoted words alike
(the S10 rule). Then POSIX `sh`, not the login shell, reads standard input. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/connection-server/shell-runs.ts` | `SESSION_PROGRAM` (section 2) |
| `packages/lib-ssh/src/index.ts` | export `SESSION_PROGRAM` |
| `packages/remote-ssh/src/pipeline/connection-request.ts` | `connectionRequestOf`'s request and `installRequestOf` take `remoteProgram: SESSION_PROGRAM` (section 2) |
| `packages/lib-ssh/test/unit/shell-runs.test.ts`, `packages/remote-ssh/test/unit/connection-request.test.ts` | unit rows (section 3.1) |
| `tests/acceptance/server/shared-session.ts` | the fixture's request takes `remoteProgram: SESSION_PROGRAM`, as the extension's does |
| `tests/acceptance/server/login-shells.test.ts` | new: the real-`ssh` rows (section 3.2) |
| `tests/acceptance/host/Dockerfile`, `tests/acceptance/host/start-sshd` | the shells and `HOST_SHELL` (section 3.2); tooling-14 builds on this |

## 2. Contract

```ts
/**
 * The remote command of every session that `ShellRuns` writes to: POSIX `sh` reads the commands, whatever the
 * user's login shell, after taking the environment of the login profile.
 */
export const SESSION_PROGRAM =
  `sh -c 'if [ -f "$HOME/.profile" ]; then eval "$( (. "$HOME/.profile" >/dev/null 2>&1 </dev/null; export -p) 2>/dev/null )"; fi; exec sh'`;
```

Exactly this text, which is `sh -c` and one single-quoted word, so every login shell passes it to `sh` unchanged:
- **The login profile (F-2508 BR-4, layer 1).** `~/.profile` is sourced in a **subshell**. Its output and standard
  input are cut off, and its exported variables come back through `export -p`, which POSIX defines as re-readable
  input (measured: a value with `'`, a newline and `$x` came through as written). A profile that calls `exit`, trips
  `set -e` or reads standard input can't end the session or eat its commands. It only loses its own variables. bash
  users get `.profile` too, which bash without a terminal doesn't read (measured: today bash's runs saw no profile
  variable).
- `exec sh` then reads the commands from standard input, as `ShellRuns` writes them. Nothing in `commandsFor` changes.
- Login-shell startup files that print (fish's `config.fish` ran with `-c` and printed before the first marker) are
  already skipped: `ShellRuns` reads only from its start marker on.

**Where it applies:**
- **The shared session:** `connectionRequestOf` puts `remoteProgram: SESSION_PROGRAM` into the request it gives the
  helper (`JSON.stringify({...base, purpose: 'connection', remoteProgram: SESSION_PROGRAM})`). `invocationOf` already
  appends `remoteProgram` after the target for `purpose: 'connection'`.
- **The install terminal of terminal mode:** `installRequestOf`'s `remoteProgram: 'sh'` becomes `SESSION_PROGRAM`, so
  `TerminalRuns` gets the same profile layer.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Unit

| Cite | Given | Expected |
|---|---|---|
| #443 | `SESSION_PROGRAM` | it starts with `sh -c '` and ends with `'`, and holds no other `'` (one single-quoted word) |
| #443 | `connectionRequestOf(…)` | the parsed `options.request` has `remoteProgram` equal to `SESSION_PROGRAM` |
| #443 | `installRequestOf(…)` | `remoteProgram` is `SESSION_PROGRAM` |
| #443 | `invocationOf` of a `purpose: 'connection'` request with `remoteProgram: SESSION_PROGRAM` | the last argument is `SESSION_PROGRAM`, right after the target |

The second row is checked against the other three rows. Change one character of `SESSION_PROGRAM` and only the first
row's text test stays green; the other rows compare by identity.

### 3.2 Real `ssh`, per login shell (`tests/acceptance/server/login-shells.test.ts`, `pnpm test:acceptance:server`)

**The host.** The Dockerfile's `apk add` gains `bash zsh dash fish tcsh mksh shadow`, and each shell's path is
appended to `/etc/shells` unless present (`csh` is tcsh's link). `start-sshd` reads `HOST_SHELL` (unset: `/bin/sh`,
today's) and runs `usermod -s "$HOST_SHELL" harness` before sshd starts. It also writes the fixture's profile files
to `/home/harness`, owned by `harness`, the same files for every shell:
- `.profile`: `export PROFILE_VAR=from-profile` and `echo profile-noise`;
- `.login` (csh, tcsh): `echo login-noise`;
- `.config/fish/config.fish`: `echo fish-noise`.

`host-fixture.ts`'s `startHost` takes an optional `{shell}` and passes `-e HOST_SHELL=<path>`.

**The rows.** For each of `/bin/bash`, `/bin/zsh`, `/usr/bin/dash`, `/usr/bin/fish`, `/bin/tcsh`, `/bin/csh`,
`/bin/mksh` and the default `/bin/sh` (a `describe` per shell, its own host), over `openSharedSession`:

| Cite | Expected |
|---|---|
| #443, F-2704 AC-10 | two scripts run one after the other on the session, each exiting 0, and both resolve with their output |
| F-2102 | a run's environment `{A: "a!b'c"}` reaches the script as written (csh history and quoting) |
| F-2508 BR-4 | a script printing `$PROFILE_VAR` prints `from-profile` |
| F-2102 | a text input of 70 000 random bytes (base64) arrives byte for byte |
| #443 | none of the noise lines appears in a run's output |

And one host, `/bin/sh`, with a `.profile` of `exit 3`: the two scripts still run (the profile can't end the session).

**Before the fix.** Run the per-shell rows with `remoteProgram` absent and paste the counts into the PR. tcsh, csh and
fish must fail.

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets. The real-host rows need Docker; put the local run's
output in the PR.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: every session hands its commands to POSIX sh (card ssh-34, #443)`. Security review is
not needed (no secret moves), but the PR states that `SESSION_PROGRAM` carries no value.

## 6. Open rows

None.
