# Task card wsl-03: `parseOnline` and `parseStatus`

Why: the install picker lists WSL's online distributions by internal NAME and FRIENDLY NAME (F-6102.BR-1,
BR-3; contracts.md §1 D1a), and the default distro and versions come from `--status` / `--version` (contracts.md §1
D1a `parseStatus`). Both read decoded text; columns come from the layout, not from header words. Reviewing coder:
`remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/online.ts`, `packages/lib-wsl/src/status.ts` (new), `test/unit/online.test.ts`,
`test/unit/status.test.ts` (new), `src/index.ts` (one export line each). Nothing else. Card wsl-05 imports
`OnlineRow` from `online.ts`: do not rename it.

`test/unit/skeleton.test.ts`: delete it in this card if it is still on main when the branch starts or rebases. It
asserts that the package exports nothing, which this card's export line ends, and the module's own tests replace it for
coverage. If another WSL card has already deleted it, leave it absent. This is the one change outside the files above.

## 2. Contract

```ts
export interface OnlineRow {readonly name: string; readonly friendlyName: string}
export type OnlineResult =
  | {readonly kind: 'rows'; readonly rows: readonly OnlineRow[]}
  | {readonly kind: 'unparseable'; readonly reason: string};
export function parseOnline(text: string): OnlineResult;

export interface WslStatus {
  readonly defaultDistro?: string;
  readonly defaultVersion?: 1 | 2;
  readonly wslVersion?: string;
  readonly kernelVersion?: string;
}
export function parseStatus(text: string): WslStatus;
```

`parseOnline`: remove a trailing `\r` from every line. Consecutive non-blank lines form a block; blocks are separated
by blank lines. No block: `rows: []`. The LAST block is the table; its first line is the header, the explanatory
lines before it are other blocks. The second column starts at the first non-space character after the first run of
two or more spaces in the header; no such run: `{kind: 'unparseable', reason: 'header'}`. Each following line of the
block gives `name` = `line.slice(0, column).trim()` and `friendlyName` = `line.slice(column).trim()`; either empty:
`unparseable` with reason `line:N` (N the 1-based number among the table's data lines).

`parseStatus`: for each line with a `:`, the label is the text before the first `:` trimmed and lower-cased, the
value the rest trimmed. Labels: `default distribution` gives `defaultDistro`; `default version` gives
`defaultVersion` when the value is exactly `1` or `2`; `wsl version` gives `wslVersion`; `kernel version` gives
`kernelVersion`. An empty value is absent. The first line for a label wins. Absent fields are left out of the object
(no key with `undefined`). Any other line is ignored; the function never fails.

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-6102.BR-1 | two sentences, a blank line, header `NAME                  FRIENDLY NAME`, rows `Ubuntu                Ubuntu` and `Ubuntu-24.04          Ubuntu 24.04 LTS` | rows `{Ubuntu, Ubuntu}`, `{Ubuntu-24.04, Ubuntu 24.04 LTS}` |
| F-6102.BR-3 | row `OracleLinux_9_5        Oracle Linux 9.5` | `name` is the internal name `OracleLinux_9_5`, friendly name `Oracle Linux 9.5` |
| contracts.md §1 D1a | the same text with CRLF | same rows |
| contracts.md §1 D1a | header and rows with no explanatory block | same rows |
| contracts.md §1 D1a | explanatory block, blank line, header only | `rows: []` |
| contracts.md §1 D1a | empty text | `rows: []` |
| brief "Online parsing" | three blocks (two explanatory, then the table) | the last block is the table |
| brief "Online parsing" | localised header `NOM   NOM CONVIVIAL` and a friendly name `Ubuntu für Test` | rows parsed; non-ASCII kept |
| contracts.md §1 D1a | one block whose first line has no run of two spaces | `unparseable`, reason `header` |
| contracts.md §1 D1a | table row `Ubuntu` (shorter than the column) | `unparseable`, reason `line:1` |
| contracts.md §1 D1a | `Default Distribution: Ubuntu` and `Default Version: 2` | `{defaultDistro: 'Ubuntu', defaultVersion: 2}` |
| contracts.md §1 D1a | `WSL version: 2.1.5.0`, `Kernel version: 5.15.146.1-2`, `WSLg version: 1.0.61` | `{wslVersion: '2.1.5.0', kernelVersion: '5.15.146.1-2'}` |
| contracts.md §1 D1a | `Default Version: 3` and `Default Distribution:` (empty) | `{}` (no keys) |
| contracts.md §1 D1a | label in other case `DEFAULT DISTRIBUTION: Ubuntu`; a repeated label (first wins); a value with a colon `Default Distribution: a:b`; a line without `:` | `Ubuntu`; the first; `a:b`; ignored |
| contracts.md §1 D1a | localised labels only (`Standarddistribution: Ubuntu`), empty text | `{}` (missing fields stay absent) |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first; every branch has a row; the status tests assert with `deepStrictEqual` so an extra `undefined` key fails;
coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: parseOnline and parseStatus (card wsl-03)`; answers R1–R6. Merge after wsl-00.

## 6. Open rows (stop and report)

- Status labels in other display languages and a full-width colon: the spec is silent and brief question 2 is
  open; not tested, not handled (the fields stay absent).
- A table whose header has a two-space run inside the second column's name: not tested.
- Whether a data line that is blank-separated from the table (a second table block) matters: not tested.
