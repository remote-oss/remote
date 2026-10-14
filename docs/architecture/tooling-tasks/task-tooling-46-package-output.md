# Task card tooling-46: a styled `pnpm package` output on a terminal, the plain lines everywhere else

Issue: #824. Not gating; R-99 (tools only, nothing under `packages/*/src`). Approved by the user through hermes.
Size: S–M. Builder: selene (`task:local`), after her gating cards.

## 1. The goal

**On a terminal:** `pnpm package` shows the user's reference layout (§4): a title box, three numbered phases
(identifiers, build, package), the skipped packages folded into one dim list, the bundles grouped per package, the
`.vsix` files with their real sizes and a bar, real timings, and a closing box.

**Everywhere else** (CI, a pipe, a log file, `NO_COLOR`'s plain sibling, the `--plain` flag): exactly today's lines, in
today's order, byte for byte:

```
identifiers: remote-containers: src/identifiers.generated.ts
…
build: lib-authority: no src/extension.ts, skipped
…
package: remote-ssh: dist/remote-ssh-0.1.0.vsix
```

The tools tests and every log grep rely on those lines.

**Not ours to restyle:** pnpm's own lines above our output (the lockfile check, the update notice, `Done in …`).

## 2. Files

| File | Change |
|---|---|
| `tools/package-run.ts` | **new.** The orchestrator, `runPackage(root, phases, out)`, and its `isMainModule` entry |
| `tools/package-view.ts` | **new, pure.** `renderPackageRun(run, style): string`, plus `displayWidth`, `parseOutcome`, `formatTiming`, `sizeBar` and `chooseMode` |
| `tools/package-run.test.ts`, `tools/package-view.test.ts` | **new.** The rows of §6 |
| `package.json` | `"package": "node tools/package-run.ts"`. `"build"` and `"identifiers"` don't change |
| `knip.jsonc` | add `tools/package-run.ts` as an entry, the way the other tools are listed |

`tools/identifiers.ts`, `tools/build.ts` and `tools/package-extensions.ts` keep their exports, their behaviour and
their own entries unchanged. `pnpm build` still prints the plain lines from those two processes.

**No new dependency.** Colours are a hand-written ANSI table in `package-view.ts` (§4.3). That needs no licence review,
and it isn't `picocolors`.

## 3. The orchestrator (`package-run.ts`)

`runPackage(root, phases, out)`:
- `phases` is `{identifiers(root): Promise<string[]>; build(root): Promise<string[]>; package(root, folders: readonly string[]): string[]; size(file): number}`.
  The real values are `generateTables`, `buildPackages(root, [])`, `packageExtensions(root, folders)` and
  `statSync(file).size`. Tests pass fakes.
- **The arguments** (dike on #825). `pnpm package remote-explorer` works today: pnpm appends the arguments to the
  script's last command, `node tools/package-extensions.ts`, so they name the folders to package. Several cards'
  gates use it (containers-01, explorer-03b, -03c and -04). So:
  - every argument after the script name that doesn't start with `--` is a folder for the package phase;
  - `--plain` (§4.1) isn't a folder, and neither is any other `--` argument;
  - the build phase keeps `[]`, as today: it builds every package, and only packaging is narrowed.
- `out` is `{write(text: string): void; isTerminal: boolean; environment: Readonly<Record<string, string | undefined>>; argv: readonly string[]}`.
  The real values are `process.stdout.write`, `process.stdout.isTTY === true`, `process.env` and `process.argv`.
- It runs the three phases **in order, in this one process**, and times each one with `performance.now()`, in
  milliseconds.
- It reads each `.vsix`'s size from the package phase's outcomes (`<folder>: <path>`, the path relative to `root`).
- **Mode** (`chooseMode`, §4.1):
  - `plain`: write each phase's lines **as soon as that phase ends**: `identifiers: <o>\n` for each outcome after the
    identifiers phase, then `build: <o>\n` after the build phase, then `package: <o>\n` after the package phase. These
    are exactly today's lines, at today's moments, so a failing build still shows the `identifiers:` lines first;
  - `styled` or `styled-mono`: write `renderPackageRun(run, style)` once, at the end.
- **On an error in a phase:**
  - `plain` writes `<phase>: <message>` to stderr, as each tool does today;
  - the styled modes write the phases finished so far, then `  ✖ <phase>: <message>` (red in `styled`).
  - Either way it sets `process.exitCode = 1`, and runs no later phase.

## 4. The view (`package-view.ts`, pure)

### 4.1 The mode

`chooseMode(isTerminal, environment, argv)`:
- `plain` when any of: `!isTerminal`, `environment.CI` set (any value), `environment.TERM === 'dumb'`, or `argv`
  includes `--plain`;
- otherwise `styled-mono` when `environment.NO_COLOR` is set to a non-empty value (no-color.org): the layout without
  any ANSI code;
- otherwise `styled`.

### 4.2 Width-safe symbols

Every symbol is a single code point with Unicode East Asian Width "W", and has **no** variation selector. No U+FE0F
appears anywhere in the output, and a row checks that. So each symbol is exactly two columns wide in every terminal
that renders emoji. The mock-up's 🛰️ (U+1F6F0 + U+FE0F) is text-default and width-ambiguous, so it's replaced:

| Where | Symbol |
|---|---|
| title | 📡 U+1F4E1 |
| identifier line | 🧬 U+1F9EC |
| identifiers summary | ✨ U+2728 |
| bundle line | ⚡ U+26A1 |
| web bundle suffix | 🌐 U+1F310 |
| skipped block | 💤 U+1F4A4 |
| build summary | 🔥 U+1F525 |
| package line | 📦 U+1F4E6 |
| closing box | 🚀 U+1F680 |
| error | ✖ U+2716 (width 1; never inside a box) |

`displayWidth(text)` counts these symbols as 2 and every other code point as 1, after removing ANSI codes. Boxes pad
their content with it, so the right border lines up.

The circled digits ①②③ (U+2460–U+2462) and the bar and rule characters (`█` U+2588, `░` U+2591, `━` U+2501, and
`╭╮╰╯│─`) are East Asian Ambiguous. They count as 1. They're used only outside boxes or as the box frame itself, so a
terminal that draws them two wide shifts only rule lengths, never a border.

### 4.3 Colours (`styled` only)

A table of SGR codes: bold `1`, dim `2`, red `31`, green `32`, magenta `35`, cyan `36`, gray `90`, and reset `0`.
`paint(style, codes, text)` gives `\x1b[<codes>m<text>\x1b[0m` in `styled`, and `text` unchanged in `styled-mono`.

| Part | Colour |
|---|---|
| title box and phase headers | bold magenta |
| package names on 🧬, ⚡ and 📦 lines | cyan |
| output paths (`→ …`) | dim |
| the whole 💤 block | gray (dim) |
| summary lines' timing | dim |
| the closing box | green |
| an error line | red |

### 4.4 The layout

`renderPackageRun(run, style)`, where `run` is:

```ts
interface PackageRun {
  identifiers: readonly string[];    // generateTables' outcomes, '<package>: <path>'
  build: readonly string[];          // buildPackages' outcomes, '<package>: <path>[, <path>…]' or '<package>: no src/extension.ts, skipped'
  packages: readonly {line: string; bytes: number}[];  // packageExtensions' outcomes, '<package>: dist/<file>.vsix', with its size
  milliseconds: {identifiers: number; build: number; package: number};
}
```

`parseOutcome(line)` splits at the first `: ` into `{name, rest}`. A build line whose `rest` is
`no src/extension.ts, skipped` is a skipped package. Any other `rest` is split at `, ` into paths.

Lines, in order, all indented two spaces; `W` = 56 is the inner width of both boxes:

1. An empty line, then the title box:
   - `╭` + `─`×W + `╮`;
   - `│` + W spaces + `│`;
   - `│` + `   📡   R E M O T E   E X T E N S I O N S` padded to W + `│`;
   - `│` + `        build · bundle · ship` padded to W + `│`;
   - `│` + W spaces + `│`;
   - `╰` + `─`×W + `╯`;
   - then an empty line.
2. **Phase header** `━━━ ① IDENTIFIERS ` followed by `━` up to 56 columns. The same for `② BUILD` and `③ PACKAGE`.
   Each header is followed by an empty line.
3. **Identifiers:** one line per outcome: `  🧬  <name padded to 19> → <path>`. Then an empty line, then
   `  ✨ <n> identifier file(s) minted`, with the timing right-aligned so that it ends at column 56. Then an empty line.
4. **Build:**
   - one block per built package, in the outcomes' order. The first path is `  ⚡  <name padded to 19> → <path>`; each
     further path is the same width of spaces, then `→ <path>`. A path under `dist/web/` gets `  🌐` appended;
   - then, if any package was skipped: an empty line, then `  💤  <n> packages napping (no src/extension.ts)`, then the
     skipped names joined by ` · `, four per line, each line indented 6 spaces (gray);
   - then an empty line and `  🔥 <n> bundles forged`, where n is the count of paths, timing right-aligned to 56.
5. **Package:** one line per `.vsix`: `  📦  <file name padded to 30> <bar> <size>`.
   - The bar is `sizeBar(bytes, largest)`: 12 cells, `round(12 × bytes / largest)` of them `█` (at least 1 when
     bytes > 0), the rest `░`.
   - The size is `round(bytes / 1024)` and ` KB`, right-aligned in 6 columns. Below 1024 bytes, `<bytes> B`.
6. **Closing box** (green):
   - `╭` + `─`×W + `╮`;
   - `│` + `  🚀  <n> extension(s) ready for liftoff  ·  <total> total` padded to W + `│`;
   - `│` + `      dist/*.vsix` padded to W + `│`;
   - `╰` + `─`×W + `╯`;
   - then an empty line.

**Plurals:** "1 identifier file", "1 bundle", "1 package", "1 extension"; otherwise the plural.

**Timings** (`formatTiming`):
- under 1000 ms: `<round(ms)>ms`;
- otherwise seconds with two decimals, `1.31s`, for a phase;
- the total, the sum of the three, has one decimal: `2.9s`.

## 5. What doesn't change

- `pnpm build` and `pnpm identifiers` (their own processes, plain lines).
- The plain lines' text.
- `check-consumed`.
- Every existing tools row.

## 6. Rows

**`package-view.test.ts`, pure:**

| Cite | Given | Expected |
|---|---|---|
| tooling-46 §4.1 | (each) not a terminal; `CI=1`; `TERM=dumb`; `--plain`; `NO_COLOR=1` on a terminal; a terminal with none of these | `plain`, `plain`, `plain`, `plain`, `styled-mono`, `styled` |
| tooling-46 §4.2 | `displayWidth('📦 a')`; `displayWidth('\x1b[36mab\x1b[0m')`; `displayWidth('①')` | 4, 2, 1 |
| tooling-46 §4.2 | the full `styled` output of the fixture run (below) | contains no U+FE0F; every box line has the same `displayWidth` (W + 4 with its indent) |
| tooling-46 §4.4 | the fixture run in `styled-mono` | equals the golden text in `tools/fixtures/package-view.golden.txt`, which this PR writes from the §4.4 rules and reviews by eye against the user's mock-up |
| tooling-46 §4.3 | the same run in `styled` | removing every `\x1b[…m` gives the `styled-mono` text; the 💤 block's lines start with the gray code; the closing box's lines with green |
| tooling-46 §4.4 | `sizeBar(503, 503)`, `sizeBar(71, 503)`, `sizeBar(1, 503)`, `sizeBar(0, 503)` | 12 `█`; 2 `█` and 10 `░`; 1 `█` and 11 `░`; 12 `░` |
| tooling-46 §4.4 | `formatTiming(42)`, `formatTiming(1310)`, the total of 42 + 1310 + 1548 | `42ms`, `1.31s`, `2.9s` |
| tooling-46 §4.4 | one identifier, one bundle, one package, one extension | the singular forms |
| tooling-46 §4.4 | a build with no skipped package | no 💤 block |

**The fixture run:** the four identifier outcomes, the build outcomes, and the four packages of today's real output (§1)
with the mock-up's sizes (412, 168, 503 and 71 KB as bytes × 1024), and timings 42, 1310 and 1548 ms.

**`package-run.test.ts`, with fake phases and a recording `out`:**

| Cite | Given | Expected |
|---|---|---|
| tooling-46 §1 | mode `plain`, fake phases giving today's outcomes | the written text is exactly the `identifiers: …`, `build: …` and `package: …` lines, in order, each ending `\n`, and nothing else |
| tooling-46 §3 | mode `styled-mono`, the same | one write, equal to `renderPackageRun` of the run, with the fake sizes and the measured timings (the fake phases add no delay, so the test checks the values are numbers ≥ 0, not their size) |
| tooling-46 §3 | the build phase rejects with `Error('boom')`, `plain` | the `identifiers:` lines were written first, then stderr `build: boom`; no package phase called; `exitCode` 1 |
| tooling-46 §3 | `argv` `['node', 'package-run.ts', 'remote-explorer', '--plain', 'remote-ssh']` | the package phase gets `['remote-explorer', 'remote-ssh']`; the build phase got `[]`; mode `plain` |
| tooling-46 §3 | the same, `styled-mono` | the identifiers phase's lines, then `  ✖ build: boom` |
| tooling-46 §3 | the order | the fake phases record that identifiers, then build, then package ran |

## 7. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers and check-consumed, and
`pnpm coverage` with the new tools files at 100 %. Also run `pnpm package` once in a terminal, under xvfb's terminal or
`script -q -c 'pnpm package' /dev/null`, and paste the output in the PR, plus `pnpm package | cat` to show the plain
lines. PR title `tools: a styled pnpm package output on a terminal (card tooling-46, #824)`. Request athena only.

## 8. Open rows (stop and report on #824)

1. A real outcome line doesn't fit `parseOutcome`'s `<name>: <rest>`. Report it; don't guess a form.

## Appendix: the user's reference mock-up (verbatim, through hermes)

The sizes and timings in it are illustrative. §4 replaces 🛰️ with 📡 for width safety, and fixes every other choice.

```
  ╭──────────────────────────────────────────────────────╮
  │                                                      │
  │   🛰️   R E M O T E   E X T E N S I O N S             │
  │        build · bundle · ship                         │
  │                                                      │
  ╰──────────────────────────────────────────────────────╯

  ━━━ ① IDENTIFIERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    🧬  remote-containers   → src/identifiers.generated.ts
    🧬  remote-explorer     → src/identifiers.generated.ts
    🧬  remote-ssh          → src/identifiers.generated.ts
    🧬  remote-ssh-edit     → src/identifiers.generated.ts

    ✨ 4 identifier files minted                    42ms

  ━━━ ② BUILD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ⚡  remote-containers   → dist/extension.js
    ⚡  remote-explorer     → dist/extension.js
                           → dist/web/extension.js  🌐
    ⚡  remote-ssh          → dist/extension.js
                           → dist/askpass.js
                           → dist/connection-helper.js
    ⚡  remote-ssh-edit     → dist/extension.js

    💤  15 packages napping (no src/extension.ts)
        lib-authority · lib-companion · lib-forwarding · lib-helper
        lib-host · lib-identifiers · lib-log · lib-product
        lib-server · lib-ssh · lib-standdown · lib-wsl
        remote-extensionpack · remote-server · remote-wsl

    🔥 8 bundles forged                            1.31s

  ━━━ ③ PACKAGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    📦  remote-containers-0.1.0.vsix      ██████████░░  412 KB
    📦  remote-explorer-0.1.0.vsix        ████░░░░░░░░  168 KB
    📦  remote-ssh-0.1.0.vsix             ████████████  503 KB
    📦  remote-ssh-edit-0.1.0.vsix        ██░░░░░░░░░░   71 KB

  ╭──────────────────────────────────────────────────────╮
  │  🚀  4 extensions ready for liftoff  ·  2.9s total   │
  │      dist/*.vsix                                     │
  ╰──────────────────────────────────────────────────────╯
```

The user's colour notes: phase headers bold magenta, the ⚡ and 📦 names cyan, output paths dim, the 💤 block fully dim
gray, and the final box green. §4.3 follows them, and adds the 🧬 names in cyan for consistency.
