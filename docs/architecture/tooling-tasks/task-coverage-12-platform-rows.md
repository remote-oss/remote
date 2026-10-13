# Task card coverage-12: the platform rows of F-2206 (batch 5 of #142's acceptance rows)

Issue: #551. Why: #142's acceptance rows, batch 5. F-2206 decides a host's platform before anything runs: the platform
pick, the `remote.SSH.remotePlatform` entries, and what is written back. Today unit rows prove the decisions
(`pipeline/platform.ts`, `terms-steps.ts`). These rows prove them end to end in the VSCodium run. Builder: hestia or
iris (hermes assigns). Size: about 1.5 agent-days. **Depends on coverage-10 (#546)**, for a case's own label and
settings and `time` on record lines, **and on tooling-24 (#552)**, whose `notice` surface lets a row show that no notice
appeared. This card adds record fields, below.

## 1. The cases

A file `tests/acceptance/suite-platform/cases.json`, one launch per case, launched as coverage-10's failure cases are:
`runner-remote`, the folder `vscode-remote://ssh-remote+<authority>/home/harness`, the case's own script and record,
and `environment.HARNESS_PLATFORM_CASE` set to the label. The authority is `harness` except where the table says
otherwise. Every launch is a fresh resolve, as coverage-11 §2 says: no helper of the run is left for `harness`.

- **Settings:** each case gets the run's base settings plus these keys. `remote.SSH.useLocalServer` is `false` for
  "terminal" and absent for "default".
- **The record:** a `platformPick` record line gains `items`, the labels in order, and `active`, the label of the
  focused item (`scripted-adapters.ts`, with its unit rows).
- **The focus:** `PlatformPick` (`connect/platform-picker.ts`) gains `active: RemotePlatform`, which `platformPickOf`
  sets to `linux`. The editor adapter sets the quick pick's `activeItems` to that item, with a unit row in
  `editor-adapters.test.ts`. The scripted adapter records its label. The port's comment "the first item focused" becomes
  "the `active` item focused".
- **Reading back:** the suite reads `<HARNESS_RUN_FOLDER>/user-data/User/settings.json` as the case's state
  afterwards.

`<w>` below is the wildcard key `harn*`, which matches `harness`. "Dialog E2" is
`Could not establish connection to "harness".`, the dialog of AC-10.

| Label | Mode | `remotePlatform` before | `windowsRemotes` | Pick answer | Expected | `remotePlatform` after | AC |
|---|---|---|---|---|---|---|---|
| `platform-default` | default | (none) | — | (none asked) | connected | settings.json unchanged | AC-1 |
| `platform-pick-linux` | terminal | (none) | — | `linux` | connected; the pick's placeholder is `Select the platform of the remote host "harness"`, items `Linux`, `Windows`, `macOS` | `{"harness": "linux"}` | AC-2, AC-5, AC-6 |
| `platform-pick-macos` | terminal | (none) | — | `macOS` | connected | `{"harness": "linux"}` | AC-7 |
| `platform-exact-linux` | terminal | `{"harness": "linux"}` | — | (none asked) | connected | unchanged | AC-8 |
| `platform-escape` | terminal | (none) | — | `dismiss` | dialog `Could not establish connection to "harness": Connecting was canceled.` | settings.json unchanged | AC-9 |
| `platform-pick-windows` | terminal | (none) | — | `windows` | dialog E2 | settings.json unchanged | AC-10 |
| `platform-windows-default` | default | `{"harness": "windows"}` | — | (none asked) | dialog E2 | unchanged | AC-11 |
| `platform-windows-terminal` | terminal | `{"harness": "windows"}` | — | (none asked) | dialog E2 | unchanged | AC-12 |
| `platform-wildcard-linux` | terminal | `{"<w>": "linux"}` | — | (none asked) | connected | `{"<w>": "linux", "harness": "linux"}`, keys in that order | AC-13 |
| `platform-exact-macos` | terminal | `{"harness": "macOS"}` | — | (none asked) | connected | `{"harness": "linux"}` | AC-14 |
| `platform-macos-default` | default | `{"harness": "macOS"}` | — | (none asked) | connected | unchanged | AC-15 |
| `platform-out-of-enum-solaris` | terminal | `{"harness": "solaris"}` | — | `linux` | connected | `{"harness": "linux"}` | AC-16 |
| `platform-out-of-enum-windows` | terminal | `{"harness": "Windows"}` | — | `linux` | connected | `{"harness": "linux"}` | AC-16 |
| `platform-out-of-enum-linux` | terminal | `{"harness": "Linux"}` | — | `linux` | connected | `{"harness": "linux"}` | AC-16 |
| `platform-wrong-case-upper` | default | `{"harness": "WINDOWS"}` | — | (none asked) | connected | unchanged | AC-17 |
| `platform-wrong-case-title` | default | `{"harness": "Windows"}` | — | (none asked) | connected | unchanged | AC-17 |
| `platform-listed-default` | default | (none) | `["harness"]` | (none asked) | dialog E2 | settings.json unchanged | AC-21 |
| `platform-listed-terminal` | terminal | (none) | `["harness"]` | (none asked) | dialog E2 | settings.json unchanged | AC-21 |
| `platform-listed-linux-entry` | terminal | `{"harness": "linux"}` | `["harness"]` | (none asked) | dialog E2 | unchanged | AC-21 |
| `platform-typed-user` | terminal; authority `harness@harness` (a typed `user@host`, read as text) | (none) | — | `linux` | connected; the pick's placeholder is `Select the platform of the remote host "harness"` | `{"harness": "linux"}` | AC-24 |
| `platform-wildcard-windows` | terminal | `{"<w>": "windows"}` | — | (none asked) | dialog E2; the `mitigationPick` line's question is `Pick an action to help resolve the problem.` | unchanged | AC-32 |
| `platform-broken-settings` | terminal | (none) | — | `linux` | connected | settings.json byte for byte as written | AC-36 |
| `platform-middle-key` | terminal | `{"aaa": "linux", "harness": "macOS", "zzz": "windows"}` | — | (none asked) | connected | `{"aaa": "linux", "harness": "linux", "zzz": "windows"}`, keys in that order | AC-37 |

All ids are F-2206's. "Unchanged" means `remote.SSH.remotePlatform` is the "before" value, keys in the same order;
"settings.json unchanged" means the file has no `remote.SSH.remotePlatform` key and is otherwise as written.

**`platform-broken-settings`:** the run writes the base settings, then a syntax error after the last key inside the
object: a member with no comma before it, `"acceptance.broken": 1 "acceptance.brokenToo": 2`. The editor still reads
the members before the error, so `remote.SSH.configFile` and `remote.SSH.useLocalServer` must come first in the file;
the tools row checks that order.

For a dialog case the script answers the `failureDialog` and then the `mitigationPick` with `dismiss`, as
`suite-failure/cases.json` does. A `platformPick` entry's `match` is `"harness"`. Only `platform-wildcard-windows` asserts the `mitigationPick` line.

## 2. The rows (`suite-platform/platform.test.ts`, run in each launch)

`cite` is `F-2206 <the case's AC>` and the label, for example `F-2206 AC-16 (platform-out-of-enum-solaris)`.

| Name | Assertion |
|---|---|
| `` `${cite}: the platform pick was asked or not, as the case says` `` | the record has a `platformPick` line exactly when the answer isn't "(none asked)", and its placeholder is the table's where the table gives one |
| `` `${cite}: the connect ended as the case says` `` | connected: `vscode.env.remoteName` is `ssh-remote`; dialog: the `failureDialog` line's question is the table's text |
| `` `${cite}: remote.SSH.remotePlatform afterwards is the case's` `` | the settings file's `remote.SSH.remotePlatform` as `Object.entries` (so order counts), or, for `platform-broken-settings`, the file byte for byte |
| `F-2206 AC-2 (platform-pick-linux): the pick lists Linux, Windows and macOS, in order` | the `platformPick` line's `items` |
| `F-2206 AC-2 (platform-pick-linux): Linux is focused` | the `platformPick` line's `active` is `Linux` |
| `` `${cite}: no notice appeared` `` (`platform-default`, `platform-macos-default`, both `platform-wrong-case-*`) | the record has no `notice` line |
| `F-2206 AC-11 (platform-windows-default): no probe ran` | `connectionLog()` has none of the probe's lines (below) |
| `F-2206 AC-32 (platform-wildcard-windows): More Actions... offers the resolve picker` | the `mitigationPick` line's question |

**The probe's lines.** The AC-11 row uses a positive control. In `platform-default`, which connects through the
probe, a row `positive control: the probe's lines are in the log of a default-mode connect` finds the lines that only
the host's POSIX probe gives: its report of the host's operating system and architecture. The AC-11 row asserts those
lines are absent. Both rows match one pattern, a constant of the suite read from the probe's own output in lib-server.
Don't write it from the measured text.

## 3. The catalogue

Athena's rule (#553): an AC is `acceptance` only when every observable half is proven, and only a half that core alone
renders may stay unproven.

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2206 AC-1, 2, 5, 12, 15, 16, 17, 21, 32 and 37 go from `todo`
to `acceptance`. AC-5's window title and remote indicator are a core half: core renders them from our label formatter
(F-2502). List it under "Core halves" in #142's tracking comment.

These keep their rows here but stay `todo`. List each under "Needs an acceptance row: harness capability missing" with
what it waits for:

| AC | The half no row here proves | Waits for |
|---|---|---|
| AC-6, 7, 13, 14, 24 | the "You selected …" notice | the notice itself: it isn't built yet (connect-25, #554), whose card adds the notice entries to these cases |
| AC-36 | no error notice when the write fails | connect-25, as above |
| AC-8 | a reload, and no notice | tooling-20 (#544); connect-25 |
| AC-9, 10, 11 | Retry shows the pick again, or fails the same way | tooling-20 (#544) |

F-2206 AC-25, 26, 27, 28, 29, 31, 33, 34, 35 and 38 aren't in this batch. They need connect-25, connect-23, tooling-20,
a second host, a network cut or the trust dialog, and they stay `todo`. AC-3 is `core`. AC-18, 19, 20, 22 and 23 stay
`unit`.

## 4. Done when

- `pnpm test:acceptance:vscodium` passes with the 23 launches; paste the `suite-platform` summaries;
- the tools rows pass (the cases file is read, each launch gets its settings, the broken file's order), as do the
  repository's gates.

If a case behaves otherwise, don't change the table: report it on the issue as a bug or a spec question.

## 5. Review

PR title `tests: the platform rows of F-2206 (card coverage-12, #142)`. themis or triton reviews; proteus runs the 23
launches, which may go in the dispatch that coverage-11 asked for.
