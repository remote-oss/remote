# Task card coverage-21: the host-key rows of F-2305 (batch 7 of #142's acceptance rows)

Issue: #598. Why: #142's acceptance rows, batch 7. F-2305 (`remote-oss/remote-ssh#38`) shows ssh's host-key question as a
pick (or a masked input) and follows the answer. The `ssh_config` options decide whether a question comes at all. These
rows run it in the windows suite against the harness host, with a host block and a known-hosts file per row. Builder:
iris or hestia (hermes assigns). Size: about 2 agent-days. **Depends on:**
- tooling-26 (#573): `appendScript`, held answers, the `password-ask` alias;
- coverage-14 (#568): the windows helpers, `userSettings`.

## 1. The rows' hosts

Each row appends its own block to `<run>/ssh_config` (`hostKeyAlias(name, lines)`, in `windows/harness.ts`) and
removes it at the end. The block is `Host hk-<name>`, then:
- `HostName 127.0.0.1`, `Port <P>`, `User harness`;
- the run's key, `IdentitiesOnly yes`, `BatchMode yes`;
- `UserKnownHostsFile <run>/hk-<name>.known`;
- the row's own lines.

`<run>/hk-<name>.known` starts empty unless the row says otherwise.

**Helpers** (`windows/harness.ts`):
- `knownHostsOf(file)`: the file's lines, or none when it's missing;
- `hostKeyLine()`: `[127.0.0.1]:<P> ` and the host's ed25519 public key (from `docker exec … cat
  /etc/ssh/ssh_host_ed25519_key.pub`);
- `wrongKeyLine()`: the same host field with a key made by `ssh-keygen` in the run's folder, so the known key has
  changed.

`FP` is the host key's `SHA256:` fingerprint (`ssh-keygen -lf` of its public key). `{0}` is the alias. "AC-6 dialog" is
`Could not establish connection to "hk-<name>".`. "Unchanged" for a known-hosts file means byte for byte.

The client's OpenSSH version decides the wording of the question: 9.x writes `fingerprint is <FP>.`, 10.x writes
`fingerprint is: <FP>`. The rows hold for both (AC-43). The row for AC-43 records `ssh -V` in its name's message.

## 2. The rows (`tests/acceptance/windows/host-key.test.ts`, windows `h1`–`h3`)

| Cite | Block lines; script | Assertions |
|---|---|---|
| F-2305 AC-8, AC-43 | none; `pick` `fingerprint` → `dismiss`, then `failureDialog` → `dismiss`, `mitigationPick` → `dismiss` | a `pick` line whose question is `"hk-p8" has fingerprint "<FP>".` (title) |
| F-2305 AC-12, AC-28 | the same row | the AC-6 dialog; `hk-p8.known` unchanged (empty); the user settings unchanged |
| F-2305 AC-11, AC-28 | none; `pick` → `yes` | connected; `hk-p11.known` holds one line with the host's key; nothing else was written by us (settings unchanged) |
| F-2305 AC-9 | the authority `harness@hk-p9` (a typed `user@host`); `pick` → `yes` | the pick's title names `hk-p9` without `harness@` |
| F-2305 AC-15 | the known file holds `hostKeyLine()`; no script | connected; no `pick` line; the file unchanged |
| F-2305 AC-16 | the known file holds `wrongKeyLine()`; `StrictHostKeyChecking ask`, then `yes`, then `accept-new` (three windows, one at a time) | each: no `pick` line; dialog `Could not establish connection to "hk-…": Remote host key has changed, port forwarding is disabled.`; the file unchanged |
| F-2305 AC-17 | AC-16 with `ask`; `failureDialog` → `{button: 'Retry'}`, then `failureDialog` → `dismiss` | a second `failureDialog` line with the same text; the file unchanged |
| F-2305 AC-18 | AC-16 with `ask`, `userSettings({'remote.SSH.useLocalServer': false})` (with `platformPick` → `linux`) | dialog `Could not establish connection to "hk-…".`; the setting back after |
| F-2305 AC-19 | the known file holds `wrongKeyLine()`, `StrictHostKeyChecking no`, `useLocalServer` false | dialog `Could not establish connection to "hk-…": Port forwarding is disabled.` |
| F-2305 AC-20 | the same with `useLocalServer` true | the file unchanged; no `pick` line offers `Continue`; the window can be closed (`closeWindow` resolves) |
| F-2305 AC-21 | `StrictHostKeyChecking yes`; then (another row) `UserKnownHostsFile none` in place of the run's | each: no `pick` line; the AC-6 dialog |
| F-2305 AC-22 | `StrictHostKeyChecking accept-new`; then `off` | each: no `pick` line; connected; the known file holds the host's key |
| F-2305 AC-23 | `UserKnownHostsFile <run>/hk-other/known` (folder missing); `pick` → `yes` | that file exists and holds the key; `hk-….known` doesn't exist |
| F-2305 AC-24 | `HostKeyAlias aliased-name`; `pick` → `yes` | the pick's title names `hk-p24`; the known file's line starts with `aliased-name ` |
| F-2305 AC-25 | `VisualHostKey yes`; `pick` → `dismiss` (then the dialog answers) | the pick's title is the AC-8 form: no line of the art |
| F-2305 AC-26 | the known file holds `hostKeyLine()`; `UpdateHostKeys yes`; then `ask` | each: connected; no `pick` or `maskedInput` line |
| F-2305 AC-27 | `NoHostAuthenticationForLocalhost yes` (the host is at 127.0.0.1) | connected; no `pick` line; the known file is still empty |
| F-2305 AC-30 | `useLocalServer` false (with `platformPick` → `linux`); `pick` → `yes` | the pick appears as in AC-8; connected |
| F-2305 AC-33 | `userSettings({'remote.SSH.showLoginTerminal': true})`; `pick` → `dismiss` | the same `pick` question as AC-8's |
| F-2305 AC-34 | `pick` → `no`, `failureDialog` → `{button: 'Retry'}`; then either `pick` → `dismiss` (held, after `never`) or `failureDialog` → `dismiss` | after Retry: either a held `pick` line (the question waits) or a second `failureDialog` line; in both, the known file unchanged |
| F-2305 AC-39, AC-40 | the known file holds `hostKeyLine()` under the name `hk-p39`, and `wrongKeyLine()`'s key under `127.0.0.1`; `CheckHostIP yes`, `HostKeyAlias` unset; `pick` → `yes` | a `pick` line whose question (the pick's title, as the record keeps it) is ssh's warning and not the AC-8 form; connected; the known file unchanged. The placeholder, STR:S012, rests on the prompt classifier's unit row; name it in the PR |
| F-2305 AC-41 | AC-39's setup; `pick` → `no`, then the dialog answers | the AC-6 dialog; the file unchanged |
| F-2305 AC-29, AC-35 | the `password-ask` alias, with its known file deleted. `h1`: `pick` `fingerprint` → `yes` after `never`; `h2`: `pick` → `yes` after `k-go`, then (pw). `h1` also (pw) after `never` | after opening `h1`, then `h2`: `h2` has S157 and a held `pick` line with `h1`'s question. After `signal('k-go')` both are connected, and `h1`'s held line is `withdrawn` (the box closed, and `h1` stayed connected) |
| F-2305 AC-44 | `h1` on `hk-p44`, connected after `pick` → `yes`; empty the known file; open `h2` on `hk-p44` | `h2` connected with no `pick` line (the shared connection) |

## 3. The catalogue

F-2305 AC-8, 9, 11, 12, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34, 35, 39, 40, 41, 43 and 44 go to
`acceptance`. Core halves for #142: the pick's rendering (focus, items' look), the dialog's buttons, and the indicator.

These stay `todo`, each listed with what it waits for:
- AC-1, 2, 3 and 42 (the masked-input form of the question): a client whose question the pick rule doesn't take;
- AC-13 (closing without a choice): the scripted dismissal is Escape. Ask athena whether that is the same event for
  us, as it is for F-2304 AC-27;
- AC-31 and 38 (terminal mode with 10.x wording in the terminal): the run's client version decides; ask athena;
- AC-32 and 36: connect-23's Kill on Host.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary and the client's `ssh -V`. The repository's
gates pass.

## 5. Review

PR title `tests: the host-key rows of F-2305 (card coverage-21, #142)`. themis or triton reviews; athena gives the tag
check.
