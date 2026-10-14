# Task card coverage-12: the platform rows of F-2206 (batch 5 of #142's acceptance rows)

Issue: #551. Why: #142's acceptance rows, batch 5. F-2206 decides a host's platform before anything runs: the platform
pick, the `remote.SSH.remotePlatform` entries, and what is written back. Today unit rows prove the decisions
(`pipeline/platform.ts`, `terms-steps.ts`). These rows prove them end to end in the VSCodium run. Builder: hestia or
iris (hermes assigns). Size: about 3.5 agent-days with §2a, which the 0.2 acceptance-row cards added (#712–#715's card
PR). **Depends on coverage-10 (#546)**, for a case's own label and
settings and `time` on record lines, **on tooling-24 (#552, merged)**, whose `notice` surface lets a row show that no
notice appeared, **on connect-27 (#559)**, which gives the dismissed pick's dialog its `Connecting was canceled`
(`platform-escape` fails without it), **and on connect-28 (#563)**, which writes the `Host platform:` line the probe
rows read. This card adds record fields, below. §2a also depends on:
- coverage-14 (#568), for `userSettings` and `connectionHelpers`. If it hasn't merged, add them to `windows/harness.ts`
  as coverage-14 §1 says;
- coverage-29 (#712), for the record's `progressEnd` line (AC-35's row).

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
| `platform-mute-default` | default; authority `mute` (a login shell that doesn't answer the probe) | (none) | — | (none asked) | a dialog of any text: "the connect ended" row checks only that a `failureDialog` line exists, and §2's AC-28 row checks its time | settings.json unchanged | AC-28 |
| `platform-mute-terminal` | terminal; authority `mute` | (none) | — | `linux` (`match` `"mute"`) | connected | `{"mute": "linux"}` | AC-28 |
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
| `` `F-2206 AC-31 (${label}): no line names a detected Windows host or the remotePlatform hint` `` (every dialog case, and `platform-exact-macos`, `platform-macos-default`, `platform-pick-macos`) | no record line's `question` or `items` holds `Detected Windows host, need to reconnect` (STR:S034) or `setting correctly reflects the remote platform` (the fixed part of STR:S057) |
| `F-2206 AC-28 (platform-mute-default): no pick, and the dialog came after the connect timeout` | no `platformPick` line; the `failureDialog` line's `time` minus the first `progress` line's is between 13 000 and 25 000 ms (`remote.SSH.connectTimeout` at its default, 15). The dialog's text isn't asserted: AC-28 doesn't name it. Record it in the PR |

**F-2501's cites.** Two of these launches also prove F-2501 (`remote-oss/remote-ssh#59`) ACs. coverage-19 (#590) leaves
them to this card:
- `platform-pick-linux` cites F-2501 AC-27 as well: the platform question comes inside the resolve, in terminal mode
  with no entry;
- `platform-escape` cites F-2501 AC-29 as well: its dialog is AC-29's.

Name the rows with both cites, for example `F-2206 AC-9, F-2501 AC-29 (platform-escape): …`.

**The probe's lines.** The AC-11 row uses a positive control. In `platform-default`, which connects through the
probe, a row `positive control: the probe's lines are in the log of a default-mode connect` finds connect-28's
`Host platform:` line, which is written only after the probe has read the host. The AC-11 row asserts that no such line
is there. Both rows build the line's start with connect-28's `hostPlatformLine` builder from `log-content.ts`; don't
copy its text.

## 2a. The windows rows (`tests/acceptance/windows/platform.test.ts`, windows `pf1`–`pf3`)

These are F-2206's ACs that need a reload, Retry, a second window, a maintenance command or a network cut, so they run
in the `windows` launch.

**Each row starts clean:**
- no `pf*` window open;
- `remote.SSH.remotePlatform` removed from the user settings;
- the row's mode set with `userSettings`: "terminal" is `remote.SSH.useLocalServer` `false`, and "default" removes the
  key.

`userSettings` takes `undefined` for a key to remove it. Add that if coverage-14's helper lacks it. Write the settings
back to the run's bytes after the file.

**Terms:**
- "connected" is coverage-14 §2's;
- E1 is `Could not establish connection to "harness": Connecting was canceled.`; E2 is `Could not establish connection
  to "harness".`;
- `(fail)` is `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`;
- "nothing stored" means the settings have no `remote.SSH.remotePlatform` key;
- "after removing the entry" means `userSettings({'remote.SSH.remotePlatform': undefined})` once the window is
  connected: a connect in terminal mode writes the entry (AC-6).

**Network helpers** (`windows/harness.ts`):
- `cutHostNetwork()` is `cutNetwork(runCommand, variable('HARNESS_CONTAINER'))` from `tools/acceptance-network.ts`;
- `restoreHostNetwork()` calls `restoreNetwork` the same way.

A row that cuts restores in a `finally`. coverage-19 adds the same pair; whichever card lands second reuses them.

**Script entries** are appended before the step and name their window. A Kill or Uninstall runs in `local`, with
`window: 'local'`.

**The platform notice.** connect-25 has merged (#594), so a connect that writes an entry shows the notice
`You selected "<platform>" as the remote platform - …`. Every row whose connect writes an entry (a `platformPick`
answered `linux` or `macOS`, or a rewrite) appends `notice` `You selected` → `dismiss` for that window right after its
`platformPick` entry, so the notice doesn't take a later entry's place. AC-35's row asserts it.

**`appendScript` needs the pick surfaces.** `AppendedEntry` (`tools/script-file.ts`) has no `hostPick` and no
`{label}` answer today. Widen it as coverage-30 §1 says. Whichever of coverage-12, coverage-30 and coverage-31 lands
first adds it, and the others reuse it.

| Cite | Setup and steps | Assertions |
|---|---|---|
| F-2206 AC-4 | terminal. `pf1`: `platformPick` `"harness"` → `linux` with `after: 'pf-4'`. Open `pf1` on `harness`; wait for its held line; wait 120 s; signal `pf-4` | over the 120 s, no `withdrawn` line of `pf1`, and no `failureDialog`, `notice`, `pick` or `maskedInput` line of `pf1`. After the signal, `pf1` is connected |
| F-2206 AC-8 | terminal, `{"harness": "linux"}`. Keep the settings' bytes. Open `pf1` on `harness`; reload `pf1` | after the open and after the reload: connected, no `platformPick` line and no `notice` line of `pf1`; the settings byte for byte as kept |
| F-2206 AC-9 | terminal. `pf1`: `platformPick` → `dismiss`; `failureDialog` → `{button: 'Retry'}`; `platformPick` → `dismiss`; (fail) | two `platformPick` lines of `pf1`, the second after the Retry; both `failureDialog` lines are E1, with `buttons` `["Close Remote", "Retry", "More Actions..."]`; nothing stored |
| F-2206 AC-10 | terminal. `pf1`: `platformPick` → `windows`; `failureDialog` → `{button: 'Retry'}`; `platformPick` → `dismiss`; (fail) | the first dialog is E2; a second `platformPick` line after the Retry; the second dialog is E1; nothing stored |
| F-2206 AC-11 | default, `{"harness": "windows"}`. `pf1`: `failureDialog` → `{button: 'Retry'}`; (fail) | both dialogs are E2; no `platformPick` line of `pf1`; no log line since the step starts with `Host platform:` (build it with `hostPlatformLine`, as §2's AC-11 row does) |
| F-2206 AC-26 (Escape) | terminal. Open `pf1` on `harness` with `platformPick` → `linux`; connected; then remove the entry. Note `onHost('pgrep', '-f', '/home/harness/[.]vscodium-server-insiders/bin/')`. In `local`, run `opensshremotes.cleanRemoteServer`: `hostPick` → `{label: 'harness'}`, `platformPick` → `dismiss` | a `platformPick` line of `local`; no `failureDialog` line of `local`; the same server processes run (nothing ran on the host); `pf1` is still connected; nothing stored. Don't assert on a `notice` line: S076 after Escape is consistent with F-2411 7.E5 (athena). Script `notice` → `dismiss` for `local` after the `platformPick` entry, so it's answered if it comes |
| F-2206 AC-26 (Linux) | close `pf1`. The same command: `hostPick` → `{label: 'harness'}`, `platformPick` → `linux`, `notice` → `dismiss` | a `notice` line `Killed VS Code Server on harness.`; nothing stored |
| F-2206 AC-26 (default) | default. The same command: `hostPick` → `{label: 'harness'}`, `notice` → `dismiss` | no `platformPick` line of `local` since the step; a `notice` line `Killed VS Code Server on harness.` |
| F-2206 AC-26 (Kill Current) | only once connect-43 (#681) has merged. Terminal. `pf1` connected, then the entry removed. In `pf1`, run `opensshremotes.cleanCurrentRemoteServer` with `platformPick` → `dismiss`; then again with `platformPick` → `linux` | after `dismiss`: `pf1` connected, no `failureDialog` line of `pf1`, nothing stored (no assertion on a `notice` line, as in the Escape row above; script `notice` → `dismiss` for `pf1` after the `platformPick` entry). After `linux`: the command's own result (connect-43's card), nothing stored |
| F-2206 AC-27 | terminal. Open `pf1` with `platformPick` → `linux`; connected; remove the entry. `pf1`: `platformPick` → `linux` with `after: 'pf-27'`. `cutHostNetwork()`; wait up to 180 s for a new held `platformPick` line of `pf1`; `restoreHostNetwork()`; signal `pf-27` | the held `platformPick` line came after the cut: core's reconnection asked again. `pf1` is connected within 60 s of the signal; no `failureDialog` line of `pf1` |
| F-2206 AC-29 | default. Open `pf1` on `harness`; connected; note `connectionHelpers()`. `userSettings({'remote.SSH.remotePlatform': {harness: 'windows'}})`. Open `pf2` on `harness` | `pf2` connected, through the same helper process (the existing server is reused) |
| F-2206 AC-29 (Kill) | (fail) for `pf1` and for `pf2`, whose reconnections may fail now. In `pf2`, run `opensshremotes.cleanLocalServer` with `hostPick` → `{label: 'harness'}`. Then open `pf3` on `harness` with (fail) | `pf3`'s dialog is E2, and `pf3` has no `platformPick` line: the entry took effect. Close every `pf*` window |
| F-2206 AC-34 | terminal. Open `pf1` with `platformPick` → `linux`; connected; remove the entry. For `nextEmptyName()`: `platformPick` → `dismiss`, then (fail). `nextEmptyWindow(() => inWindow('pf1', 'opensshremotes.openEmptyWindowOnCurrentHost'))` | the new window has a `platformPick` line, and its `failureDialog` line is E1 |
| F-2206 AC-35 | terminal. `pf1`: `platformPick` → `linux`. Open `pf1` on `harness`; wait for `pf1`'s `progressEnd` line (coverage-29), which comes when the resolve has returned; `cutHostNetwork()` at once | within 10 s: the settings hold `{"harness": "linux"}`, and a `notice` line of `pf1` is the AC-6 notice (`You selected "linux" as the remote platform - …`). Then restore, and close `pf1` |
| F-2206 AC-33 (Escape; **waits on its fix**, §6) | terminal. Note `onHost('ls', '/home/harness/.vscodium-server-insiders/bin')`. In `local`, run `opensshremotes.cleanDevBox`: `hostPick` → `{label: 'harness'}`, `platformPick` → `dismiss` | the command resolves; no `failureDialog` or `notice` line of `local`; the listing unchanged; nothing stored |
| F-2206 AC-33 (Linux) | the same command with `platformPick` → `linux` | the command resolves; the listing has no server folder (or the folder is gone); nothing stored |

**Order:** the rows run in the table's order. The AC-26 and AC-33 rows end or remove the harness account's server.
After the file, open `pf1` on `harness` in default mode, wait until it's connected, and close it, so the files after
this one find a server.

**Measure first** and write what you saw into the PR:
- AC-27: how long core waits before its first reconnection after the cut;
- AC-29: what `pf1` and `pf2` show after the Kill.

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
| AC-6, 7, 13, 14, 24, 25, 36 | the "You selected …" notice | connect-25's §4 rows (#554, still open). connect-25's product half has merged (#594). Its §4 adds the notice entries and rows to this card's cases once they exist, and tags these ACs. Not this card |

**§2a's ACs:**
- F-2206 AC-4, 8, 9, 10, 11, 27, 28, 29, 31, 34 and 35 go to `acceptance`. Each needs all its rows here: AC-8, 9,
  10 and 11 need §1's case and §2a's row, and AC-28 its two cases.
- **AC-33** stays `todo` until its Escape row can pass (§6, open row 1: the dismissed platform pick of Uninstall
  throws).
- **AC-26** goes to `acceptance` only with its Kill Current row. Until connect-43 (#681) has merged, it stays `todo`
  with that wait.
- **AC-30** goes to `unit`, reason `skeleton.test.ts's F-2206 AC-30 row: the manifest's texts; the Settings UI and its
  invalid-value flag are core's`.
- **F-2501 AC-27 and AC-29** go to `acceptance` with `platform-pick-linux` and `platform-escape`. Their core halves:
  AC-27's "Opening Remote..." indicator, and AC-29's "core shows no notification of its own".

F-2206 AC-25 and 38 aren't in this batch and stay `todo`: a second host, and the trust dialog. AC-3 is `core`. AC-18,
19, 20, 22 and 23 stay `unit`.

## 4. Done when

- `pnpm test:acceptance:vscodium` passes with the 25 launches and §2a's file; paste the `suite-platform` and `windows`
  summaries;
- the tools rows pass (the cases file is read, each launch gets its settings, the broken file's order), as do the
  repository's gates.

If a case behaves otherwise, don't change the table: report it on the issue as a bug or a spec question.

## 5. Review

PR title `tests: the platform rows of F-2206 (card coverage-12, #142)`. themis or triton reviews; proteus runs the 25
launches, which may go in the dispatch that coverage-11 asked for. Because proteus verifies it, the build PR opens with
the `needs-verification` label, and proteus removes the label when the run passes.

## 6. Open rows

1. **F-2206 AC-33's Escape row waits on a product fix.** F-2206 AC-33 says that after Escape at the platform pick,
   Uninstall "ends without dialog, notification or change on the host". On main, a dismissed pick fails
   `decideTerms`, so the run ends `connectionFailed` (`maintenance/maintenance-run.ts`), and `cleanDevBox` throws
   (`maintenance/maintenance-commands.ts`). Core then shows its "Command … resulted in an error" dialog. The lead cards
   the fix. Write the Escape row once that fix has merged. Until then, leave it out and keep AC-33 `todo`. The AC-33
   (Linux) row doesn't wait.
