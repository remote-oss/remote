# Task card coverage-22: the passphrase and agent rows of F-2307 (batch 7 of #142's acceptance rows)

Issue: #600. Why: #142's acceptance rows, batch 7. F-2307 (`remote-oss/remote-ssh#40`) asks for a key's passphrase in a
masked input, and works with the agent, with `AddKeysToAgent` and with certificates. These rows run it in the windows
suite. Builder: iris or hestia (hermes assigns). Size: about 2 agent-days. **Depends on:**
- tooling-29 (#599): the keys, the agent, the aliases;
- tooling-26 (#573): `appendScript`, held answers;
- tooling-25 (#566): the Kill host pick;
- coverage-14 (#568): the windows helpers.

## 1. Rules

- `(pp)` is `{surface: 'maskedInput', match: 'Enter passphrase for ssh key ', answer: {text: <the run's passphrase>}}`,
  and `(pp wrong)` is the same with `answer: {text: 'wrong'}`.
- "AC-7 dialog" is `Could not establish connection to "<alias>": Permission denied (publickey).`.
- Each scenario starts with `agentClear()`, no `p*` window, no connection helper.
- The windows are `q1`–`q3`.

## 2. The rows (`tests/acceptance/windows/passphrase.test.ts`)

| Cite | Setup and script | Assertions |
|---|---|---|
| F-2307 AC-1, AC-2, AC-3 | `q1` on `passkey`: (pp) | exactly one `maskedInput` line; its question starts with `Enter passphrase for ssh key ` and nothing follows the space (the question is exactly that text); its answer is `<supplied>`; `q1` connected |
| F-2307 AC-4 | the same, with the agent's keys noted before | `agentKeys()` after equals before |
| F-2307 AC-5, AC-6 | `q1` on `passkey`: (pp wrong), (pp) | two `maskedInput` lines with the same question; connected |
| F-2307 AC-7 | `q1` on `passkey`: (pp wrong) ×3, then the dialog answers | the AC-7 dialog with `buttons` `Close Remote`, `Retry`, `More Actions...` |
| F-2307 AC-8 | the AC-7 row, then `failureDialog` → `{button: 'Retry'}` in place of `dismiss`, then (pp) | after the reload a new `maskedInput` line; connected |
| F-2307 AC-9 | `q1` on `passkey`: `maskedInput` → `dismiss` | no second `maskedInput` line; the AC-7 dialog |
| F-2307 AC-10 | `q1` on `passkey`: `maskedInput` → `{text: ''}` | no second `maskedInput` line; the AC-7 dialog |
| F-2307 AC-11 | after AC-3's row, reload `q1` | no new `maskedInput` line; connected |
| F-2307 AC-12 | after AC-11, in `q1`, Kill (`hostPick` → `{label: 'passkey'}`), then (pp) | a new `maskedInput` line with the AC-1 question; connected again |
| F-2307 AC-32 | `userSettings({'remote.SSH.maxReconnectionAttempts': 0})`, then AC-12's steps | the same; the setting back |
| F-2307 AC-14 | `agentAdd(id_passphrase)`; `q1` on `passkey` | connected; no `maskedInput` line |
| F-2307 AC-15 | a block `passkey-add` = `passkey` plus `AddKeysToAgent yes`; `q1` on it with (pp); close; `q2` on it | `agentKeys()` holds `id_passphrase`'s fingerprint after `q1`; `q2` asks nothing |
| F-2307 AC-16 | a block `passkey-ask` = `passkey` plus `AddKeysToAgent ask`. Three runs, the agent cleared each time. Each: (pp), then `{surface: 'maskedInput', match: 'Add key ', answer: …}` with `{text: 'yes'}`, then `{text: 'no'}`, then `dismiss` | each connected; the second input's question starts with ` Add key <run>/id_passphrase (acceptance-passphrase) to agent?`; the key is in the agent after `yes` and after the dismissal, and not after `no` |
| F-2307 AC-17 | a block `passkey-confirm` = `passkey` plus `AddKeysToAgent confirm`; `q1` with (pp); then in `q1`, Kill, and the reconnection | the key is in the agent after the first connect; after the Kill no `maskedInput` line, and the AC-7 dialog |
| F-2307 AC-31 | `agentAdd(id_second, {confirm: true})`; a block `second-agent` (`id_second`'s public key only, `IdentitiesOnly yes`); `q1` on it | no `maskedInput` line; the AC-7 dialog |
| F-2307 AC-18 | `q1` on `certonly`; `q2` on `certonly-nocert` | `q1` connected with no input; `q2` the AC-7 dialog (alias `certonly-nocert`) |
| F-2307 AC-28 | a block `certonly-pass`: `harness-cert`, `id_passphrase` with a certificate the run signs for it in this row (`ssh-keygen -s ca … id_passphrase.pub`); (pp) | the AC-1 input once; connected |
| F-2307 AC-20 | `agentAdd(id_second)`; a block `agent-first`: `IdentitiesOnly no`, `IdentityFile <run>/id_loose` (refused by its modes) | connected with the agent key; no `maskedInput` line |
| F-2307 AC-21 | a block `several`: `IdentityFile <run>/missing`, `IdentityFile <run>/id_passphrase`, `IdentityFile <run>/id_second`, `IdentitiesOnly yes`; no script entry | connected; no `maskedInput` line |
| F-2307 AC-27 | `q1` on `passkey-then-second`: `maskedInput` → `dismiss` | connected; no `failureDialog` line |
| F-2307 AC-22 | `q1` on `loosekey` | the AC-7 dialog only; `connectionLog()` has `UNPROTECTED PRIVATE KEY FILE`; no `notice` line holds it |
| F-2307 AC-23 | `userSettings({'remote.SSH.useLocalServer': false})`; `q1` on `passkey` with `platformPick` → `linux` and (pp) | exactly one `maskedInput` line; connected; the setting back |
| F-2307 AC-26 | after AC-23's row (per-window mode), reload `q1`, with (pp) appended | a new `maskedInput` line after the reload |
| F-2307 AC-30 | `agentAdd(id_second)` into the run's agent. A block `idagent` with `IdentityAgent $HARNESS_AGENT_SOCKET` and `IdentityFile <run>/id_second.pub`, `IdentitiesOnly yes`, then `q1` on it. Then a block `idagent-missing` with `IdentityAgent $NOT_SET_ANYWHERE`, `q2` on it | `q1` connected with no input; `q2` the AC-7 dialog |
| F-2307 AC-25 | `q1` on `passkey`: (pp) after `p25`; `signal('p25')` after 65 s | the held line stayed open for 65 s (no `withdrawn`); `q1` connected |
| F-2307 AC-24 | after every row | `grep -rl <passphrase>` over `<run>/user-data`, the run's logs and records, `<run>/home` if present, and the host's `/home/harness` finds nothing |

## 3. The catalogue

F-2307 AC-1 to 12, 14 to 18, 20 to 28 and 30 to 32 go to `acceptance`. Core halves for #142:
- the input's place and message line, and the masking (AC-1, AC-2);
- the title and the indicator (AC-3, AC-7);
- F1 replacing the input (AC-9);
- "Reconnecting to SSH: …" (AC-12);
- core's "Cannot reconnect" dialog (AC-13, AC-26).

AC-13 (Escape at the reconnect input in a trusted folder) and AC-29 (an agent started after the editor on its
`SSH_AUTH_SOCK`) stay `todo`. They need a trust-enabled launch and an agent the run starts late, and are listed with
those.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the passphrase and agent rows of F-2307 (card coverage-22, #142)`. themis or triton reviews; athena gives
the tag check.
