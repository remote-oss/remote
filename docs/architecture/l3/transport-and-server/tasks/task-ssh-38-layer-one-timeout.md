# Task card ssh-38: a login shell that never finishes or ends its startup fails the connect (#443)

Issue: #538. Why: athena's ruling on #443 after `remote-oss/remote-ssh#91` (2026-10-13). F-2704 AC-11 (a startup file
that reads its input or pauses past the connect timeout) and F-2206 AC-28 (a login shell that doesn't answer) both
require F-2601's timeout failure, `Connecting with SSH timed out.`, after the connect wait. Today ssh-34's session
bootstrap (`packages/lib-ssh/src/connection-server/session-bootstrap.ts`) has its watchdog kill layer 1 at
`LAYER1_SECONDS` (the connect timeout), then goes on to `exec sh` **without** the profile environment, and the connect
succeeds. Builder: daedalus after cli-07, or hestia (hermes assigns). Size: M.

A login shell that **ends its startup by itself** without printing `LAYER1-START` (F-2704 AC-13, AC-25, 7.E2: a
`.profile` ending `exit 1`) fails the connect at once (athena's ruling on #539). The reason is the same: never connect
silently without the user's environment. A login shell that can't start at all (`nologin`) already fails earlier,
because sshd runs it for our remote command too.

Not in this card: a startup file that **replaces bash with fish** still connects through layer 1 (athena has asked
metis to mark that AC-11 case reference-only).

## 1. The bootstrap (`session-bootstrap.ts`)

- **The watchdog notes that it fired.** Just before `kill -9 -"$LAYER1_PID" "$LAYER1_PID"`, it creates
  `"$LAYER1_DIR/timeout"` (`: >"$LAYER1_DIR/timeout"`).
- **After the waits, a fired watchdog with no start line ends the session.** When `"$LAYER1_DIR/timeout"` exists and
  `"$LAYER1_DIR/out"` holds no line `LAYER1-START`, the prelude prints exactly one line, `LAYER1-TIMEOUT
  <LAYER1_SECONDS>`, removes `"$LAYER1_DIR"`, and runs `exit 124` instead of `exec sh`.
- **A layer 1 that ended by itself, with no start line, also ends the session.** When `"$LAYER1_DIR/timeout"` doesn't
  exist and `"$LAYER1_DIR/out"` holds no line `LAYER1-START`, the prelude prints exactly one line, `LAYER1-EXITED
  <status>`, with layer 1's exit status (from `wait "$LAYER1_PID"`), removes `"$LAYER1_DIR"`, and runs `exit 1` instead
  of `exec sh`.
- **Every path that reaches `exec sh` says it's ready.** The prelude prints exactly one line, `LAYER1-READY`, just
  before **every** `exec sh` (hestia's option B on #538, athena on #539): after the start line was found, and on the
  two paths that skip layer 1 (`$SHELL` unusable, no temporary folder), which connect today and must keep connecting
  while the helper waits for the line.
- **The other cases are unchanged:** a start line present (the environment is taken, then `exec sh`), `$SHELL`
  unusable, and no temporary folder all go on to `exec sh` as today.
- The comment above `SESSION_BOOTSTRAP_LINES` says the session reaches `exec sh` **unless** the login shell outlasts
  its bound.

## 2. The two readers

**The shared session (helper):** the helper announces `connected`, and stops its connect wait, on the session's
`LAYER1-READY` line, **not** at ssh's "Authenticated to …" as today (`handler.ts` `setupMarkerOf`). The prelude runs
after authentication, so only then are `LAYER1-TIMEOUT` and `LAYER1-EXITED` read while every window is still in
`LoginWait`, and the acquire fails as a login:
- **`LAYER1-TIMEOUT <n>`:** `loginFailed` with the timeout reason, so the connect fails as F-2601's timeout,
  `Connecting with SSH timed out.`, and the log has `the login shell did not finish its startup within <n> s`;
- **`LAYER1-EXITED <n>`:** as below.

The helper's own connect wait (the connect timeout + 2 s) keeps running through the shell's startup. A slow but
finishing startup still connects inside it (F-2704 AC-14: a 25 s pause with a 40 s timeout). The progress stays
"Initializing VS Code Server" until `connected` (F-2304 AC-4). This moves contract S9's `connected` from
"authenticated" to "ready to run scripts" (raised with athena on #539). None of the markers is a run's output, and
none is passed to `ShellRuns`.

**Terminal mode (`terminal/terminal-runs.ts`):** the same three lines in the terminal's output after the prelude: on
`LAYER1-READY` the runs start, and the other two end the connect the same way, with the same log lines.

**`LAYER1-EXITED <n>`, in both readers:** the connect fails **at once** with F-2601's dialog **without** a reason
(`Could not establish connection to "<alias>".`, S030, 7.E2's form, not the timeout). The log has one line, AC-25's
statement: `the SSH session ended before the host reported its platform: the login shell's startup exited with status
<n>`.

Neither marker names a secret or a path: each is a fixed word, a space and a number.

## 3. Rows

| Cite | Given | Expected |
|---|---|---|
| F-2704 AC-11 | the bootstrap run by `sh` with `SHELL` a script that sleeps past `LAYER1_SECONDS=1` | its output is exactly `LAYER1-TIMEOUT 1`, and it exits 124 |
| #443 | the same with a shell that prints the start line at once | its first output line is `LAYER1-READY`, and the session reaches `exec sh` (a following `echo ok` prints `ok`) |
| athena on #539 | the bootstrap with `SHELL` unset | its output is `LAYER1-READY`, and a following `echo ok` prints `ok` |
| athena on #539 | the bootstrap where `mktemp -d` fails (a `PATH` whose `mktemp` exits 1) | its output is `LAYER1-READY`, and a following `echo ok` prints `ok` |
| #538 | the helper's session that prints `LAYER1-READY` after authentication | `connected` is announced on that line, not before |
| F-2704 AC-14 (real host) | a `.profile` that sleeps 25 s, `ConnectTimeout` 40 | the connect succeeds after the pause |
| F-2704 AC-13 | the bootstrap with a shell that exits 1 at once, with no start line | its output is exactly `LAYER1-EXITED 1`, and it exits 1 |
| F-2704 AC-25 | the helper's session whose first line is `LAYER1-EXITED 1` | the acquire fails at once with the reasonless failure (no S-id reason, so F-2601 shows S030), and the log has `the SSH session ended before the host reported its platform: the login shell's startup exited with status 1` |
| F-2704 AC-25 | terminal mode, the same line | the connect fails the same way |
| #443 | the bootstrap's temporary folder | it's gone after the timeout |
| F-2704 AC-11 | the helper's session whose first line is `LAYER1-TIMEOUT 5` | the acquire fails with the login-timeout failure, and the log has `the login shell did not finish its startup within 5 s` |
| F-2704 AC-11 | terminal mode, the same line | the connect fails the same way |
| F-2206 AC-28 (real host) | tooling-17's `mute` alias, default mode | the connect fails with the timeout failure after the connect wait, never succeeds |
| F-2704 AC-13 (real host) | a `.profile` ending in `exit 1` | the connect fails within a second, and the log has AC-25's statement |
| F-2704 AC-11 (real host) | ssh-34's sleeping `.bash_profile` row | it becomes a timeout row: the connect fails, where today it succeeds without the profile's variables |

Update ssh-34's real-host row in `tests/acceptance/server/login-shells.test.ts` and `tests/acceptance/server/*` for
the sleeping profile (it expected success without the profile environment). It now expects the timeout.

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `lib-ssh: a login shell that never finishes or ends its
startup fails the connect (card ssh-38, #443)`. athena, themis or triton.
