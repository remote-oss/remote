# Task card connect-60: ssh's error lines are classified only before the session starts, in their anchored forms

Issue: #833. Release 0.2, **gating** (ADR-0010 rule 2; the audit, connect-59 #832, row P5). Size: M. Builder:
`task:claude`.

## 1. The defect

**What ADR-0010 rule 2 says:** ssh's own diagnostics are read in their documented, anchored form, and **only before
the session starts**. A login's startup files run only after authentication, and after that ssh's stderr also carries
remote text: `~/.ssh/rc`, PAM session modules, a `.bashrc` that bash sources under sshd.

**What main does:**

**(a) Substrings.** `classify` (`lib-ssh/src/diagnostics/classify.ts:58`) matches `line.includes(text)` anywhere in any
line, for every text of `NETWORK_RULES` and `FAILURE_TEXTS` (`rules.ts:43-69`). The Permission-denied rule takes the
last line containing `Permission denied (`.

**(b) The window.**
- **Shared mode:** the helper collects stderr lines into `errorLines` while `state === 'connecting'`
  (`connection-server/handler.ts:302`). That lasts until `LAYER1-READY`, so it includes every line after `Authenticated
  to`.
- **Terminal mode:** every terminal line is pushed to `lines` (`remote-ssh/src/pipeline/terminal-connection-step.ts:246`)
  and classified when the terminal ends (`:271`).

**Measured** (unit form on main ae5c024b, `classify` with the lines
`debug1: SSH2_MSG_NEWKEYS received`, `Authenticated to 127.0.0.1 ([127.0.0.1]:22) using "publickey".`, then one line):

| Line after authentication | Classification |
|---|---|
| `curl: (28) Connection timed out after 5001 milliseconds` | `timeout`, S137 |
| `ERROR: Your fridge is not running: Permission denied (fridge)` | `authentication`, text `Permission denied (fridge)` |
| `backup.sh: Could not resolve hostname nas` | `unreachable`, S032 |
| (none) | `unknown` |

So a `.bashrc` that runs a network check changes the failure dialog of any connect that later fails (a login-shell
timeout, a failed server start, a lost session) in both modes.

## 2. The fix

### 2.1 The window: only lines before `Authenticated to`, read from connect-66's one collection

**One ssh-stderr pipeline (athena, F-2003 scope ruling, register 2bb86d6).** connect-66 (#845) collects ssh's error lines
once per connect, as `SshLines` (`lib-ssh/src/connection-server/ssh-lines.ts`). Its `beforeAuthentication()` gives the
lines before the first `Authenticated to ` line, and the window logs `all()` live as `[ssh] …`. This card's classifier
reads that same collection; it keeps no line buffer of its own.

- **The window:** `SshLines.beforeAuthentication()`, the lines before the first line `setupMarkerOf` reports as
  `authenticated`. Use connect-55's mux line too, once #814 is on main, and say so in the PR. When no such line was
  seen, for example a failure before login, every line counts, as today.
- **`classify`** is called with that window and nothing else. The lines after it reach the log through connect-66, and
  are never matched.
- **Shared mode (`handler.ts`):** call `classify` with `sshLines.beforeAuthentication()`. **Remove** the handler's own
  `errorLines` array (`handler.ts:302`): `SshLines` replaces it.
- **Terminal mode (`terminal-connection-step.ts`):** `failureOf(end, …)` classifies `sshLines.beforeAuthentication()`.
  **Remove** the step's own `lines` array kept for `failureOf` (`:246`): the terminal step's `SshLines` replaces it.
- **The post-session rules of §2.2** read `SshLines.all()`, under §2.2's conditions.

**Whichever lands second:**
- **If this card lands first:** it introduces the window over its own collection, a `beforeAuthentication`-style cut
  of the existing arrays. connect-66 then moves the window onto `SshLines.beforeAuthentication()`, removes the arrays,
  and keeps this card's rows.
- **If connect-66 lands first:** this card builds on `SshLines` directly, as written above.

### 2.2 Post-session messages ssh writes itself

Four rules describe failures ssh reports **after** authentication:
- `forwardingProhibited`;
- `forwardingDisabledByClient`;
- `brokenPipe`;
- `connectionClosed` (the session closing).

ssh writes these lines itself, but after authentication its stderr also carries remote text. **The card's proposal,
for athena** (open row 1):
- these four rules may read lines after `Authenticated to`, but only in their anchored form (§2.3);
- and only when ssh's own exit status is **255** (ADR-0010 rule 3). ssh exits with 255 for its own errors; a remote
  command's failure gives that command's status.

Every other rule reads only the cut window.

### 2.3 Anchored forms

Each rule becomes a regular expression anchored at the start of the line, after one trailing `\r` is removed. Forms
from OpenSSH's own messages (portable OpenSSH, `ssh.c`, `sshconnect.c`, `sshconnect2.c`, `packet.c`, `channels.c`,
`clientloop.c`):

| Rule | Anchored form |
|---|---|
| `Could not resolve hostname` | `^ssh: Could not resolve hostname \S+: ` |
| connect errors (`Network is unreachable`, `No route to host`, `Connection timed out`, `Operation timed out`, `Can't assign requested address`, and so on) | `^ssh: connect to host \S+ port \d+: <text>$` |
| `Permission denied (` | `^(\S+@\S+: )?Permission denied \([^)]*\)\.?$`. The reason text keeps the part from `Permission denied` on, as today |
| `Host key verification failed.` | `^Host key verification failed\.$` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | `^@\s+WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\s+@$` |
| `hostname contains invalid characters` | `^ssh: hostname contains invalid characters$` |
| `Port forwarding is disabled to avoid man-in-the-middle attacks` | `^Port forwarding is disabled to avoid man-in-the-middle attacks\.$` |
| `administratively prohibited` | `^channel \d+: open failed: administratively prohibited: ` |
| `send disconnect: Broken pipe` | `^(\S+: )?Connection to \S+ port \d+: send disconnect: Broken pipe$`, and the form `^\S+: Connection to …` that `packet_write_wait:` writes |
| `Connection closed.` and `Connection closed by …` | `^Connection closed\.$`, `^Connection closed by \S+ port \d+$` and `^Connection closed by remote host$`, plus the `kex_exchange_identification: ` prefixed form |
| `The process tried to write to a nonexistent pipe` | as ssh prints it on Windows; this release is Linux-client first. Keep it anchored at line start |
| `Can't open user config file … Permission denied` | `^Can't open user config file .*: Permission denied$` |

**Measure the exact forms before writing them.** For each rule, run the real client against the harness:
- `refused`, `blackhole`, `nowhere` and `badkey`;
- a host-key change;
- an unreadable config file.

The acceptance failure cases (`tests/acceptance/suite-failure/cases.json`) already produce most of them. Record each
line in the PR. Where a measured line differs from the table, the measurement wins; write it into the PR.

### 2.4 The tests that change

- The existing `classify` rows that pass bare fragments (`'Network is unreachable'`, `'Connection timed out'`,
  `'Could not resolve hostname'`) are rewritten to the full lines ssh prints, from §2.3's measurement.
- The row with `'prefix Network is unreachable suffix'` now expects `unknown`.
- Name each changed row's reason in the PR.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `classify.test.ts` | `ADR-0010: lines after Authenticated to never change the classification` | each of the three measured lines (§1) after the authenticated line | `unknown` (they fail on main) |
| `classify.test.ts` | `ADR-0010: a rule's text mid-line is not ssh's message` | `motd: Permission denied (publickey) is a test`, `see ssh: connect to host x port 22: Connection refused` (a prefix inside a line), before authentication | `unknown` |
| `classify.test.ts` | (each rule) `F-2603: <rule> in ssh's own form` | the measured full line | today's kind and reason |
| `classify.test.ts` | `ADR-0010 rule 3: forwarding prohibited after authentication counts only with ssh's 255` | the anchored `channel 2: open failed: administratively prohibited: open failed` after authentication, with status 255, then with status 1 | `forwardingDisabled`; then `unknown` |
| `ssh-lines.test.ts` (connect-66's file, or this card's if it lands first) | `connect-60's window: beforeAuthentication stops at connect-55's mux line too` | lines, then `debug1: mux_client_request_session: master session id: 2`, then `Permission denied (fridge)` | `beforeAuthentication()` holds only the lines before the mux line |
| `handler.test.ts` (shared) | `ADR-0010: the helper classifies only the lines before authentication` | a fake session that writes `Authenticated to …`, then `curl: (28) Connection timed out…` to stderr, then ends during the layer-1 wait | `loginFailed` with kind `timeout` (the wait's own), not S137's text, and the curl line in the log |
| `terminal-connection-step.test.ts` | `ADR-0010: a terminal that ends after authentication is not classified from the shell's output` | the terminal prints `Authenticated to …`, then `…: Permission denied (fridge)`, then ends | not `authentication` |

**Defect rule:** the first, fifth and sixth rows must fail on main and pass with the fix. Paste both runs.

**Acceptance:** connect-59's acceptance row covers it: a `.profile` that prints those lines, plus a forced failure.

## 4. Gates and review

Run all gates, with the changed files at 100 %. Use the PR title
`lib-ssh, remote-ssh: ssh's error lines are classified only before the session starts (card connect-60, #833)`.
Request athena only.

## 5. Open rows (stop and report on #833)

1. **For athena, before the build:** §2.2's rule. Post-session ssh messages count only in anchored form and only with
   exit status 255. The alternative is "never after the session", which would lose the forwarding-prohibited reason
   (F-2305, F-2409).
2. A measured ssh line fits none of §2.3's forms. Report it.
