# Task card coverage-25b: the eight recorded gate rows of explorer slice 1

Issue: #645. Release 0.3 (#43), explorer slice 1, item S8, part b. Why: slice 1 ships when the eight rows of the brief's
"The slice-1 gate" (`docs/architecture/l3/windows-and-explorer/brief-remote-explorer.md`, ruled 233e3b7) pass in the
VSCodium run, with `check-coverage` green and proteus's manual check. This card writes those rows. Builder: selene.
Size: about 1.5 agent-days.

**Depends on** (all merged before the builder starts):
- explorer-03a/b/c (#629–#631), explorer-04 (#640), explorer-05 (#641) and ssh-provider-01 (#635);
- tooling-30 (#633) and coverage-25a (#644);
- tooling-28 (#609): window claims, so an empty window is `local`, `empty-1`, `empty-2` in claim order;
- for row 7, nothing more: the run writes the reference stand-in for its launch before the editor starts (the
  launch-level `standIns` of `tools/acceptance-launches.ts`, as `containers-standdown` uses it; amended 2026-10-19,
  replacing the stand-in written while the editor runs).

## 1. Where the rows live

| Launch | File | Rows |
|---|---|---|
| `explorer` | `tests/acceptance/explorer/gate.test.ts` | 1, 2, 3, 4, 5, in this order |
| `explorer-standdown` | `tests/acceptance/explorer-standdown/gate.test.ts` | 7 |
| `explorer-alone` | `tests/acceptance/explorer-alone/gate.test.ts` | 6 |
| `explorer-no-proposals` | `tests/acceptance/explorer-no-proposals/gate.test.ts` | 8 |

**The stand-down launch (row 7).** Add it to `tools/acceptance-launches.ts`, right after `explorer-no-proposals`:

```ts
{
  ...EXPLORER_LAUNCH,
  label: 'explorer-standdown',
  suite: 'explorer-standdown',
  standIns: ['ms-vscode.remote-explorer'],
},
```

The run writes the stand-in into this launch's own extensions folder before the editor starts (`writeStandIns` in
`tools/acceptance-plain.ts`), so the explorer meets it at its first activation. Add a row to
`tools/acceptance-launches.test.ts` beside the `containers-standdown` one: the launch exists, installs Remote
Explorer, and has exactly that stand-in. The suite folder `tests/acceptance/explorer-standdown/` gets the
`tsconfig.json` of `tests/acceptance/explorer-alone/`, unchanged.

**Helpers** come from `windows/harness.ts` (`inWindow`, `windowEvents`, `windowState`, `recordLines`, `closeWindow`,
`onHost`) and `windows/renderer.ts` (`viewRows`, `rowAction`, `titleAction`, `notifications`).

**Constants:**
- `VIEW` = `Remotes (Tunnels/SSH)`, the view's name (F-5101 3.3);
- `NEW` = `Connect in New Window...`, `CURRENT` = `Connect in Current Window...`, `REFRESH` = `Refresh` (F-5002 3.1);
- `HOSTS`: the run's `ssh_config` (`<HARNESS_RUN_FOLDER>/ssh_config`) read when the file's tests start. Each word of a
  `Host` line without `*`, `?` or `!`, in file order, keeping each word's first occurrence. This is the same rule as
  coverage-14's host pick.

**Showing the view:** before reading a window's view, `inWindow(<window>, 'remoteTargets.focus')`. A row that reads
the view waits for it: it polls `viewRows` every 200 ms for at most 15 s until the rows are as expected, then asserts
once. That covers the build and its 10 s limit.

**"Nothing fails"** means three things for a window:
- `notifications(<window>)` holds no text that contains `Error`, `error`, `not found` or `failed`;
- there's no record line with surface `notice` from that window;
- no `failed` agent event for a command the row ran, except where the row expects one.

## 2. The rows

Each row's `it` name starts with its cites, then a colon. The criteria cited are the ones the brief names for the
row, each with its AC number, taken from the issue when you write the row. If a criterion the brief names has no AC
that says what the row checks, write the row with the feature's closest AC and list the choice in the PR.

| # | Launch | Steps | Assertions | Cites (from the brief) |
|---|---|---|---|---|
| 1 | `explorer` | in `local`, show the view | `viewRows('local', VIEW)`: the first row is `{label: 'SSH', level: 1, expanded: true}`; the rest are `HOSTS` in order, each at level 2 with `description` `''`; nothing fails | F-5101 (the SSH group), F-5102 (host list, order) |
| 2 | `explorer` | `rowAction('local', VIEW, 'harness', NEW)` | a window `empty-1` activates within 60 s (its claim, tooling-28); `windowState('empty-1').remoteName` is `ssh-remote`; `inWindow('empty-1', 'acceptance.agent.writeFile', 'gate-probe', 'x')` writes `/home/harness/gate-probe` (`onHost('cat', ...)`) and `windowState('local').remoteName` is `null`; nothing fails in `local`. Then `closeWindow('empty-1')` | F-5103 (connect in a new window) |
| 3 | `explorer` | `rowAction('local', VIEW, 'harness', CURRENT)` | the window `local` deactivates, and the reloaded window activates within 60 s as `empty-2` (a claim stays for the launch's life, so the reload takes the next free name) with `remoteName` `ssh-remote`; the probe file write works as in row 2 | F-5103 (connect in the current window) |
| 4 | `explorer` | in `empty-2`, show the view | the `harness` row's `description` is `connected`; every other host row's is `''`; nothing fails | F-5103 BR-6 and its AC (the marker), F-5902 (the pull decides) |
| 5 | `explorer` | append `Host gate-added` + `  HostName 127.0.0.1` to the run's `ssh_config` (keep the file's bytes so you can restore them); `titleAction('empty-2', VIEW, REFRESH)` | the rows are row 1's with `gate-added` last among the hosts, and `harness` still marked; nothing fails. Restore the file in a `finally`, then click Refresh again and see `gate-added` gone | F-5101 (Refresh), F-5102 (host list) |
| 6 | `explorer-alone` | in `local`, show the view; click `REFRESH` | `viewRows('local', VIEW)` is `[]` before and after; nothing fails (F-5902's absent-companion state: no group, no message) | F-5101 7.E1 and its AC, F-5902 AC-2 |
| 7 | `explorer-standdown` | in `local`, show the view, and run `inWindow('local', 'remote-explorer.refresh')` | the coexistence warning is among `notifications('local')` (F-5001 3.4, with athena's ruling on #636 that it names no Microsoft id: take the text from explorer-03b's card); `viewRows('local', VIEW)` has no `SSH` row; the refresh command fails with `not found` (nothing registered) | F-5001 (stand-down), F-5901 (coexistence) |
| 8 | `explorer-no-proposals` | in `local`, run `inWindow('local', 'remote-explorer.refresh')` and `inWindow('local', 'opensshremotes.openEmptyWindow', {host: 'harness'})`, waiting for each to finish or fail | `viewRows('local', VIEW)` is `undefined` (core drops the view without `contribViewsRemote`); at most one setup notice of the family in the record (surface `notice`, the setup text of F-1403 as connect-31 writes it), and none from the explorer itself; `notifications('local')` has no error. The family notice covers the explorer: explorer-03b's `familySetupPortsOf` lists `remote-oss.remote-explorer` among the ids the notice offers. Read where that list reaches the record (03b's card and connect-31's), and assert it | F-3903 (the family gate), F-5001 |

**If a row fails because the product does something else, don't change the row: report it on #645.** These are
the release gate's rows.

## 3. The recorded set

These eight rows are the slice-1 recorded gate, like 0.2's D-65 rows. Their criteria get the tag `recorded` in
coverage-25c. Name each row's `it` exactly as in §2 and list the eight names in the PR, so that coverage-25c and the
kit's recording can find them.

## 4. Gates and review

All gates and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` with every launch green. Paste the summary
of the four explorer launches. PR title `tests: the eight gate rows of explorer slice 1 (card coverage-25b, #645)`.
themis or triton reviews; athena checks that the rows are the brief's. proteus then makes the manual check on the
built VSIX (open the Remote Explorer, see the hosts, connect from a row).

## 5. Open rows (stop and report on #645)

1. Row 7's window shows no coexistence warning, or the explorer registers its commands beside the stand-in: report
   what the record and the window show.
2. Row 8's family notice doesn't name the explorer anywhere observable: report what the record shows.
3. A host of `HOSTS` that the view doesn't list, or lists elsewhere: report both lists.
