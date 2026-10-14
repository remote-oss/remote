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
'<run>/clients/masked/ssh'`. A launch's settings get `withRunTokens` in `runLaunches` (`acceptance.ts`), plain launches
included, so `<run>` is replaced there. The suite folder gets a `tsconfig.json` like `explorer/`'s, and is registered in
the root `tsconfig.json`'s `references`, `eslint.config.ts`'s `TYPESCRIPT_PROJECTS`, `knip.jsonc`'s entries and the
README's launch list.

## 3. The CheckHostIP name

**The name and address:**
- **Name:** one per run, so overlapping runs on a shared runner don't collide: `harness-ip-<h>.test` (RFC 6761
  `.test`), where `<h>` is the first 12 hex digits of the sha256 of the run id. The run id may hold `_` and capitals,
  which a host name shouldn't. The launches get it as `HARNESS_IP_NAME`; this card writes `<name>` for it.
- **Address:** the harness container's own address on Docker's default bridge, port 22:
  `docker inspect -f '{{(index .NetworkSettings.Networks "bridge").IPAddress}}' <container>`. Measured on Docker 29.9.0
  (2026-10-14): the old `{{.NetworkSettings.IPAddress}}` fails there with `map has no entry for key "IPAddress"`, and
  the `index` form prints the address. This is the container's sshd itself, not the published loopback port, so ssh
  sees a non-loopback address.

**The line:** after starting the host, the VSCodium run appends `<address> <name> # remote-oss-acceptance <runId>` to
the client's `/etc/hosts` with `sudo -n tee -a /etc/hosts`. An append writes in place, so it works on a bind-mounted
file.
- **Removal, in place:** `/etc/hosts` is a bind mount in containerised runners and in this lab (measured 2026-10-14:
  `findmnt /etc/hosts` shows a tmpfs bind). There `sed -i` fails with `can't move … Resource busy`, since it renames a
  new file over the old one. So the run rewrites the file's content without replacing the file:
  `sudo -n sh -c 'grep -v -F "# remote-oss-acceptance <runId>" /etc/hosts > <run>/hosts.kept; status=$?; [ "$status" -le 1 ] && cat <run>/hosts.kept > /etc/hosts'`
  (measured: `cat >` works on the bind mount where `sed -i` doesn't). The rewrite runs only when grep's status is 0
  (lines kept) or 1 (no line kept). A failing grep (status 2, an unreadable file for example) leaves `/etc/hosts`
  untouched, and the run reports the status. Before this guard, `;` ran `cat` anyway and truncated the file (dike
  reproduced 0 bytes on a runner). The sweep removes several run ids with one `grep -v -F -e … -e …`, under the same
  guard.
  - **The run's own line:** the run removes it in a `finally` around the launches, and in the run's `SIGINT` and
    `SIGTERM` handlers, the same ones that stop its containers.
  - **Stale lines, at the start of every run:** before it adds its own line, the run sweeps every marker line whose
    run id has no harness container left (`docker ps --filter label=<the run label>`, as `acceptance-run.ts`'s cleanup
    of a killed job's containers does).
  - **Why the sweep is needed:** on CI runners, `/etc/hosts` is the runner container's own podman `userdata/hosts`.
    It lives as long as the runner, across jobs (proteus, 2026-10-14). So a job killed mid-run (cancelled, OOM,
    timeout) would leave its line for every later job on that runner.
  - **Why it keys on containers, not just on another run id:** a run that's still going on the same runner keeps its
    line.
  - **Rows** (tools, with a recording command runner):
    - a hosts file holding a marker line of a run id with no container, and one of a run id that has one: the
      start-of-run sweep removes the first and keeps the second;
    - a launch that throws: the run's own line is removed.
    - grep failing with status 2 (the recording runner answers 2): no `cat` is run, `/etc/hosts` is unchanged, and the
      run's log names the status.
- **No sudo:** if `sudo -n true` fails, the run doesn't add the line and sets `HARNESS_HOSTS_LINE=absent`. The rows of
  §4.2 then fail with `<name> needs passwordless sudo to add a line to /etc/hosts`. They don't skip, and every other
  launch is unaffected.
  - **Consequence:** the full VSCodium gate needs passwordless sudo on the machine that runs it. The README's
    requirements list it beside Docker. A machine without it can run every launch but these rows green, and the run's
    summary names the cause. CI runners have it (proteus checks, §5).

**The rows' host blocks.** coverage-21's `hostKeyAlias(name, lines)` writes `HostName 127.0.0.1` and `Port <P>`
first. ssh keeps the first value it reads for an option, so a `HostName` or `Port` among the row's own lines would be
ignored. So both helpers are extended:
- `hostKeyAlias(name, lines, target = {hostName: '127.0.0.1', port: <P>})`: the block's `HostName` and `Port` come from
  `target`. The existing callers are unchanged.
- `wrongKeyLine(hostField?)`: the host field is the given one, or `[127.0.0.1]:<P>` as today, as `hostKeyLine` already
  takes it.

The blocks of §4.2 then are `hostKeyAlias('ip-<n>', [...], {hostName: <name>, port: 22})`, with these lines:
- `CheckHostIP yes`;
- `HashKnownHosts no`, since the client's own `/etc/ssh/ssh_config` may hash, and then no row could read the line.

The helpers' tools rows cover both forms of each.

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
| F-2305 AC-39 | `hostKeyLine(<name>)` and `wrongKeyLine(IP)` | `pick` `continue` → `dismiss` | a `pick` line whose `question` is ssh's warning text without the question line. A prompt pick's record line carries only its title (`scripted-adapters.ts`, `prompts.pick`), so the placeholder `Are you sure you want to continue connecting?` and the items `Continue`, `Cancel` rest on the unit row `F-2305.AC-39: the differing key lines are a continuation pick` (`prompts-classify.test.ts:183`), as coverage-21 does for AC-8. Name it in the PR |
| F-2305 AC-40 | the same | `pick` → `yes` (the `Continue` item's answer, S028) | connected; the known file unchanged |
| F-2305 AC-41 | the same | `pick` → `no` (the `Cancel` item's answer, S015); then a second window with `pick` → `dismiss` | each: the AC-6 dialog; the known file unchanged |
| F-2305 AC-45 | empty | the fingerprint `pick` → `yes` | connected; the known file holds one line whose host field is `<name>,IP` |

A `pick` entry's answer is `'yes' | 'no' | 'dismiss'` (`scripted-adapters.ts:55`). The adapter gives the item whose
`answer` it is, so `Continue` is `yes` and `Cancel` is `no` (lib-ssh `classify.ts`, the continuation items).

Catalogue: the eight ACs go from `todo` to `acceptance`.

## 5. Gates and review

All gates, the changed tools files at 100 %, shellcheck on the two scripts, and the full VSCodium run green. Paste the
two suites' summaries and `ssh -V`.

**The PR opens with the `needs-verification` label.** proteus checks on the CI runner:
- `sudo -n` works;
- the `/etc/hosts` line is added, and `ssh -o CheckHostIP=yes <name>` reaches the container;
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
