# Task card wsl-02: `parseList` (the output of `wsl.exe --list --verbose`)

Why: the registered distros, their state, version and the default one come from this text (contracts.md §1 D1a,
D2 `distros`; F-6201 §16 names `--list --verbose` for names, state and version; F-6701.BR-3 reads the same list
on a remote host). The columns are found from the layout and the marker, never from the header words, because WSL
prints its management text in the Windows display language. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/list.ts` (new), `test/unit/list.test.ts` (new), `src/index.ts` (one export line for the
names below). Nothing else. Input is decoded text (card wsl-01 is not imported). Card wsl-04 imports `DistroRow`
from this file: do not rename it.

## 2. Contract

```ts
export type DistroState = 'running' | 'stopped' | 'installing' | 'converting' | 'other';
export type DistroVersion = 1 | 2 | 'unknown';
export interface DistroRow {
  readonly name: string;
  readonly isDefault: boolean;
  readonly state: DistroState;
  readonly version: DistroVersion;
}
export type ListResult =
  | {readonly kind: 'rows'; readonly rows: readonly DistroRow[]}
  | {readonly kind: 'unparseable'; readonly reason: string};
export function parseList(text: string): ListResult;
```

Rules:

1. Split at `\n`, remove a trailing `\r` from each line, drop every line that is empty after trimming. No line left:
   `{kind: 'rows', rows: []}`.
2. The first remaining line is the header. It is skipped and never inspected.
3. For every other line, in order: if the first non-space character is `*`, the row is the default and that one
   character is removed. Trim the rest and match it against `^(.+?)\s+(\S+)(?:\s+(\d+))?$`: group 1 is `name`
   (inner whitespace kept as written), group 2 the state word, group 3 the version.
4. State: the word lower-cased is `running`, `stopped`, `installing` or `converting` for that state; anything else
   is `other`. Version: `1` gives 1, `2` gives 2, any other number or no group 3 gives `'unknown'`.
5. A line that does not match the pattern: return `{kind: 'unparseable', reason: 'line:N'}` with N the 1-based
   number among the lines after the header; no partial rows.

## 3. Test table

Lines are joined with `\n` unless the row says CRLF.

| Citation | Given | Expected |
|---|---|---|
| contracts.md §1 D1a | header `  NAME      STATE           VERSION` only | `rows: []` |
| contracts.md §1 D1a | empty text | `rows: []` |
| contracts.md §1 D1a | header, `* Ubuntu    Running         2`, `  Debian    Stopped         2` | `Ubuntu` default running 2, then `Debian` not default stopped 2 |
| contracts.md §1 D1a | a row ending `Installing 2`, one `Converting 2`, one `Stopped 2` | states `installing`, `converting`, `stopped` |
| contracts.md §1 D1a | state word `Suspended` and state word `RUNNING` | `other`; `running` (one `it` per word) |
| contracts.md §1 D1a | state word `Läuft` (localised) | `other` |
| contracts.md §1 D1a | version `1` / `3` / column missing (`  Alpine   Stopped`) | 1 / `'unknown'` / `'unknown'` (one `it` each) |
| contracts.md §1 D1a | names `fixture γ`, `Fixture.Beta-2` with `Running 2` | names kept exactly, including the inner space |
| contracts.md §1 D1a | header `  NOM   ÉTAT   VERSION` (localised) and one row | the row parses; the header words are not used |
| contracts.md §1 D1a | the three-row text with CRLF line ends | same rows as with `\n` |
| contracts.md §1 D1a | blank lines between the header and the rows and after the last row | same rows |
| contracts.md §1 D1a | `*Ubuntu Running 2` (no space after the marker) | `Ubuntu`, default |
| contracts.md §1 D1a | header and a row `broken` | `unparseable`, reason `line:1` |
| contracts.md §1 D1a | header, a good row, then `broken` | `unparseable`, reason `line:2`, no rows |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first; every branch has a row; coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: parseList (card wsl-02)`; answers R1–R6. Merge after wsl-00.

## 6. Open rows (stop and report)

- The text WSL prints with no distro installed ("has no installed distributions" in the display language) is one
  or two sentences, not a table; rule 3 would read them as rows. Not tested, not handled; the spec for presence
  (F-6101, a pending draft) decides. Report if met.
- A name that ends in a number and a row whose version column is missing (`alpha 2 Stopped` is fine; `alpha Stopped 2`
  where `Stopped` is part of the name) cannot be told apart by the layout; not tested.
- More than one marked row: each is `isDefault`; not tested.
- Brief question 2 (state words from `--list --running --quiet`) is not this card.
