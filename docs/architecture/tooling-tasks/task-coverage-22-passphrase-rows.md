# Task card coverage-22: the passphrase and agent rows of F-2307 (batch 7 of #142's acceptance rows)

Issue: #600. Why: #142's acceptance rows, batch 7. F-2307 (`remote-oss/remote-ssh#40`) asks for a key's passphrase in a
masked input, and works with the agent, with `AddKeysToAgent` and with certificates. These rows run it in the windows
suite. Builder: iris. Size: about 2 agent-days. **Depends on:**
- tooling-29 (#599): the keys, the agent, the aliases;
- tooling-26 (#573): `appendScript`, held answers;
- tooling-25 (#566): the Kill host pick;
- coverage-14 (#568): the windows helpers.

## 1. Rules

- `(pp)` is `{surface: 'maskedInput', match: 'Enter passphrase for ssh key ', answer: {text: <the run's passphrase>}}`,
  and `(pp wrong)` is the same with `answer: {text: 'wrong'}`.
- "AC-7 dialog" is `Could not establish connection to "<alias>": Permission denied (publickey).`.
- Each scenario starts with `agentClear()`, no `q*` window and no connection helper.
- The windows are `q1`–`q3`.
- A row's own block is appended to the run's `ssh_config` as coverage-21 §1 does: `HostName 127.0.0.1`, `Port <P>`,
  `User harness`, the row's `IdentityFile` lines, `StrictHostKeyChecking accept-new`, `UserKnownHostsFile
  <run>/known_hosts`, and no `BatchMode`.
- The launch runs with `--disable-workspace-trust`, so every folder is trusted: that is AC-13's Given.

**The agent's state** gains `terminals`: the names of `vscode.window.terminals`.

## 2. The rows (`tests/acceptance/windows/passphrase.test.ts`)

| Cite | Setup and script | Assertions |
|---|---|---|
| F-2307 AC-1, AC-2, AC-3 | `q1` on `passkey`: (pp) | exactly one `maskedInput` line; its question is exactly `Enter passphrase for ssh key ` with nothing after it; its answer is `<supplied>`; `q1` connected |
| F-2307 AC-4 | the same, with `agentKeys()` noted before | `agentKeys()` after equals before |
| F-2307 AC-5, AC-6 | `q1` on `passkey`: (pp wrong), (pp) | two `maskedInput` lines with the same question; connected |
| F-2307 AC-7 | `q1` on `passkey`: (pp wrong) ×3, then the dialog answers | the AC-7 dialog with `buttons` `Close Remote`, `Retry`, `More Actions...` |
| F-2307 AC-8 | the AC-7 row, but `failureDialog` → `{button: 'Retry'}`, then (pp) | after the reload a new `maskedInput` line; connected |
| F-2307 AC-9 | `q1` on `passkey`: `maskedInput` → `dismiss` | no second `maskedInput` line; the AC-7 dialog |
| F-2307 AC-10 | `q1` on `passkey`: `maskedInput` → `{text: ''}` | no second `maskedInput` line; the AC-7 dialog |
| F-2307 AC-11 | after AC-3's row, reload `q1` | no new `maskedInput` line; connected |
| F-2307 AC-12 | after AC-11, in `q1`, Kill (`hostPick` → `{label: 'passkey'}`), then (pp) | a new `maskedInput` line with the AC-1 question; connected again |
| F-2307 AC-13, AC-26 | after AC-12, Kill again, then `maskedInput` → `dismiss`; then `reloadWindow('q1')` with (pp) appended | after the dismissal no `failureDialog` line of `q1` (core's "Cannot reconnect" dialog is core's half); after the reload, a new `maskedInput` line with the AC-1 question; connected |
| F-2307 AC-32 | `userSettings({'remote.SSH.maxReconnectionAttempts': 0})`, then AC-12's steps | the same as AC-12; the setting put back after |
| F-2307 AC-14 | `agentAdd(id_passphrase)`; `q1` on `passkey` | connected; no `maskedInput` line |
| F-2307 AC-15 | blocks `add-one` and `add-two`, each `id_passphrase` with `AddKeysToAgent yes` (two aliases, so two helpers). `q1` on `add-one` with (pp); then `q2` on `add-two` | `agentKeys()` holds `id_passphrase`'s fingerprint after `q1`; `q2` connected with no `maskedInput` line |
| F-2307 AC-16 | a block `passkey-ask` = `id_passphrase` with `AddKeysToAgent ask`. Three runs, the agent cleared each time. Each: (pp), then `{surface: 'maskedInput', match: ' Add key ', answer: …}` with `{text: 'yes'}`, then `{text: 'no'}`, then `dismiss` | each connected; the second input's question starts with ` Add key <run>/id_passphrase (acceptance-passphrase) to agent?`; the key is in the agent after `yes` and after the dismissal, and not after `no` |
| F-2307 AC-17 | a block `passkey-confirm` = `id_passphrase` with `AddKeysToAgent confirm`. `q1` with (pp); then in `q1`, Kill, and the reconnection | the key is in the agent after the first connect. After the Kill: no `maskedInput` line, no `failureDialog` line (the reconnection fails with core's 7.E3 dialog, core's half), `q1` not connected |
| F-2307 AC-31 | `agentAdd(id_second, {confirm: true})`; a block `second-agent` (`IdentityFile <run>/id_second.pub`, `IdentitiesOnly yes`); `q1` on it | no `maskedInput` line; the AC-7 dialog |
| F-2307 AC-18 | `q1` on `certonly` (`CertificateFile`); a block `certonly-beside` (`User harness-cert`, `IdentityFile <run>/id_certified` and no `CertificateFile`, so ssh finds `id_certified-cert.pub` beside it), `q2` on it; `q3` on `certonly-nocert` | `q1` and `q2` connected with no input; `q3` the AC-7 dialog |
| F-2307 AC-28 | a block `certonly-pass`: `User harness-cert`, `id_passphrase`, with a certificate the run signs for it in this row (`ssh-keygen -s ca -I acceptance -n harness-cert <run>/id_passphrase.pub`); (pp) | the AC-1 input once; connected |
| F-2307 AC-19 | five blocks on `harness`, each with an agent holding `id_second` (`agentAdd`): (a) `IdentityFile <run>/missing`, `IdentitiesOnly yes`; (b) `IdentityFile none`, `IdentitiesOnly yes`; (c) `IdentityFile <run>/id_second`, `PubkeyAuthentication no`, `PreferredAuthentications publickey`; (d) `IdentitiesOnly yes` and no `IdentityFile`; (e) `IdentityFile <run>/id_second.pub`, `IdentityAgent none` | each: no `maskedInput` line; the AC-7 dialog |
| F-2307 AC-20 | `agentAdd(id_second)`; a block `agent-first`: `IdentitiesOnly no`, `IdentityFile <run>/id_passphrase_stranger` | connected with the agent's key; no `maskedInput` line |
| F-2307 AC-21 | a block `several`: `IdentityFile <run>/missing`, `IdentityFile <run>/id_passphrase_stranger` (a passphrase key the host doesn't hold, tooling-29), `IdentityFile <run>/id_second`, `IdentitiesOnly yes`; no script entry | connected; no `maskedInput` line |
| F-2307 AC-27 | `q1` on `passkey-then-second`: `maskedInput` → `dismiss` | connected; no `failureDialog` line |
| F-2307 AC-22 | `q1` on `loosekey` | the AC-7 dialog only; `connectionLog()` has `UNPROTECTED PRIVATE KEY FILE`; no `notice` line holds it; `q1`'s `terminals` has none whose name holds `Troubleshoot` (F-2605's terminal isn't built, so none can show it) |
| F-2307 AC-23 | `userSettings({'remote.SSH.useLocalServer': false})`; `q1` on `passkey` with `platformPick` → `linux` and (pp) | exactly one `maskedInput` line; connected; the setting put back |
| F-2307 AC-25 | `q1` on `passkey`: (pp) after `p25`; `signal('p25')` after 65 s | the held line stayed open for 65 s (no `withdrawn`); connected |
| F-2307 AC-30 | `agentAdd(id_second)` into the run's agent. A block `idagent`: `IdentityAgent $HARNESS_AGENT_SOCKET`, `IdentityFile <run>/id_second.pub`, `IdentitiesOnly yes`; `q1` on it. Then a block `idagent-missing` with `IdentityAgent $NOT_SET_ANYWHERE`; `q2` on it | `q1` connected with no input; `q2` the AC-7 dialog |
| F-2307 AC-24 | after every row | `grep -rl <passphrase>` over `<run>/user-data`, the run's logs and records, and the host's `/home/harness` finds nothing |

## 3. Every AC of F-2307

| AC | Tag | How |
|---|---|---|
| 1–28 and 30–32 | `acceptance` | the rows above |
| 29 | `todo` | an agent started after the editor on its `SSH_AUTH_SOCK`. Wait: a run whose agent is started after the editor (tooling-29 starts it before) |

**Halves that rest on unit rows** (name them in the PR):
- the masking (AC-1, AC-2): `inputBox.password = true`, in `editor-adapters.test.ts`. It's ours, not core's;
- the stored passphrase (AC-24): connect's rows that a masked answer is recorded as `<supplied>`.

Core halves for #142:
- the input's place and its message line (AC-1);
- the title and the indicator (AC-3, AC-7);
- F1 replacing the input (AC-9);
- "Reconnecting to SSH: …" (AC-12);
- core's "Cannot reconnect" dialog (AC-13, AC-17).

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the passphrase and agent rows of F-2307 (card coverage-22, #142)`. themis or triton reviews; athena gives
the tag check.
