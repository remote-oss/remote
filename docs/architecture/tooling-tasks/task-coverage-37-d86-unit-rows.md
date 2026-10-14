# Task card coverage-37: D-86's unit rows

Issue: #725. Release 0.2, gating: D-86 puts F-2204, F-2302, F-2303, F-2411, F-2412 and F-2605's clear command into 0.2,
and #722 seeds and tags their criteria. This card writes the rows #722's "Needs a unit row" table lists: test files
only, each row citing the criterion it proves. Builder: selene (task:local). Size: S–M. **Depends on:** #722 merged,
because `check-coverage` rejects a cite of a criterion the file doesn't have yet.

## 1. Files

| File | Rows |
|---|---|
| `packages/remote-ssh/test/unit/skeleton.test.ts` | §2.1, appended inside the existing `describe('the manifest rows of slice 1', …)` |
| `packages/lib-ssh/test/unit/add-host.test.ts` | §2.2, appended at the end of the `describe` |
| `packages/lib-ssh/test/unit/writer.test.ts` | §2.3, appended at the end of the `describe` |
| `packages/remote-ssh/test/unit/connect-commands.test.ts` | §2.4, in `describe('Connect to the active host (card connect-21)', …)` |
| `packages/lib-server/test/unit/bootstrap-script.test.ts` | §2.5, in the `describe` that holds the `afterKill` helper |
| `docs/architecture/catalogue/coverage-slice1.tsv` | §3 |

No product file changes. If a row fails on main, don't change the expected value: stop and report (§5).

## 2. The rows

### 2.1 Manifest rows (`skeleton.test.ts`)

Use the describe's own `manifest`, `strings`, `resolved` and `placesOf`. Widen the `manifest` type's `commands` entries
and `menus` entries only as far as these rows read them: `icon?: unknown` on a command, `group?: string` on a menu
entry.

`indicatorEntries()` is a local function: the `statusBar/remoteIndicator` entries whose `group` starts with
`remote_20_ssh-remote`, as `[command, group, when]`.

| Name | Assertion (one `deepStrictEqual` each) |
|---|---|
| `F-2204 AC-1: Add New SSH Host... is in no menu, so no when-clause hides it from the palette, and has no keybinding` | `placesOf('opensshremotes.addNewSshHost')` is `[]`; the command's `category` is `Remote-SSH` and `resolved(title)` is `Add New SSH Host...` |
| `F-2302 AC-2, AC-34: the Remote-SSH section of the indicator menu is Connect to Host... then Connect Current Window to Host..., without icons` | `indicatorEntries()` maps to `[['opensshremotes.openEmptyWindow', 'remote_20_ssh-remote_1general@1'], ['opensshremotes.openEmptyWindowInCurrentWindow', 'remote_20_ssh-remote_1general@2']]` (command and group), and both commands' `icon` is `undefined` |
| `F-2302 AC-3: the two entries are shown whatever the connection's state` | the `when` of both entries is `!opensshremotes.standingDown` |
| `F-2303 AC-3: New Window on Active Host is in no indicator menu` | `placesOf('opensshremotes.openEmptyWindowOnCurrentHost')` is `['commandPalette']` |
| `F-2411 AC-1: Kill on Host is in every palette, Kill Current only in a connected SSH window's` | `placesOf('opensshremotes.cleanRemoteServer')` is `[]`, and the `commandPalette` entry of `opensshremotes.cleanCurrentRemoteServer` has the `when` `remoteName =~ /^ssh-remote$/ && remoteConnectionState == connected && !opensshremotes.standingDown` |
| `F-2412 AC-1: Uninstall VS Code Server from Host... is in the palette of every window` | `placesOf('opensshremotes.cleanDevBox')` is `[]`, and `resolved(title)` is `Uninstall VS Code Server from Host...` |
| `F-2605 AC-18: the clear command is in the palette of local and remote windows` | `placesOf('opensshremotes.clearAllSessionHints')` is `[]`; its `category` is `Remote-SSH`, `resolved(title)` is `Clear previous session metadata (used for enhanced error reporting)` |

| `F-2302 AC-1: Connect Current Window to Host... is in the palette unconditionally and has no keybinding` | as the `F-2301 AC-1` row of `skeleton.test.ts`, for `opensshremotes.openEmptyWindowInCurrentWindow`: `category` `Remote-SSH`, `resolved(title)` `Connect Current Window to Host...`, no `commandPalette` entry for it and no keybinding |

F-2302 AC-1 is ours with no `when` clause (athena, 2026-10-14). Hiding the entry while a window is connecting is
core's (F-2302 6.10).

### 2.2 Parse rows (`add-host.test.ts`)

The file's `parse` and `block` helpers. One `it` per row, each comparing a list of results with a list of expected
blocks:

| Name | Inputs | Expected |
|---|---|---|
| `F-2204 AC-11: every way of giving port 2222 writes Port 2222` | `ssh -p 2222 h`, `ssh -p2222 h`, `ssh -o Port=2222 h`, `user@h:2222`, `ssh://user@h:2222` | `block('h', [['Port', '2222']])` three times, then `block('h', [['User', 'user'], ['Port', '2222']])` twice |
| `F-2204 AC-15: -o options keep their spelling and order, and -o HostName is dropped` | `ssh -o Foo=bar -o "ProxyCommand=nc %h %p" h`, `ssh -o HostName=10.1.2.3 alias43`, `ssh -o port=2201 -o hostname=h44 alias44` | `block('h', [['Foo', 'bar'], ['ProxyCommand', 'nc %h %p']])`, `block('alias43')`, `block('alias44', [['port', '2201'], ['hostname', 'h44']])` |

### 2.3 Writer rows (`writer.test.ts`)

| Name | Assertion |
|---|---|
| `F-2204 AC-19: the new block copies the indentation of the file, or uses two spaces` | one `deepStrictEqual` of `write(file)` for five files against `${blockText(host, option)}\n${file}`: `Host a\n    X 1\n` → (`'  '`, `'    '`); `Host a\n\tX 1\n` → (`''`, `'\t'`); `Host a\nHostName x\n\nHost b\n    HostName y\n` → (`'  '`, `'    '`); `Host a\n      # note\nHostName x\n` → (`'    '`, `'      '`); `Host a\nHostName x\n` → (`''`, `'  '`) |
| `F-2204 AC-37: ssh reads the written block of ssh -p 2222 -l bob h as host h, port 2222 and user bob` | write `writeHostBlock('', <the block parseAddHostCommand('ssh -p 2222 -l bob h') gives>)` into `config` in a `mkdtempSync` folder (removed in `afterEach`); `spawnSync('ssh', ['-G', '-F', <config>, 'h'], {encoding: 'utf8'})`; the lines of its stdout that start with `hostname `, `port ` or `user `, sorted, are `['hostname h', 'port 2222', 'user bob']` (ssh prints `user` first: measured with OpenSSH on main's runner) |

The AC-37 row runs the real `ssh`, as `connect-timeout-lookup.test.ts` does in remote-ssh. If `ssh -G` isn't on the
runner's `PATH`, stop and report: don't skip the row.

### 2.4 The active host's argument (`connect-commands.test.ts`)

| Name | Steps | Expected |
|---|---|---|
| `F-2303 AC-19: an argument never names another host` | `runWith(undefined, {remoteName: 'ssh-remote', current: CONNECTED})`; take `const handler: CommandHandler = connectCommandHandlers(fakes.editor, fakes.connection).openEmptyWindowOnCurrentHost` (lib-identifiers' `CommandHandler`, which the registration calls with the command's arguments); `await handler.execute('other')`, then `await handler.execute({host: 'other'})` | `fakes.opened` is `[['ssh-remote+dev', 'new'], ['ssh-remote+dev', 'new']]` |

### 2.5 The uninstall's process rows (`bootstrap-script.test.ts`)

Rename the helper `afterKill(markers)` to `afterStep(step, markers)`, where `step` is `'kill' | 'uninstall'` and is
passed to `single(step)`. Every existing caller passes `'kill'`. Then add:

| Name | Setup | Expected |
|---|---|---|
| `F-2412 AC-27: uninstall stops the server and leaves the launcher, a node, a MainThread and a process that names the server folder` | `runScript(host, single('install'), parametersFor())`; markers `server: started('server', serverFile())`, `launcher: started('launcher', path.join(dataFolder(), 'code-abc123'))`, `node: started('node', '/usr/bin/node', ['/home/user/app.js'])`, `mainThread: started('mainThread', 'MainThread')`, `naming: started('naming', 'sleep', ['30', serverFile()])`; sleep 0.5 s | `afterStep('uninstall', markers)` is `['server']` |

## 3. The catalogue

After the rows pass, in `coverage-slice1.tsv`, set to `unit`: F-2204 AC-1, 11, 15, 19 and 37; F-2302 AC-1, 2, 3 and 34;
F-2303 AC-3 and 19; F-2411 AC-1; F-2412 AC-1 and 27; F-2605 AC-18. `pnpm check-coverage` passes and shows 15 more `unit`
lines.

## 4. Gates and review

Run all the gates: `pnpm lint`, `format:check`, `typecheck`, `dupes`, `dead`, `check-layout`, `check-string-tables`,
`check-identifiers`, `check-coverage`, `check-licences` and `coverage`.

- **PR title:** `tests: D-86's unit rows (card coverage-37, #725)`.
- **Review:** themis or triton reviews, and athena gives the tag check.

## 5. Open rows (stop and report on #725)

1. A row's expected value differs from main's result. Paste the actual value: it's a product defect or a card error,
   and daedalus decides which.
2. The F-2412 AC-27 row shows the uninstall stopping any process other than `server`, or leaving `server` running.
