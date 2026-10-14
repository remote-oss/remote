# Task card tooling-36: a masked host-key question and a CheckHostIP name

Issue: #719. Release 0.2, harness gap H4 of the gate's class-"b" ACs. Size: M. Builder: assigned by hermes
(task:claude). Verification: proteus. **Depends on** coverage-21 (#598), for its host blocks and helpers:
- `hostKeyAlias`, `knownHostsOf`, `hostKeyLine`, `wrongKeyLine` and `FP`;
- coverage-14's `userSettings` (#568).

## 1. Why

coverage-21 (#598, §3) leaves two groups of F-2305 `todo`, each waiting for something the run lacks.

**The masked input** (AC-3, 4, 29, 35, all built on "the AC-1 input"):
- BR-2 gives the masked input only for a host-key question the pick's pattern doesn't take: a fingerprint line without
  the continue-connecting line, or that line alone (AC-43).
- The run's OpenSSH always asks the classic question, so it always gets the pick.

**`CheckHostIP`** (AC-39, 40, 41, 45) needs a host **name** that resolves to a **non-loopback** address of the harness
host:
- ssh turns the IP check off for a loopback address, and when the name is the address;
- every alias of the run is `127.0.0.1`.

AC-1, 5, 6, 42 and 43 were in this gap, but D-65's recorded cases cover them (hermes, 2026-10-14).

## 2. The masked client

**`tests/acceptance/windows/masked-ssh/ssh`** (POSIX sh, installed by the run as `<run>/clients/masked/ssh`, mode 755)
does three things:
1. it exports `HARNESS_REAL_ASKPASS="$SSH_ASKPASS"`;
2. it sets `SSH_ASKPASS=<run>/clients/masked/askpass`;
3. it runs `exec <real ssh> "$@"`.

`<real ssh>` is `command -v ssh` as the run found it, written into the script when the run installs it.

**`tests/acceptance/windows/masked-ssh/askpass`** (POSIX sh):
- for a prompt containing `key fingerprint is`, it drops the line holding those words and calls
  `exec "$HARNESS_REAL_ASKPASS" "<the rest>"`. The rest is the continue-connecting line alone, which AC-43 gives the
  masked input;
- any other prompt goes to `exec "$HARNESS_REAL_ASKPASS" "$1"` unchanged.

Its answer is the real askpass's, and the environment is passed through whole, so our askpass helper still finds its
channel.

**A unit row of the script** (`tools/` or `tests/acceptance/server/`, real `sh`, with a fake real askpass that prints its
argument):
- the classic question `ED25519 key fingerprint is SHA256:…\nAre you sure you want to continue connecting
  (yes/no/[fingerprint])? ` arrives as its last line alone;
- `Enter passphrase for key '/x': ` arrives unchanged.

**The launch:** a plain launch `masked-question` (suite `masked-question`) whose settings set `remote.SSH.path:
'<run>/clients/masked/ssh'`, the run token as `acceptance-launches.ts` replaces it. It goes in `tsconfig.json`,
`knip.jsonc` and the README.

## 3. The CheckHostIP name

**The name and address:**
- **Name:** `harness-ip.test` (RFC 6761 `.test`).
- **Address:** the harness container's own address on Docker's default bridge, `docker inspect -f
  '{{.NetworkSettings.IPAddress}}' <container>`, port 22. That's the container's sshd itself, not the published loopback
  port, so ssh sees a non-loopback address.

**The line:** after starting the host, the VSCodium run appends `<address> harness-ip.test # remote-oss-acceptance
<runId>` to the client's `/etc/hosts` with `sudo -n tee -a /etc/hosts`.
- **Removal:** the run's end removes every line ending with that marker for its run id (`sudo -n sed -i`). The run's
  cleanup (`acceptance-run.ts`, the one that removes a killed job's containers) removes marker lines of any run id whose
  containers are gone.
- **No sudo:** if `sudo -n true` fails, the run doesn't add the line, and sets `HARNESS_HOSTS_LINE=absent`. The rows of
  §4.2 then fail with `harness-ip.test needs passwordless sudo to add a line to /etc/hosts`. They don't skip. Every other
  launch is unaffected.

**The rows' host blocks** use `hostKeyAlias` with:
- `HostName harness-ip.test`, `Port 22`;
- `CheckHostIP yes`;
- `HashKnownHosts no`, since the client's own `/etc/ssh/ssh_config` may hash and then no row could read the line.

## 4. Rows

### 4.1 `tests/acceptance/masked-question/masked.test.ts`

Each block has an empty known file, unless the row says otherwise. `Q` is the continue-connecting line. A failing
window's script ends as coverage-21's do.

| Cite | Window, block; script | Expected |
|---|---|---|
| F-2305 AC-3 | `m3`, `hk-m3`; `maskedInput` `Q` → `{text: 'yes'}` | a `maskedInput` line; `m3` connected, its remote indicator `SSH: hk-m3` (`windowState` and the record's progress); `hk-m3.known` holds exactly one line, the host's key |
| F-2305 AC-4 | `m4`, `hk-m4`; `maskedInput` → `{text: FP}` | as AC-3 |
| F-2305 AC-29 | `a` on `hk-m29` with `maskedInput` held (`after: 'm29-escape'`); once `heldLines('a')` has its line, `b` on `hk-m29` with `maskedInput` → `{text: 'yes'}` | a `progress` line of `b` with `Waiting for other windows to connect`; a `maskedInput` line of `b` with the same question as `a`'s; both windows connected |
| F-2305 AC-35 | after AC-29, `signal('m29-escape')` | `a`'s held entry answers `dismiss` (its record line); `a` still connected (`windowState('a').remoteAuthority` unchanged) |

### 4.2 `tests/acceptance/windows/host-key-ip.test.ts`

These run in coverage-21's windows suite. `IP` is the container's bridge address. "Wrong" is `wrongKeyLine`'s key.

| Cite | Known file | Script | Expected |
|---|---|---|---|
| F-2305 AC-39 | `harness-ip.test <host key>` and `IP <wrong key>` | `pick` `continue connecting` → `dismiss` | a `pick` line whose title is ssh's warning text without the question line, whose placeholder is `Are you sure you want to continue connecting?`, and whose items are `Continue`, `Cancel` in that order |
| F-2305 AC-40 | the same | `pick` → `{label: 'Continue'}` | connected; the known file unchanged |
| F-2305 AC-41 | the same | `pick` → `{label: 'Cancel'}`; then a second window with `pick` → `dismiss` | each: the AC-6 dialog; the known file unchanged |
| F-2305 AC-45 | empty | the fingerprint `pick` → `yes` | connected; the known file holds one line whose host field is `harness-ip.test,IP` |

The script surfaces and answers are coverage-21's (the `pick` answers). If the continuation pick's record line keeps its
placeholder in another field, assert that field and say so in the PR.

Catalogue: the eight ACs go from `todo` to `acceptance`.

## 5. Gates and review

All gates, the changed tools files at 100 %, shellcheck on the two scripts, and the full VSCodium run green. Paste the
two suites' summaries and `ssh -V`.

**The PR opens with the `needs-verification` label.** proteus checks on the CI runner:
- `sudo -n` works;
- the `/etc/hosts` line is added, and `ssh -o CheckHostIP=yes harness-ip.test` reaches the container;
- the line is gone after the run, also after a cancelled job.

PR title `tests: a masked host-key question and a CheckHostIP name (card tooling-36, #719)`. themis or triton reviews;
athena gives the tag check.

## 6. Open rows (stop and report on #719)

1. Our build doesn't run ssh with `SSH_ASKPASS` (so the wrapper's askpass never sees the question). Report how the
   question reaches the product. A wrapper of another kind is a new decision.
2. The client host can't reach the container's bridge address (a runner with Docker in another network namespace).
   Report it to proteus, and leave §4.2 `todo`.
3. The run's OpenSSH warns about the IP with text that doesn't carry "Offending key for IP" or "Matching host key", so
   BR-2 gives no continuation pick. Report the warning text.
