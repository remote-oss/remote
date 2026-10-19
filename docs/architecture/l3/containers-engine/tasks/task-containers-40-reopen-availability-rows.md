# Task card containers-40: F-0401's availability rules, its connecting toast and its Docker-unavailable cite

Issue: #1044. Milestone 0.4, containers release 1. Size: S. Builder: `task:local`. Every change and every row is spelled
out below. The expected values of part B were measured on main (4984f4c5) with the pinned CLI and Docker 29 on
2026-10-19. If something on main does not match this card, stop and report it on the card's issue (§5).

**Build after** #1046 (the connect progress shows each stage once) is on main; part B's row fails without it.

**What this card is:** tests only (one unit file, one acceptance file, one title edit, the catalogue lines). No product
code changes. Don't change the product or an expected value.

Sources: F-0401 (remote-oss/remote-containers#21): 3.3, 5.0 steps 1–6, 7.E2, 7.E4, AC-1, AC-2, AC-4, AC-6, AC-13,
AC-18; F-0201 7.E1.

## 1. Part A: where the command is available (unit)

New file `packages/remote-containers/test/unit/reopen-availability.test.ts`. `describe('F-0401 availability of
Reopen in Container (card containers-40)')`.

It reads the `when` clause of the command `remote-containers.reopenInContainer` in `package.json`'s
`contributes.menus.commandPalette` and in `contributes.menus['statusBar/remoteIndicator']` (read the file as
`manifest.test.ts` does, with `readFileSync`; take the entry whose `command` is that id, and fail if there is not
exactly one in each menu), and evaluates it against a context with this private helper:

```ts
/** Whether `clause` holds in `context`: the terms are joined by ` && `; a term is `!name` or `name != number`. Any other term throws. */
function holds(clause: string, context: Readonly<Record<string, boolean | number | string>>): boolean;
```

- `!name` holds when `context[name]` is missing, `false`, `0` or `''`.
- `name != number` holds when `String(context[name]) !== String(number)`.
- A term of any other form throws `unsupported term: <term>`, so a clause that changes shape fails loudly here.

The base context is `{hideConnectCommands: false, workspaceFolderCount: 1, virtualWorkspace: false,
'remote-containers:standingDown': false}`; a row overrides what it lists. A missing `remoteName` is the local window.

| # | Name | Context | Expected (palette, indicator) |
|---|---|---|---|
| A1 | `F-0401 AC-1 (a1): a local window with one folder gets the command in the palette and the indicator` | the base | `true`, `true` |
| A2 | `F-0401 AC-4 (a2): a connected dev container window with its folder does not list the command` | base + `remoteName: 'dev-container'` | `false`, `false` |
| A3 | `F-0401 AC-6 (a3): a dev container window that is not a recovery container does not list the command` | the same as A2 | `false`, `false` |
| A4 | `F-0401 AC-18 (a4): a dev container window with no folder open does not list the command` | base + `workspaceFolderCount: 0` + `remoteName` | `false`, `false` |
| A5 | `F-0401 AC-1 (a5): an empty window, a virtual workspace, a standing-down extension and hidden connect commands do not list it` | four contexts, each the base with one change: `workspaceFolderCount: 0`; `virtualWorkspace: true`; `'remote-containers:standingDown': true`; `hideConnectCommands: true` | `false`, `false` for each |

A3 is the same context as A2; it is its own row so that each criterion has a row that cites it. A3 covers only the
"absent" half of AC-6; "Reopen Folder Locally is present" belongs to a command this release does not contribute, and
the catalogue keeps that half out of this card.

One more row, for `holds`'s own branch, named `F-0401 AC-1: holds throws on a term it does not know`:
`holds('a == 1', {})` throws `unsupported term: a == 1`. (`check-coverage` reads names that start with a criterion.)

## 2. Part B: the connecting toast and the window's title and indicator (acceptance)

New file `tests/acceptance/containers/reopen-command.test.ts`, `describe('F-0401 the reopen command (card
containers-40)')`, `this.timeout(600_000)`. Use the helpers of `tests/acceptance/windows/` that
`tests/acceptance/containers/gate.test.ts` imports (`devContainerFolder`, `reopenInContainer`, `closeWindow`,
`windowState`, `devContainersOf`, `openFolderWindow`, `removeContainers`, `notifications`, `statusItem`, `windowTitle`); write no helper
that duplicates one.

One row:

`F-0401 AC-1, AC-2 (b1): the connect shows one "Connecting to Dev Container (show log)" toast that never doubles, and the window ends titled and labelled with the container's name`

Setup: `devContainerFolder('c40-reopen', {name: 'Reopen One'})`, `openFolderWindow(folder)`.

While `reopenInContainer(name)` runs, sample the window every 150 ms until it returns (a loop started before it,
stopped after it, each sample in a `try`, a failed sample skipped because the window is reloading):

```ts
{texts: await notifications(name), title: await windowTitle(name), indicator: (await statusItem(name, 'status.host')).text}
```

Collect the samples. Assertions:

1. **A toast was seen.** At least one sample has a text that starts with `Connecting to Dev Container`.
2. **Never two.** No sample has more than one text that starts with `Connecting to Dev Container`.
3. **Each text is one of three, exactly, so the link never doubles.** Every text that starts with `Connecting to Dev
   Container` is one of `Connecting to Dev Container (show log)`, `Connecting to Dev Container (show log): Installing
   server` and `Connecting to Dev Container (show log): Starting server` (F-0408 §5, BR-2; F-0503 AC-2).
4. **The end state.** After `reopenInContainer` returns, take one more sample: `title` is `[c40-reopen [Dev Container:
   Reopen One]]`, `indicator` is `Dev Container: Reopen One`, `texts` has no text that starts with `Connecting`, and
   `devContainersOf(folder)` has one id.

`console.log` the distinct texts seen (`JSON.stringify([...new Set(texts)])`), one line, starting `containers-40 b1:`.
Close the window and `removeContainers(folder)` in `finally`.

**What was measured** on the branch of #1046 (a warm engine, the image present, the server cached; the connect takes
about 5 s): the toast texts were `Connecting to Dev Container (show log)`, then `Connecting to Dev Container (show
log): Starting server`; then none. `Installing server` shows only when the server is not cached. The title was
`[c40-reopen]` while the toasts showed and `[c40-reopen [Dev Container: Reopen One]]` after, and the indicator was
`Opening Remote...` throughout the connect and `Dev Container: Reopen One` at the end. Before #1046 the texts were
`Connecting to Dev Container (show log): Connecting to Dev Container (show log)`, and assertion 3 fails on them: that
is the defect athena ruled on (the stage text is the message; core joins it to the start title), and #1046 fixes it.

Don't assert the intermediate samples' titles or indicators, only the end state: how many samples fall in each stage
depends on timing.

## 3. Part C: F-0401 AC-13 cites the pre-flight row

`tests/acceptance/containers/gate.test.ts`, the row `F-0201 AC-2 (gate-row-8): …`. It shows F-0201's dialog for a
missing `docker` before any reload, asserts that no container or volume appears and that `remoteName` stays `null`,
and that is F-0401 AC-13. Change only the start of its title to `F-0201 AC-2, F-0401 AC-13 (gate-row-8): `. Nothing
else in the row changes.

## 4. The catalogue (`coverage-containers-r1.tsv`)

- F-0401 AC-4, AC-6, AC-18: `unit`. AC-1, AC-2: `acceptance` (part B; A1 and A5 are their unit side, and
  `check-coverage` takes the strongest tag the file names). AC-13: `acceptance`.
- Run `node tools/check-coverage.ts` and fix any line it names. If it asks for a different tag for an AC, follow it
  and say so in the PR.
- F-0401 AC-6's second half stays out; say so in the PR in one line.

## 5. Gates, review and open rows

Run all gates; part A at 100 % branch coverage of its own helper (every branch of `holds` has a row); then the
`containers` launch locally (`docker ps` first; remove your own leftovers after). PR title: `tests: F-0401's
availability rules, connecting toast and pre-flight cite (card containers-40, #1044)`. Request athena only; hermes
assigns the peer.

**Open rows (stop and report on the issue, with the row's output):**
1. A `when` clause on main has a term other than `!name` and `name != 0` (A-rows throw).
2. B1 shows a text starting `Connecting` that is not one of the three of assertion 3, or two such texts in one sample,
   or no such text at all, with #1046 on main.
3. B1's end title or indicator differs from §2 assertion 4.
