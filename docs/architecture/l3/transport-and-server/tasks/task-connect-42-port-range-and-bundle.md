# Task card connect-42: a full preferred port range shows S095, and every translated string is in the bundle

Issue: #680. Release 0.2. **Part A (the busy port range) gates 0.2**: F-2104 is a 0.2 P0 row, and AC-14's dialog has
no reason on main (athena, register 1440a86). **Part B (the bundle keys) doesn't gate, but ships with it.** Size: S–M
(about 1.5 agent-days). Builder: assigned by hermes. Found by the
unwired-contribution audit (2026-10-13).

## 1. Part A: a full port range (F-2104 7.E1, remote-oss/remote-ssh#22)

**The defect:**
- `chooseLocalPort` (`packages/remote-ssh/src/connect-ports.ts`) returns `undefined` when `findFreePort` finds no free
  port.
- The tunnel step (`pipeline/tunnel-step.ts`, both paths) then fails with `NOT_OPENED` (kind `unknown`, no reason).
  The CLI bridge (`pipeline/wiring.ts`, `openBridge`) returns `undefined`.
- The dialog names only the host.

**What F-2104 7.E1 and AC-14 require when every port of the configured range is busy:**
- the reason S031 → S067 → S073 → S095, i.e. `Could not establish connection to "<host>": Error establishing tunnel
  (Failed to find a free local port: No free ports in specified range '<start>-<end>'.  Remove or update the
  'Preferred Local Port Range' setting and try again.).`;
- the table's text keeps two spaces after `'<start>-<end>'.`, as S095 does today;
- the buttons Retry, More Actions… and Close Remote.

S073 and S095 are in `surfaces/failure-strings.ts` today, but nothing references them.

**The rules:**
- **A1.** `chooseLocalPort` returns `{port: number} | {busyRange: PortRange} | {noPort: true}`:
  - `busyRange` when a configured range was searched and had no free port;
  - `noPort` when there was no range, or an ignored one, and the random search found nothing.

  The port's users take this type (`TunnelStepDependencies.chooseLocalPort`, `CliWiring.chooseLocalPort`).
- **A2.** For `busyRange`, the tunnel step, on both of its paths, fails with
  `{kind: 'unknown', reason: {id: 'S067', values: [{id: 'S073', values: [{id: 'S095', values: [<first>, <last>]}]}]}}`.
  The values are decimal strings, and the nesting is the one `MAX_WAIT_EXHAUSTED` already uses. For `noPort` it stays
  `NOT_OPENED`: 7.E9's OS-error text is `[inferred]` in the spec and stays out.
- **A3. On the CLI path a busy range is final** (athena, register 1440a86). A fall-back would install a server and
  then fail on the same range.
  - `openBridge` (`pipeline/wiring.ts`), given `busyRange`, returns `{busyRange}` instead of `undefined`.
    `steps.ts`'s `openBridge` type gains that answer.
  - `connectOverCli` (`cli/cli-connect.ts`) answers it with `abandon()`, then
    `{kind: 'failed', failure: <A2's failure>}`, not `{kind: 'fallback'}`.
  - A bridge that can't open for any other reason stays a fall-back, as today.

**Rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2104 7.E1 | `chooseLocalPort` over a prober that finds the range `41060-41061` all busy | `{busyRange: {first: 41060, last: 41061}}` |
| F-2104 7.E1 | the same with no range set and the random search failing | `{noPort: true}` |
| F-2104.AC-14 | the tunnel step's socks path with `busyRange` 41060–41061 | the failure has A2's reason, values `'41060'`, `'41061'` |
| F-2104.AC-14 | the secondSsh path, the same | the same reason |
| F-2104.AC-14 | the connect (`connect.test.ts`) on the CLI path with `openBridge` answering `{busyRange: {first: 41060, last: 41061}}` | the connect fails with A2's reason; `plan(…, {direct: true})`, `transfer` and `start` were never called (no direct install) |
| F-2104 7.E1 | `reasonText` of A2's reason (`failure-strings.test.ts`) | `Error establishing tunnel (Failed to find a free local port: No free ports in specified range '41060-41061'.  Remove or update the 'Preferred Local Port Range' setting and try again.).`, with the two spaces kept |

**Acceptance row** (VSCodium; a failing connect in `tests/acceptance/suite-failure/cases.json`):
- **The case:** label `port-range-busy`, alias `harness`, settings `{'remote.SSH.preferredLocalPortRange': '1-2'}`.
  Ports 1 and 2 can't be bound without root, so every port of the range is busy for the editor;
- **the dialog:** `Could not establish connection to "harness": Error establishing tunnel (Failed to find a free local
  port: No free ports in specified range '1-2'. Remove or update the 'Preferred Local Port Range' setting and try
  again.).`;
- **the cite:** `F-2104 AC-14`;
- **the guard:** the case's suite row first checks that the run isn't root (`process.getuid?.() !== 0`), and fails with
  "the port-range case needs a non-root run" otherwise;
- **it must fail on main**, where the dialog has no reason.

Measure first how the record shows the dialog's text: one space or two after `'1-2'.`, since the dialog may collapse
them. Write the case with what the record holds.

## 2. Part B: every translated string is in the bundle

**The defect:** 10 strings the code translates at run time are missing from `packages/remote-ssh/l10n/bundle.l10n.json`
and the 14 locale bundles, so no translation can ever reach them:
- `surfaces/prompt-strings.ts`'s `PROMPT_TEMPLATES`: S001, S012, S013, S028, S064, S065, S066;
- `surfaces/failure-strings.ts`'s `FAILURE_TEMPLATES`: S024, S127, S167.

`pnpm check-string-tables` passes, because it compares bundles with bundles, never with the code.

**The rules:**
- **B1.** Add the 10 templates, as written in the tables, to the default bundle and to each locale bundle (English, as
  the other keys are), keeping the file's order convention (appended at the end).
- **B2.** `tools/string-tables.ts` gains a rule, for a package with `l10n/`: every string the code translates is a key
  of `l10n/bundle.l10n.json`. "Translated" is read with the TypeScript parser from `packages/<x>/src/**/*.ts`, tests
  excluded:
  - every string-literal property value of a top-level `const` whose name ends in `_TEMPLATES`;
  - the string-literal first argument of `l10n.t(...)` (any receiver), and an identifier argument there that names a
    same-file `const` with a string-literal initializer;
  - the same for a call of a same-file function named `translate` (a wrapper over `l10n.t`, as remote-explorer's
    `extension.ts` translates `STAND_DOWN_WARNING` and `STAND_DOWN_BUTTON`);
  - the string-literal second argument of `filled(...)`.

  A miss is a problem: `<package>/<file>:<line>: "<text>" is translated but not a key of l10n/bundle.l10n.json`.
- **B3.** The other direction (a bundle key the code never uses) isn't added: tooling-31 (#674) owns "declared but
  never consumed" for contributions, and l10n keys stay here. Note it in the PR as a possible later rule. Don't build
  it.

**Rows** (`tools/string-tables.test.ts`, temporary workspaces as the file's other rows):
- a `FOO_TEMPLATES` value missing from the bundle → one problem naming the file and line;
- a `l10n.t('x')` literal missing → a problem;
- `translate(WARNING)`, where `translate` is a same-file function and `const WARNING = 'w'` with `w` missing → a
  problem;
- `l10n.t(WARNING)` with `const WARNING = 'w'` in the same file and `w` missing → a problem;
- `filled(translate, 'y {0}', [])` missing → a problem;
- all present → no problem;
- a test file's literal → ignored;
- a package without `l10n/` → ignored;
- on the repository after B1: no problem.

## 3. Gates and review

All gates, the changed files at 100 %, `check-string-tables`, and the VSCodium run green. PR title `remote-ssh, tools: a
full preferred port range shows S095, and every translated string is in the bundle (card connect-42, #680)`. themis or
triton reviews; athena gives the design check of A1–A3 and B2.

## 4. Open rows (stop and report on #680)

1. The run is root in CI, so ports 1–2 are free. Report it, and don't choose another range by guess.
2. B2 finds strings beyond the audit's 10 on main. List them in the PR and add them under B1, since they are the same
   defect.
