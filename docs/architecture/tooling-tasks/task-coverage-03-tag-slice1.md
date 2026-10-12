# Task card coverage-03: tag slice 1's acceptance criteria, and name the unit rows that prove them (#142)

Why: athena's ruling on #142, items 1–3. coverage-01 (#463, PR #467) seeds
`docs/architecture/catalogue/coverage-slice1.tsv` with all 602 slice-1 ACs tagged `todo` and adds `pnpm check-coverage`.
This card moves every AC it can from `todo` to its tag, keeps the check passing, and lists the rest with the row each one
still needs. Those lists become the row cards of #141 and #142. Two halves, one builder each:

| Half | Issue | Features (spec issue in `remote-oss/remote-ssh`) | ACs |
|---|---|---|---|
| A | #473 | F-2001 (#11), F-2101 (#19), F-2102 (#20), F-2201 (#28), F-2202 (#29), F-2206 (#33), F-2301 (#34), F-2304 (#37) | 283 |
| B | #474 | F-2305 (#38), F-2306 (#39), F-2307 (#40), F-2401 (#46), F-2403 (#48), F-2409 (#54), F-2501 (#59), F-2502 (#60), F-2601 (#68), F-3902 (#79) | 321 |

Each half touches only its own features' lines of the TSV, so the two PRs merge in either order.

The counts are the TSV's on 2026-10-12, after `remote-oss/remote-ssh#79` added F-3902.AC-24 and AC-25 at 21:56Z: 604 in
all. coverage-04 (#478) removes the two ACs the spec withdrew, F-2304.AC-26 (half A) and F-2403.AC-20 (half B). The spec
can change again: a half covers every line of its features that the TSV holds when its PR opens, whatever the count.

**Depends on coverage-01 (PR #467).** Start on its branch `feature/coverage-01`; rebase on main once it merges, and open
the PR after that.

## 1. Files

| File | Change |
|---|---|
| `docs/architecture/catalogue/coverage-slice1.tsv` | your features' lines: `todo` to a tag, where section 3 allows it |
| `packages/*/test/unit/**/*.test.ts` | renamed `it` names only (section 4); no other change to a test |
| `tests/acceptance/**/*.test.ts` | renamed `it` names only, the same way |

No code, no new test, no change to an assertion. A row this card would need to write goes in the PR's list (section 5).

## 2. Choosing an AC's tag

Read each AC in its spec issue (`gh issue view <n> -R remote-oss/remote-ssh`). Take the **first** rule that matches:

1. **`deferred`**: the AC can only be shown on a platform 0.2 doesn't run. Reason, verbatim, one of:
   - `D-60: Windows client`;
   - `D-60: macOS client`;
   - `build order slice 1: Linux hosts only` (the AC needs a Windows or macOS host).
2. **`core`**: everything the AC requires is shown by VS Code core, and the extension API can't read it: the window
   title, the status-bar remote indicator, Open Recent, a modal's button order or rendering, the progress notification's
   look, core's workspace-trust dialog. Reason: `core: <what core shows>`, for example `core: the remote indicator's text`.

   Core means core alone decides what is shown. When our extension supplies the content core shows (a message's text,
   the buttons we pass, a label, a progress message), that content is in the scripted adapters' record, so the AC takes
   rule 3 for it, and only the rendering goes in "Core halves".
3. **`acceptance`**: the AC's outcome can be seen by the harness (`tests/acceptance/README.md`):
   - the test extension's view through the API (the resolved authority, workspace folders, the remote file system,
     commands, settings, context keys);
   - the scripted adapters' record (the text of each question, dialog and pick, and the answer);
   - the extension's log, which the tests can read;
   - the host's state through `overSsh` or `onHost` (files, processes);
   - a failure window of `suite-failure/cases.json`.

   The harness today sets up: the host image, its `ssh_config` aliases (`harness`, `refused`, `nowhere`, `stranger`),
   the real-server and VSCodium runs, and tooling-14's host variants (#446: login shells, `curl`, GNU and BusyBox
   `wget`, no downloader). An outcome the harness could see under a condition it can't set up yet is still
   `acceptance` in kind: list it in section 5's "harness capability missing" table, never as a unit row.
4. **`unit`**: everything else. Our own decision, with no host or editor needed: parsing, planning, a string's choice,
   a bound, a retry decision, an error path the harness can't provoke.

   An AC that states what our code decides from its inputs (which settings entry matches, which value wins, how a name
   is encoded or parsed, a manifest value) is `unit` once a unit row proves it on the AC's case, even when a harness run
   could also show it. Each such decision still needs one acceptance row of its feature that runs it end to end in some
   case (its wiring). If there is none, list one line `<feature> wiring: <decision>` under "Needs an acceptance row",
   once per decision, not once per AC.

Two cases the rules settle:
- **An AC with an observable part and a core part** (F-2405 AC-9's two halves, #406) takes the observable part's tag
  (`acceptance`), and the core part goes in the PR's list under "core halves".
- **`recorded`** is not used in this card. D-65's recorded set is chosen with the kit at QA.

## 3. What goes into the TSV now

The check fails on an `acceptance` or `unit` tag that no row cites (coverage-01 rules 3 and 4), so:

| Tag from section 2 | Write it in the TSV when | Otherwise |
|---|---|---|
| `deferred`, `core` | always, with the reason | — |
| `unit` | a unit or acceptance row cites the AC, after section 4's renames | leave `todo`, list it |
| `acceptance` | an acceptance row (or a `cases.json` `cite`) cites the AC | leave `todo`, list it |

The six ACs of F-2601 that acceptance rows already cite (AC-1, 3, 6, 9, 12, 13) are `acceptance` unless section 2
says otherwise.

## 4. Renaming rows to cite the AC they prove

Measured at main 78e461f: 491 unit rows name a slice-1 feature without an AC (`F-2502: a folder …`). When a row's
one assertion checks what an AC states, for the case the AC states, rename it so its name starts with the AC:

- `F-2502: a folder in the current window …` becomes `F-2502 AC-4: a folder in the current window …`;
- a row that proves two ACs: `F-2601 AC-1, AC-3: …`;
- a BR or section cite moves after the colon: `F-2306 BR-2: …` becomes `F-2306 AC-7: BR-2, …`.

The cite pattern is coverage-01's: the feature, a space or a dot, `AC-<n>`, an optional `, AC-<m>` list, then the colon.
Don't rename a row that checks only part of what the AC states. List the AC instead, naming that row as partial
proof. A rename keeps the rest of the name as it is, and the row's place, assertion and body untouched.

## 5. The PR's list

The PR body has one table per tag still to write, for your features. Every AC still `todo` appears exactly once:

```
### Needs an acceptance row
| AC | What the row must show | Rows that prove part of it now |
|---|---|---|
| F-2304.AC-5 | the host's server folder holds … after a connect | `F-2304: …` (unit, partial) |

### Needs an acceptance row: harness capability missing
| AC | What the row must show | Missing capability | Rows that prove part of it now |
|---|---|---|---|
| F-2102.AC-8 | both windows reconnect after Kill and one password is asked | `password host`, `two windows` | none |

### Needs a unit row
| AC | What the row must show | Rows that prove part of it now |

### Core halves
| AC | The part core shows |
```

In the "harness capability missing" table, name the capability in a few words: `password host`, `two windows`,
`window reload`, `network cut`, `terminal mode`. "Needs a unit row" holds only what rule 4 describes: our own decision,
testable with no host or editor.

"What the row must show" is one sentence in the AC's own terms: the case and the expected outcome. When nothing proves
any part, write `none`.

## 6. Done when

- every AC of your features is either tagged in the TSV or in exactly one table of the PR body;
- `pnpm check-coverage` passes, and its report shows your counts (paste the per-tag counts in the PR body);
- `pnpm lint`, `pnpm test` and the coverage ratchets pass (renames change no coverage);
- no file outside section 1's changes.

## 7. Review

PR title `docs: tag slice 1's acceptance criteria, <features> (card coverage-03<a|b>, #142)`. athena checks the tags
(the design call); themis or triton checks the renames. A tag athena changes in review is changed in the PR, not
argued in a follow-up.

## 8. Open rows

- None for the builder. A spec AC that reads two ways is listed in the PR body under "Unclear ACs" with both readings.
  daedalus asks it on the spec issue, and the AC stays `todo`.
