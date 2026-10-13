# Task card connect-25: the platform notice of F-2206 ("You selected …", Don't Show Again)

Issue: #554. Why: F-2206 5.2 steps 5–6, 6.4, BR-9, BR-11 and 7.E9 (`remote-oss/remote-ssh#33`). A non-local connect
writes `remote.SSH.remotePlatform` (`terms-steps.ts`, `rememberPlatform`), but nothing shows the notice that goes with
the write. Card coverage-12 (#551) found the gap: AC-6, 7, 13, 14, 24, 25 and 36 can't be `acceptance` without it.
Builder: hestia or iris (hermes assigns). Size: about 1 agent-day. **Depends on tooling-24 (#552)** for the `NoticePort`
in the adapters, **and on coverage-12 (#551)** for `suite-platform` and its cases.

## 1. The behaviour

When `platformWrite` gives `{kind: 'set', platform}`, `rememberPlatform`:

1. **announces** the platform. This shows the notice unless it's suppressed, and is **not awaited**: the resolve
   never waits for the notice or its answer (5.2 step 6: the notice doesn't wait for the file change);
2. then requests the write as today, inside the existing `quietly('the platform setting', …)`. A failed write is
   logged and changes nothing else, and the notice is already shown (7.E9).

When it gives `{kind: 'none'}`, nothing is shown. Default mode, an equal exact entry, failures and cancels already
give `none` or never reach `rememberPlatform`.

**The notice:**

- an information notice through tooling-24's `NoticePort.showInformation(message, buttons)`;
- the message is `You selected "{0}" as the remote platform - this will be stored in the setting
  "remote.SSH.remotePlatform" and can be changed there if needed.`, with `{0}` = `write.platform`: the stored value,
  not the item picked (BR-8);
- the one button is `Don't Show Again` (STR:S039);
- the editor's notification shows the source, the auto-hide and the notification centre (core halves).

**Don't Show Again** (6.4, BR-11): when the notice answers `Don't Show Again`, the extension's global state gets
`suppressRemotePlatformNotification: true`. An announce first reads that key and shows nothing when it holds `true`.
The write isn't affected. A dismissal stores nothing. The key is the one the spec's §9 names, without the reference's
prefix: `context.globalState` already belongs to our extension id (F-3901).

A rejected `showInformation` or `update` is logged at `warn` as `the platform notice did not work: <message>`, never
thrown and never unhandled.

## 2. Files

| File | Change |
|---|---|
| `packages/remote-ssh/src/connect/platform-notice.ts` (new) | `announcePlatform(dependencies, platform): void`, where `dependencies` is `{notice: NoticePort; state: AcceptanceState; translate: Translate; logger: Logger}`. It reads the key, shows the notice, and stores the key on the button. `SUPPRESS_PLATFORM_NOTICE_KEY` is the key |
| `packages/remote-ssh/src/surfaces/own-strings.ts` | `OWN_TEMPLATES` gains `platformStoredNotice` (the message above) and `S039: "Don't Show Again"`. The fileoverview becomes "the strings outside the failure dialog's table: our own named ids, and the spec's ids used elsewhere" |
| `packages/remote-ssh/l10n/bundle.l10n*.json` | both templates in every bundle, English as the value, as ssh-36 (#449) added its string |
| `packages/remote-ssh/src/pipeline/terms-steps.ts` | `TermsStepDependencies` gains `announcePlatform: (platform: RemotePlatform) => void`, called before `writePlatform` when the write is `set` |
| `packages/remote-ssh/src/editor-surfaces.ts`, `connect-ports.ts`, `extension.ts` | wire `announcePlatform` from `adapters.notice`, `context.globalState`, `translate` and the logger. The context gains `noticeState: context.globalState` beside `acceptanceState` |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts` | a `notice` record line gains `buttons`, the labels passed, in order, as coverage-10 gave `failureDialog` lines. `RecordLine` in `tests/acceptance/suite-local/script.ts` mirrors it |
| `tools/acceptance.ts` | the run's `ssh_config` names the first block `Host harness second`, so `second` is the same host under another name (AC-25) |
| `tests/acceptance/suite-platform/cases.json`, `platform.test.ts` | section 4 |

## 3. Unit rows

`platform-notice.test.ts`, `terms-steps.test.ts`, `scripted-adapters.test.ts`, with fakes for the port and the state:

| Name | Expected |
|---|---|
| `F-2206 5.2: a set write announces the stored platform with one Don't Show Again button` | `showInformation` called once with the `linux` message and `["Don't Show Again"]` |
| `F-2206 BR-8: the notice names the reported platform, not the one picked` | a pick of `macOS`, reported `linux`: the message says `"linux"` |
| `F-2206 BR-9: no write, no notice` | `none` → `showInformation` not called |
| `F-2206 6.4: Don't Show Again stores the suppression` | the state holds `suppressRemotePlatformNotification: true` |
| `F-2206 6.4: a dismissed notice stores nothing` | the state is unchanged |
| `F-2206 BR-11: a suppressed notice isn't shown and the write still happens` | no `showInformation`; `writePlatform` called |
| `F-2206 7.E9: the notice is shown before the write, so a failed write still has it` | call order notice, write; the write rejects; `rememberPlatform` resolves |
| `F-2206 5.2: the resolve doesn't wait for the notice` | `showInformation` returns a promise that never settles; `rememberPlatform` resolves |
| `the platform notice logs a rejected notice or state update` | each rejection gives one `warn` line and no unhandled rejection |
| `a notice record line carries its buttons` | scripted adapters: `buttons` as passed |

remote-ssh stays at 100/100/100.

## 4. Acceptance rows (`suite-platform`, coverage-12's cases)

Add `notice` entries to these cases' scripts. `match` is `You selected`, and `answer` is `dismiss` unless the table says
otherwise. Then add the rows below. The full message is `M(linux)`.

| Case | Notice expected | Row name | Assertion |
|---|---|---|---|
| `platform-pick-linux` | yes | `F-2206 AC-6 (platform-pick-linux): the notice says linux, with one Don't Show Again button` | one `notice` line, question `M(linux)`, `buttons` `["Don't Show Again"]` |
| `platform-pick-macos` | yes | `F-2206 AC-7 (platform-pick-macos): the notice says linux` | question `M(linux)` |
| `platform-wildcard-linux` | yes | `F-2206 AC-13 (platform-wildcard-linux): the notice appears` | one `notice` line, `M(linux)` |
| `platform-exact-macos` | yes | `F-2206 AC-14 (platform-exact-macos): the notice appears` | the same |
| `platform-typed-user` | yes | `F-2206 AC-24 (platform-typed-user): the notice appears` | the same |
| `platform-broken-settings` | yes | `F-2206 AC-36 (platform-broken-settings): the notice still appears, and no other notice` | exactly one `notice` line, `M(linux)` |
| `platform-exact-linux` | no | `F-2206 AC-8 (platform-exact-linux): no notice` | no `notice` line |
| `platform-out-of-enum-*` | yes | (none: these cases only need the entry answered) | — |

Two new cases go **last** in `cases.json`, in this order. The flag stays in the run's user-data folder for every
later launch, so no case that expects a notice may follow them:

| Label | Mode | Folder authority | Script | Row |
|---|---|---|---|---|
| `platform-dont-show-again` | terminal | `harness` | `platformPick` → `linux`; `notice` `You selected` → `{button: "Don't Show Again"}` | `F-2206 AC-25 (platform-dont-show-again): Don't Show Again is taken`: the `notice` line's answer |
| `platform-suppressed` | terminal | `second` (no entry) | `platformPick` → `linux` | `F-2206 AC-25 (platform-suppressed): another host's entry is written and no notice appears`: `{"second": "linux"}` in settings.json, and no `notice` line. The new launch is AC-25's "after a restart" |

**Catalogue:** F-2206 AC-6, 7, 13, 14, 24, 25 and 36 go to `acceptance` in `coverage-slice1.tsv`. AC-8 stays `todo`
with tooling-20, for its reload half. In #142's tracking comment, list these under "Core halves": the notice's
auto-hide, its source, the notification centre, and the notice closing on Don't Show Again.

## 5. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with coverage-12's cases plus the two new ones.
Paste the `suite-platform` summaries. If the editor does something other than the table says, report it on the issue
and leave the table as it is.

## 6. Review

PR title `remote-ssh: the platform notice and Don't Show Again (card connect-25, #554)`. themis or triton reviews;
athena checks the notice port's use and the state key.
