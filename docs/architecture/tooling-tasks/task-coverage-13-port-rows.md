# Task card coverage-13: the port and bind-host rows of F-2409 (batch 6 of #142's acceptance rows)

Issue: #556. Why: #142's acceptance rows, batch 6. F-2409 decides where the server listens on the host: the port
range per host, the bind host, and reuse of a running server. Today unit rows and `server/start.test.ts` prove the
pieces. These rows prove them end to end in the VSCodium run, with the server killed between cases and ports held on
the host. Builder: selene. Size: about 2 agent-days. **Depends on tooling-24 (#552)**, whose `notice` surface lets a row
show that no notice appeared. Nothing else: the cases are launched by this card's own code, not coverage-10's or
coverage-12's.

## 1. Harness additions

### 1.1 A launch's host setup (`tools/acceptance-launches.ts`, `tools/acceptance.ts`)

`Launch` gains `hostSetup?: ReadonlyArray<{command: string; detach?: boolean}>`. Before each attempt of the launch
(inside `runWithRetry`'s callback, before `writeUserSettings`), the run runs each entry in order:
`docker exec [-d] <container> sh -c <command>`, as root. `-d` is used when `detach` is true. When a non-detached
command exits non-zero, the attempt fails with `host setup failed: <command>` and its output.

### 1.2 A copy of each launch's settings (`tools/acceptance.ts`)

`writeUserSettings` also writes the same bytes to `<run folder>/<label>-settings.json` when it writes a launch's
settings. A row compares the user settings file with it.

### 1.3 One more `ssh_config` block (`harnessSshConfig`)

After the `harness` block, add `Host 127.0.0.1` with the `harness` block's lines except `HostName`: `Port`, `User
harness`, `IdentityFile`, `IdentitiesOnly yes`, `IdentityAgent none`, `StrictHostKeyChecking accept-new`, `BatchMode
yes`, `ConnectTimeout 10` and the same `UserKnownHostsFile`. An authority typed as `harness@127.0.0.1` then reaches the
harness host (AC-5). ssh matches `Host` against the name as typed, so the other aliases whose `HostName` is `127.0.0.1`
are unchanged.

### 1.4 The ports cases (`tests/acceptance/suite-ports/cases.json`, `acceptance-launches.ts`)

`PortsCase`: `label`, `cite`, `authority?` (default `harness`), `settings`, `holders?: number[]`, `keepServer?:
boolean`, `outcome: 'connected' | 'connectedOrDialog'`, and the expectations of §2. `launchesOf` appends one launch per
case, **after every other launch**, in file order:
- label `ports-<label>`, runner `runner-remote`, suite `suite-ports`;
- `folderUri`: `vscode-remote://ssh-remote+<authority>/home/harness`;
- `settings`: the case's settings;
- `environment`: `{HARNESS_PORTS_CASE: <label>}`;
- `ownScript: true`. The run writes the script `[{surface: 'failureDialog', match: '"', answer: 'dismiss'},
  {surface: 'mitigationPick', match: 'Pick an action', answer: 'dismiss'}]` for every ports case. A connected case
  leaves it unused, which is no failure.

**The setup of each ports case**, in this order. The `[.]` and `[c]` keep `pkill` from matching the `sh -c` that
runs it:

| # | When | `command` | `detach` |
|---|---|---|---|
| 1 | always | `pkill -f 'n[c] -lk -p'; true` | no |
| 2 | unless `keepServer` | `pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'; for i in $(seq 1 20); do pgrep -f '/home/harness/[.]vscodium-server-insiders/bin/' >/dev/null \|\| exit 0; sleep 0.5; done; exit 1` | no |
| 3 | per holder `<p>` | `nc -lk -p <p> -s 127.0.0.1 -e /bin/true` | yes |
| 4 | per holder `<p>` | `for i in $(seq 1 20); do netstat -ltn \| grep -q ' 127.0.0.1:<p> ' && exit 0; sleep 0.25; done; exit 1` | no |

A BusyBox `nc -lk … -e /bin/true` keeps listening after each connection (measured on the host's `alpine:3.22` image).
The server tests a port by listening on it ([oss] `src/server-main.ts`, `findFreePort`), so a held port is busy for
it. The server's `.<commit>.pid` file stays after the kill. A next start that doesn't start a new server for it is a
bug: report it on the issue.

`tests/acceptance/README.md`: `hostSetup` goes in the launches table, and a "Ports cases" paragraph gives the setup
above and the rule that ports cases come last.

### 1.5 Suite helpers (`tests/acceptance/suite-ports/ports.ts`)

- `serverPort()`: the number of the last `connectionLog()` line `Remote server listening on port <n>`. It throws when
  there's none.
- `listenAddress(port)`: from `onHost('netstat', '-ltn')`, the address part of the local address of the `LISTEN`
  line that ends in `:<port>`. It's `undefined` when there's none.
- `containerAddress()`: `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
  $HARNESS_CONTAINER`, trimmed.
- `reaches(address, port)`: `net.connect` succeeds within 5 s, then the socket is destroyed.

## 2. The cases

`R` is the range `45000-45010`. "Random" means the port is outside `45000`–`45010` and `46000`–`46010`.

| Label | Settings | Holders | Other | Expected | AC |
|---|---|---|---|---|---|
| `range` | `serverPickPortsFromRange: {"harness": R}` | — | — | connected; port 45000; listens on `127.0.0.1` | AC-2 |
| `reuse` | `useExecServer: false`, `serverPickPortsFromRange: {"harness": "46000-46010"}`, `bindHost: {"harness": "0.0.0.0"}` | — | `keepServer`; right after `range` | connected; port 45000; listens on `127.0.0.1`; no listener on 46000 | AC-23 |
| `range-held` | as `range` | 45000–45004 | — | connected; port 45005 | AC-3 |
| `range-gaps` | as `range` | 45000, 45002 | — | connected; port 45001 | AC-21 |
| `range-single` | `serverPickPortsFromRange: {"harness": "45005-45005"}` | — | — | connected; port 45005 | AC-21 |
| `key-hostname` | `serverPickPortsFromRange: {"127.0.0.1": R}` | — | — | connected; random port | AC-4 |
| `key-star` | `serverPickPortsFromRange: {"*": R}` | — | — | connected; random port | AC-4 |
| `key-case` | `serverPickPortsFromRange: {"HARNESS": R}` | — | — | connected; random port | AC-4 |
| `address` | `serverPickPortsFromRange: {"127.0.0.1": R, "harness@127.0.0.1": "46000-46010"}` | — | authority `harness@127.0.0.1` | connected; port 45000 | AC-5 |
| `bind-all` | `bindHost: {"harness": "0.0.0.0"}` | — | — | connected; listens on `0.0.0.0`; `reaches(containerAddress(), port)` | AC-6 |
| `bind-all-range` | `useExecServer: false`, `bindHost: {"harness": "0.0.0.0"}`, `serverPickPortsFromRange: {"harness": "46000-46010"}` | — | — | connected; port 46000; listens on `0.0.0.0` | AC-20 |
| `bind-other-key` | `bindHost: {"other": "not a host!"}` | — | — | connected; no `notice` line | AC-8 |
| `range-number` | `serverPickPortsFromRange: {"harness": 45030}` | — | `connectedOrDialog` | see below | AC-15 |
| `bind-number` | `bindHost: {"harness": 5}` | — | `connectedOrDialog` | see below; when connected, listens on `127.0.0.1` | AC-27 |
| `bind-true` | `bindHost: {"harness": true}` | — | `connectedOrDialog` | as `bind-number` | AC-27 |
| `bind-null` | `bindHost: {"harness": null}` | — | `connectedOrDialog` | as `bind-number` | AC-27 |

Setting ids are `remote.SSH.<name>`. Every case also expects the user settings file unchanged (AC-17).

**`connectedOrDialog`** (AC-15, AC-27): either the window is on `ssh-remote`, or the record has a `failureDialog` line
whose question starts with `Could not establish connection to "harness"`. In both cases: no `notice` line; no record
line whose question contains `Error:`, `TypeError`, `ReferenceError` or `    at `; and
`vscode.workspace.openTextDocument({content: 'usable'})` resolves (the window stays usable).

## 3. The rows (`suite-ports/ports.test.ts`, run in each launch)

`cite` is `F-2409 <the case's AC>` and the label, for example `F-2409 AC-21 (range-gaps)`.

| Name | Assertion |
|---|---|
| `` `${cite}: the connect ended as the case says` `` | connected: `vscode.env.remoteName` is `ssh-remote`; `connectedOrDialog`: as §2 |
| `` `${cite}: the server listens on the case's port` `` (cases with a port or "random") | `serverPort()` |
| `` `${cite}: the server listens on the case's address` `` (cases with "listens on") | `listenAddress(serverPort())` |
| `F-2409 AC-23 (reuse): nothing new listens in the new range` | `listenAddress(46000)` is `undefined` |
| `F-2409 AC-6 (bind-all): another machine reaches the server's port` | `reaches(containerAddress(), serverPort())` is true |
| `` `${cite}: no notice appeared` `` (`bind-other-key` and the `connectedOrDialog` cases) | the record has no `notice` line |
| `` `${cite}: the window stays usable, with no script error text` `` (`connectedOrDialog` cases) | as §2 |
| `` `F-2409 AC-17 (${label}): settings.json is unchanged` `` (every case) | `<run>/user-data/User/settings.json` equals `<run>/ports-<label>-settings.json` byte for byte |

Unit rows in `tools/acceptance-launches.test.ts` and `tools/acceptance.test.ts`:
- the ports launches come last, in file order;
- the setup commands for a case with and without `keepServer` and `holders`;
- a failing setup fails the attempt with its command;
- the settings copy is written;
- the `Host 127.0.0.1` block.

## 4. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2409 AC-2, 3, 4, 5, 6, 8, 15, 17, 20, 21, 23 and 27 go from `todo`
to `acceptance`. AC-6's "window connects with the indicator" half is core's rendering of our label: list it under
"Core halves" in #142's tracking comment.

These stay `todo`. List each under "Needs an acceptance row: harness capability missing" with what it waits for:

| AC | Waits for |
|---|---|
| AC-7 | STR:S168 at the start of the connect: not built; decision Q1 (remote-oss/remote-ssh#93), then a card |
| AC-9, 10, 29 | STR:S135 as the reason with `useExecServer` false: connect-26 (#557) |
| AC-14 | a malformed range that fails before the start: connect-26 (#557) |
| AC-13 | the reversed range's reason: decision Q3 (a) (remote-oss/remote-ssh#93) |
| AC-25, 26 | the ready wait: 60 s by the ruling of #253 Q7, where the AC wants about 13–20 s (athena) |
| AC-11, 16 | Retry and reload: tooling-20 (#544) |
| AC-12, 19, 22, 28 | exec-server mode, which needs the CLI path (dormant in 0.2) |
| AC-1 | a second fresh host |
| AC-18 | session hints (F-2605) |
| AC-24 | a host whose `localhost` is the IPv6 loopback first |
| AC-30 | decision Q5 (remote-oss/remote-ssh#93) |

## 5. Done when

- `pnpm test:acceptance:vscodium` passes with the 16 new launches; paste the `suite-ports` summaries;
- the unit rows of §3 and the repository's gates pass.

If a case behaves otherwise, don't change the table: report it on the issue, as a bug or a spec question.

## 6. Review

PR title `tests: the port and bind-host rows of F-2409 (card coverage-13, #142)`. themis or triton reviews; proteus
checks the host setup and the 16 launches.
