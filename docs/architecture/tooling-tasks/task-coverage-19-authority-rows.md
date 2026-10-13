# Task card coverage-19: the ssh-remote authority rows of F-2501 (batch 3b of #142's acceptance rows)

Issue: #590. Why: #142's acceptance rows, batch 3b. F-2501 (`remote-oss/remote-ssh#59`) resolves an
`ssh-remote+<payload>` authority. A payload may be:
- the hex of a JSON target;
- or plain text, with a user, a port, or two `@`.

Spellings of one target share one connection, and each failure has its own dialog. These rows open windows on those
spellings in the windows suite. Builder: iris or hestia (hermes assigns). Size: about 2 agent-days. **Depends on:**
- tooling-26 (#573): `appendScript`, `acceptedPasswords`-style sshd log reading;
- coverage-13 (#556): the `Host 127.0.0.1` block;
- coverage-14 (#568): the windows helpers.

## 1. Harness additions

**`ssh_config`** (`tools/acceptance.ts`, `harnessSshConfig`), each block with a tools row:

| Block | Lines | For |
|---|---|---|
| `Host badkey` | `HostName 127.0.0.1`, `Port <port>`, `User harness`, `IdentityFile <run>/id_unauthorised`, `IdentitiesOnly yes`, `BatchMode yes`, `StrictHostKeyChecking accept-new`, `UserKnownHostsFile <run>/known_hosts` | AC-14. The run makes `id_unauthorised` with `ssh-keygen` and never authorises it |
| `Host blackhole` | `HostName 192.0.2.1` (TEST-NET-1, never routed), `BatchMode yes` | AC-18 |
| `Host 127.0.0.2` | `BatchMode yes`, `IdentitiesOnly yes`, `IdentityFile <run>/id_unauthorised`, `StrictHostKeyChecking accept-new`, `UserKnownHostsFile <run>/known_hosts` (no `User`, no `Port`) | AC-9's refused login. The host's published port answers on every loopback address |

**Helpers** (`windows/harness.ts`):
- `hexOf(target)`: `Buffer.from(JSON.stringify(target)).toString('hex')`, the lower-case hex F-2501 BR-1 defines;
- `sshdLog(since)`: the lines of `docker logs --since <since> <container>`;
- `acceptedKeyLogins(since)`: the count of `Accepted publickey for harness` lines among them.

**The agent's state** gains `remoteSshActive`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.isActive ?? false`.

## 2. The rows (`tests/acceptance/windows/authority.test.ts`)

`P` is the harness host's published port. Each scenario starts with every `a*` window closed and no connection helper
running. A failing window's script is `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`, written for its
folder name before it opens. "One connection" means two things:
- `connectionHelpers()` has one entry while both windows are connected;
- `acceptedKeyLogins` grew by exactly 1 over the scenario.

| Cite | Windows (folder ← payload) | Assertions |
|---|---|---|
| F-2501 AC-5 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness'})` | connected |
| F-2501 AC-6 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness', port: P})`, then `a2` ← `hexOf({…, port: String(P)})` | both connected; one connection |
| F-2501 AC-7 | `a1` ← `harness`, then `a2` ← `hexOf({hostName: 'harness'})`, then `a3` ← `hexOf({hostName: 'harness', foo: 'bar'})` | all connected; one connection |
| F-2501 AC-8 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness', port: P})`, then `a2` ← `harness@127.0.0.1:<P>`, then `a3` ← `harness@127.0.0.1` (port from `Host 127.0.0.1`) | all connected; one connection; no `notice` line |
| F-2501 AC-9 | `a1` ← `127.0.0.1:<P>`; then `a2` ← `127.0.0.2:<P>` | `a1` connected (user `harness` from the configuration). `a2` fails with `Could not establish connection to "127.0.0.2": Permission denied (publickey).`, and `sshdLog` holds `Invalid user <the client's login name>` (`os.userInfo().username`) |
| F-2501 AC-11, AC-25 | `a1` ← `harness`, then `a2` ← `harness`, then `a3` ← `harness@127.0.0.1:<P>` | all connected; one connection for all three |
| F-2501 AC-13 | `userSettings({'remote.SSH.useLocalServer': false})`; `a1` ← `harness` (with `platformPick` → `linux`) | connected (`remoteName` `ssh-remote`); then set the setting back |
| F-2501 AC-14 | `a1` ← `badkey` | dialog `Could not establish connection to "badkey": Permission denied (publickey).`, and the `failureDialog` line's `buttons` (coverage-10) are `Close Remote`, `Retry`, `More Actions...` |
| F-2501 AC-16 | `a1` ← `nowhere` | dialog `Could not establish connection to "nowhere": Could not resolve hostname.` |
| F-2501 AC-17 | `a1` ← `refused` | dialog `Could not establish connection to "refused".` |
| F-2501 AC-18 | `a1` ← `blackhole` | dialog `Could not establish connection to "blackhole": The connection timed out.`; its `time` minus `a1`'s first `progress` line's is between 13 000 and 25 000 ms (`remote.SSH.connectTimeout` at its default, 15) |
| F-2501 AC-19 | `a1` ← `stranger`, script `pick` `fingerprint` → `dismiss` | dialog `Could not establish connection to "stranger".` |
| F-2501 AC-32 | `a1` ← `a@b@127.0.0.1` | `sshdLog` holds `Invalid user a@b`; the dialog names `127.0.0.1` |
| F-2501 AC-33 | `a1` ← `Harness` | dialog `Could not establish connection to "Harness": Could not resolve hostname.` |
| F-2501 AC-2 | in `local`, `acceptance.agent.openWindow` on `file://<run>/local-folder` (made first) | that window's state has `remoteName` null and `remoteSshActive` false. Close it |

## 3. The catalogue

F-2501 AC-2, 5, 6, 7, 8, 9, 11, 13, 14, 16, 17, 18, 19, 25, 32 and 33 go to `acceptance`. Core halves, listed in #142:
- the indicator of AC-5, 6, 7 and 14;
- AC-14's title;
- AC-18's "Opening Remote...";
- AC-25's stored folder entries.

These stay `todo`, each listed with what it waits for:
- AC-1, 10, 12 and 20: the resolver's attempt number and activation event, which the record doesn't hold. F-2003's
  log record (not in 0.2) writes `Resolving …, attempt n`.
- AC-22: a trust-enabled launch (#456).
- AC-27 and AC-29 are coverage-12's cases (`platform-pick-linux`, `platform-escape`). Add their F-2501 cites there
  when that card is built.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the ssh-remote authority rows of F-2501 (card coverage-19, #142)`. themis or triton reviews; athena gives
the tag check.
