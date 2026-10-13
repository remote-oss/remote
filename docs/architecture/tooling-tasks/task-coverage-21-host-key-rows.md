# Task card coverage-21: the host-key rows of F-2305 (batch 7 of #142's acceptance rows)

Issue: #598. Why: #142's acceptance rows, batch 7. F-2305 (`remote-oss/remote-ssh#38`) shows ssh's host-key question as
a pick (or a masked input) and follows the answer. The `ssh_config` options decide whether a question comes at all.
These rows run it in the windows suite against the harness host, with a host block and a known-hosts file per row.
Builder: hestia. Size: about 2 agent-days. **Depends on:**
- tooling-26 (#573): `appendScript`, held answers;
- coverage-14 (#568): the windows helpers, `userSettings`.

## 1. The rows' hosts

Each row appends its own block to `<run>/ssh_config` (`hostKeyAlias(name, lines)`, in `windows/harness.ts`) and
removes it at the end. The block is `Host hk-<name>`, then:
- `HostName 127.0.0.1`, `Port <P>`, `User harness`;
- the run's key and `IdentitiesOnly yes`;
- `UserKnownHostsFile <run>/hk-<name>.known`;
- the row's own lines.

**There is no `BatchMode yes`:** it turns ssh's host-key confirmation off altogether (F-2305 §10), so no pick could
come. `<run>/hk-<name>.known` starts empty unless the row says otherwise.

**Helpers** (`windows/harness.ts`):
- `knownHostsOf(file)`: the file's lines, or none when it's missing;
- `hostKeyLine(hostField?)`: `[127.0.0.1]:<P>` (or `hostField`), then the host's ed25519 public key (from `docker exec …
  cat /etc/ssh/ssh_host_ed25519_key.pub`);
- `wrongKeyLine()`: the same host field with a key made by `ssh-keygen` in the run's folder, so the known key has
  changed;
- `homeKnownHosts()`: the name, size and mtime of the account's real `~/.ssh/known_hosts` (from
  `os.userInfo().homedir`; never its contents), or none.

**Terms:**
- `FP` is the host key's `SHA256:` fingerprint (`ssh-keygen -lf` of its public key).
- "AC-6 dialog" is `Could not establish connection to "hk-<name>".`.
- "Unchanged" for a known-hosts file means byte for byte.
- "No question" means no `pick` and no `maskedInput` line of the window.

**The client's wording.** The run's OpenSSH decides the wording of the question: 9.x writes `fingerprint is <FP>.`,
10.x writes `fingerprint is: <FP>`. BR-2's adaptation (2026-10-09) gives the pick for both, and the ACs that say "the
classic wording" (AC-9, 24, 25, 30) are run with whichever the client prints. The test file's first row logs `ssh -V`,
and the PR quotes it.

## 2. The rows (`tests/acceptance/windows/host-key.test.ts`, windows `h1`–`h3`)

A failing row's script ends with `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`.

| Cite | Block lines; script | Assertions |
|---|---|---|
| F-2305 AC-8 | none; `pick` `fingerprint` → `dismiss` | a `pick` line whose question (the title) is `"hk-p8" has fingerprint "<FP>".` |
| F-2305 AC-12, AC-13, AC-28 | as AC-8's row (Escape, which is also what a focus loss gives) | the AC-6 dialog; `hk-p8.known` unchanged (empty); not connected; the user settings unchanged |
| F-2305 AC-12 (Cancel) | none; `pick` → `no` | the AC-6 dialog; the known file unchanged |
| F-2305 AC-11, AC-28 | none; `pick` → `yes` | connected; `hk-p11.known` holds one line with the host's key; the user settings unchanged |
| F-2305 AC-9 | the authority `harness@hk-p9` (a typed `user@host`); `pick` → `yes` | the pick's title names `hk-p9`, without `harness@` |
| F-2305 AC-10 | `FingerprintHash md5`; `pick` → `dismiss` | the title's fingerprint starts with `MD5:` |
| F-2305 AC-15 | the known file holds `hostKeyLine()`; no script | connected; no question; the file unchanged |
| F-2305 AC-15 (global file) | the user known file empty, `GlobalKnownHostsFile <run>/hk-global.known` holding `hostKeyLine()` | connected; no question; both files unchanged |
| F-2305 AC-16 | the known file holds `wrongKeyLine()`; `StrictHostKeyChecking ask`, then `yes`, then `accept-new` (three windows, one at a time) | each: no question; dialog `Could not establish connection to "hk-…": Remote host key has changed, port forwarding is disabled.`; the file unchanged |
| F-2305 AC-17 | AC-16 with `ask`; `failureDialog` → `{button: 'Retry'}`, then `failureDialog` → `dismiss` | a second `failureDialog` line with the same text; the file unchanged |
| F-2305 AC-18 | AC-16 with `ask`; `userSettings({'remote.SSH.useLocalServer': false})`; `platformPick` → `linux` | dialog `Could not establish connection to "hk-…".`; the setting put back after |
| F-2305 AC-19 | the known file holds `wrongKeyLine()`, `StrictHostKeyChecking no`, `useLocalServer` false; `platformPick` → `linux` | dialog `Could not establish connection to "hk-…": Port forwarding is disabled.` |
| F-2305 AC-20 | the same with `useLocalServer` true | the file unchanged; no `pick` line offers `Continue`; `closeWindow` resolves |
| F-2305 AC-21 | `StrictHostKeyChecking yes`; then, in another window, `UserKnownHostsFile none` in place of the row's | each: no question; the AC-6 dialog, whose `time` is within 5 000 ms of the window's first `progress` line |
| F-2305 AC-22 | `StrictHostKeyChecking accept-new`; then `off` | each: no question; connected; the known file holds the host's key |
| F-2305 AC-23 | `UserKnownHostsFile <run>/hk-other/known` (folder missing); `pick` → `yes` | that file exists and holds the key; `hk-….known` doesn't exist; `homeKnownHosts()` is the same before and after |
| F-2305 AC-24 | `HostKeyAlias aliased-name`; `pick` → `yes` | the pick's title names `hk-p24`; the known file's line starts with `aliased-name ` |
| F-2305 AC-25 | `VisualHostKey yes`; `pick` → `dismiss` | the title is exactly AC-8's form: no line of the art |
| F-2305 AC-26 | the known file holds `hostKeyLine()`; `UpdateHostKeys yes`; then `ask` | each: connected; no question |
| F-2305 AC-27 | `NoHostAuthenticationForLocalhost yes` (the host is at 127.0.0.1) | connected; no question; the known file still empty |
| F-2305 AC-30 | `useLocalServer` false; `platformPick` → `linux`; `pick` → `yes` | the pick of AC-8's form; connected |
| F-2305 AC-33 | `userSettings({'remote.SSH.showLoginTerminal': true})`; `pick` → `dismiss` | the same `pick` question as AC-8's |
| F-2305 AC-34 (refused) | `pick` → `no`, `failureDialog` → `{button: 'Retry'}`, then either `pick` → `dismiss` (held, after `never`) or `failureDialog` → `dismiss` | after the Retry: either a held `pick` line (the question waits) or a second `failureDialog` line; the known file unchanged |
| F-2305 AC-34 (cancelled) | the same with `pick` → `dismiss` first | the same |
| F-2305 AC-44 | `h1` on `hk-p44`, connected after `pick` → `yes`; empty the known file; open `h2` on `hk-p44` | `h2` connected with no question (the shared connection) |

## 3. Every AC of F-2305

| AC | Tag | How |
|---|---|---|
| 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 33, 34, 44 | `acceptance` | the rows above |
| 43 | `unit` | prompts-classify's `F-2305.AC-43, BR-2` rows (both line forms, with and without the colon and the period); AC-8's row is its wiring |
| 14, 37 | `core` | as tagged |
| 1, 2, 3, 4, 5, 6, 7, 29, 35, 42 | `todo` | the masked-input form of the question, which BR-2 gives only for a question the pick pattern doesn't take. The run's client always gives the pick. Wait: a client (or a stand-in program) whose question isn't the pick's |
| 31, 38 | `todo` | spec question on remote-oss/remote-ssh#38 (2026-10-13): they contradict BR-2's adaptation, AC-30 and AC-43 |
| 32, 36 | `todo` | connect-23's Kill VS Code Server on Host |
| 39, 40, 41, 45 | `todo` | a host name, not an address literal, that resolves to a non-loopback address of the harness host. ssh turns `CheckHostIP` off for a loopback address or when the name is the address. Wait: a name the run can resolve (an `/etc/hosts` entry on the client, which needs root, or another route) |

**Halves that rest on unit rows** (name them in the PR):
- AC-8's placeholder `Are you sure you want to continue?` and its items `Continue` and `Cancel`: prompts-classify's
  `F-2305.AC-8` row and the editor adapter's pick rows;
- AC-13's `ignoreFocusOut: false`: the editor adapter's row (`editor-adapters.test.ts`). The hide on focus loss itself is
  core's;
- the failure dialog's buttons (ours, F-2601): F-2601 AC-2's rows.

Core halves for #142: the pick's rendering and focus, and the indicator.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary and the client's `ssh -V`. The repository's
gates pass.

## 5. Review

PR title `tests: the host-key rows of F-2305 (card coverage-21, #142)`. themis or triton reviews; athena gives the tag
check.
