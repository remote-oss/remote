# Task card coverage-19: the ssh-remote authority rows of F-2501 (batch 3b of #142's acceptance rows)

Issue: #590. Why: #142's acceptance rows, batch 3b. F-2501 (`remote-oss/remote-ssh#59`) resolves an
`ssh-remote+<payload>` authority. A payload may be:
- the hex of a JSON target;
- or plain text, with a user, a port, or two `@`.

Spellings of one target share one connection, and each failure has its own dialog. These rows open windows on those
spellings in the windows suite. Builder: iris or hestia (hermes assigns). Size: about 2.5 agent-days. **Depends on:**
- tooling-26 (#573): `appendScript`, `acceptedPasswords`-style sshd log reading;
- coverage-13 (#556): the `Host 127.0.0.1` block;
- coverage-14 (#568): the windows helpers.

## 1. Harness additions

**`ssh_config`** (`tools/acceptance.ts`, `harnessSshConfig`), each block with a tools row:

| Block | Lines | For |
|---|---|---|
| `Host badkey` | `HostName 127.0.0.1`, `Port <port>`, `User harness`, `IdentityFile <run>/id_unauthorised`, `IdentitiesOnly yes`, `BatchMode yes`, `StrictHostKeyChecking accept-new`, `UserKnownHostsFile <run>/known_hosts` | AC-14. The run makes `id_unauthorised` with `ssh-keygen` and never authorises it |
| `Host blackhole` | `HostName 192.0.2.1` (TEST-NET-1, never routed), `BatchMode yes` | AC-18 |
| `Host 127.0.0.2` | `HostName 127.0.0.1`, `BatchMode yes`, `IdentitiesOnly yes`, `IdentityFile <run>/id_unauthorised`, `StrictHostKeyChecking accept-new`, `UserKnownHostsFile <run>/known_hosts` (no `User`, no `Port`) | AC-9's refused login. Docker publishes the host's port on `127.0.0.1` only (`--publish 127.0.0.1::22`), so the block points the name there; the authority's `:<P>` gives the port |

**Helpers** (`windows/harness.ts`):
- `hexOf(target)`: `Buffer.from(JSON.stringify(target)).toString('hex')`, the lower-case hex F-2501 BR-1 defines;
- `sshdLog(since)`: the lines of `docker logs --since <since> <container>`;
- `acceptedKeyLogins(since)`: the count of `Accepted publickey for harness` lines among them;
- `hostConnections()`: the client's established TCP connections whose peer is the host container's published address
  (`127.0.0.1:<the run's ssh port>`), as `{program}`, from `ss -tnpH state established` (the process name inside
  `users:(("<name>",…))`). Measure the `ss` output form on the run machine first, and write it into the PR;
- `cutHostNetwork()` and `restoreHostNetwork()`: `cutNetwork` and `restoreNetwork` of `tools/acceptance-network.ts`,
  with `runCommand` and `variable('HARNESS_CONTAINER')` (D-85's cut, which the run's host container allows: it runs
  with `NET_ADMIN`). A row that cuts restores in a `finally`. coverage-12 §2a adds the same pair; whichever card lands
  second reuses them.

**The resolver's log line** (`packages/remote-ssh/src/diagnostics/log-content.ts`): export
`resolvingLine(authority: string, attempt: number, reconnection: boolean)`, the line `resolveLogLines` writes today
(`Resolving ssh-remote+<authority>, attempt <n>`, then `, reconnection` for a reconnection). `resolveLogLines` uses it.
Its unit rows give both forms. The AC-12 row builds its expected lines with it.

**The agent's state** gains `remoteSshActive`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.isActive ?? false`.
coverage-32 (#715) uses the same field. Whichever card lands second reuses it.

## 2. The rows (`tests/acceptance/windows/authority.test.ts`)

`P` is the harness host's published port. Each scenario starts with every `a*` window closed and no connection helper
running. A failing window's script is `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`, written for its
folder name before it opens. "One connection" means two things:
- `connectionHelpers()` has one entry while both windows are connected;
- `acceptedKeyLogins` grew by exactly 1 over the scenario.

| Cite | Windows (folder ← payload) | Assertions |
|---|---|---|
| F-2501 AC-4 | with no window on the host and `connectionHelpers()` empty, note `since`; `a1` ← `harness`, connected | `acceptedKeyLogins(since)` is exactly 1, the extension's one session. `hostConnections()` is not empty, and every entry's `program` is `ssh` (core opened no connection to the host's address) |
| F-2501 AC-5 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness'})` | connected |
| F-2501 AC-6 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness', port: P})`, then `a2` ← `hexOf({…, port: String(P)})` | both connected; one connection |
| F-2501 AC-7 | `a1` ← `harness`, then `a2` ← `hexOf({hostName: 'harness'})`, then `a3` ← `hexOf({hostName: 'harness', foo: 'bar'})` | all connected; one connection |
| F-2501 AC-8 | `a1` ← `hexOf({hostName: '127.0.0.1', user: 'harness', port: P})`, then `a2` ← `harness@127.0.0.1:<P>`, then `a3` ← `harness@127.0.0.1` (port from `Host 127.0.0.1`) | all connected; one connection; no `notice` line |
| F-2501 AC-9 | `a1` ← `127.0.0.1:<P>`; then `a2` ← `127.0.0.2:<P>` | `a1` connected (user `harness` from the configuration). `a2` fails with `Could not establish connection to "127.0.0.2": Permission denied (publickey).`, and `sshdLog` holds `Invalid user <the client's login name>` (`os.userInfo().username`) |
| F-2501 AC-11, AC-25 | `a1` ← `harness`, then `a2` ← `harness`, then `a3` ← `harness@127.0.0.1:<P>` | all connected; one connection for all three |
| F-2501 AC-13 | `userSettings({'remote.SSH.useLocalServer': false})`; `a1` ← `harness` (with `platformPick` → `linux`). Then the setting back, and `userSettings({'remote.SSH.remoteServerListenOnSocket': true})`; `a2` ← `harness` | both connected (`remoteName` `ssh-remote`); then both settings back |
| F-2501 AC-10 | `a1` ← `harness`, connected; note the helper and `acceptedKeyLogins`; reload `a1` | after the reload: no `maskedInput`, `pick` or `progress` line of `a1`; the same helper; `acceptedKeyLogins` unchanged; `a1` connected within 10 s |
| F-2501 AC-20 | `a1` ← `refused`, its script `failureDialog` → `dismiss`, `mitigationPick` → `dismiss`, twice over; reload `a1` | a second `failureDialog` line of `a1` with the same text |
| F-2501 AC-14 | `a1` ← `badkey` | dialog `Could not establish connection to "badkey": Permission denied (publickey).`, and the `failureDialog` line's `buttons` (coverage-10) are `Close Remote`, `Retry`, `More Actions...` |
| F-2501 AC-16 | `a1` ← `nowhere` | dialog `Could not establish connection to "nowhere": Could not resolve hostname.` |
| F-2501 AC-17 | `a1` ← `refused` | dialog `Could not establish connection to "refused".` |
| F-2501 AC-18 | `a1` ← `blackhole` | dialog `Could not establish connection to "blackhole": The connection timed out.`; its `time` minus `a1`'s first `progress` line's is between 13 000 and 25 000 ms (`remote.SSH.connectTimeout` at its default, 15) |
| F-2501 AC-19 | `a1` ← `stranger`, script `pick` `fingerprint` → `dismiss` | dialog `Could not establish connection to "stranger".` |
| F-2501 AC-32 | `a1` ← `a@b@127.0.0.1` | `sshdLog` holds `Invalid user a@b`; the dialog names `127.0.0.1` |
| F-2501 AC-33 | `a1` ← `Harness` | dialog `Could not establish connection to "Harness": Could not resolve hostname.` |
| F-2501 AC-2 | in `local`, `acceptance.agent.openWindow` on `file://<run>/local-folder` (made first) | that window's state has `remoteName` null and `remoteSshActive` false. Close it |
| F-2501 AC-31 | in `local`, open `file://<run>/a-internal` (made first); its window is `a-internal`. Read its state; then `inWindow('a-internal', 'remote-internal.getActiveSshRemote')`; read its state again | before: `remoteSshActive` false. After: the command resolved, `remoteSshActive` true, `remoteName` still null. No `progress` line of `a-internal`, and no log line since the command starts with `Resolving ssh-remote+` (`resolvingLine`'s fixed start): the resolver wasn't called. Close it |
| F-2501 AC-12 | `a1` ← `harness`, connected. Note `a1`'s `activated` events and the log's length. `cutHostNetwork()`; wait up to 180 s until the new log lines hold `resolvingLine('harness', 2, true)` and `resolvingLine('harness', 3, true)`; `restoreHostNetwork()` | no `failureDialog` line of `a1` since the cut; within 120 s of the restore `a1` is connected; `a1` has no new `activated` event (no reload). Compare log lines through `redact(line, [])`, as `client.test.ts`'s `logged` does |

## 3. The catalogue

F-2501 AC-2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 18, 19, 20, 25, 32 and 33 go to `acceptance`. The attempt number is
core's input to our resolver, a core half (athena on #591). AC-20's Retry variant joins with tooling-20's Retry. AC-1
is `unit`, through the manifest's `onResolveRemoteAuthority:ssh-remote` row: every connected row is its wiring, and the
activation order is core's. Core halves, listed in #142:
- the indicator of AC-5, 6, 7 and 14;
- AC-14's title;
- AC-18's "Opening Remote...";
- AC-25's stored folder entries.

AC-12 and AC-31 go to `acceptance` too. Core halves: AC-12's reconnection loop and its attempt numbers, which are
core's input to our resolver; AC-31's "for example by opening the Remotes view", since the Remotes view is
remote-explorer's in 0.2.

These stay `todo`, each listed with what it waits for:
- AC-22: a trust-enabled launch (#456).
- AC-26: its Given (a resolve that returns while the server download still runs) arises only on the CLI path, where the
  CLI downloads the server after it starts. In 0.2 the CLI path is dormant: VSCodium names no CLI source (connect-44,
  #689). The tag waits for athena's pending ruling on the CLI-path ACs: `deferred` with them, or a row on cli-05's
  opt-in archive. Don't decide it in the build.

AC-27 and AC-29 are coverage-12's (#551) cases, `platform-pick-linux` and `platform-escape`. That card's §1 now carries
their F-2501 cites, and its build tags them.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the ssh-remote authority rows of F-2501 (card coverage-19, #142)`. themis or triton reviews; athena gives
the tag check.
