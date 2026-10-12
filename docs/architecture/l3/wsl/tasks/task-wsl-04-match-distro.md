# Task card wsl-04: `matchDistro` and `filterDockerDesktop`

Why: the distro in an authority is matched against the registered names ignoring case and the registered spelling
is used everywhere afterwards (F-6201.BR-1); the empty name is the default distro (F-6201 6.8); no match is
`Unknown distro: {0}` with the name as typed (F-6201 7.E1, STR:S053); the Docker Desktop distros are not listed
(F-6701.BR-3). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/match.ts` (new), `test/unit/match.test.ts` (new), `src/index.ts` (one export line). It
imports the TYPE `DistroRow` from `./list.ts` (card wsl-02; merge 02 first). Nothing else.

`test/unit/skeleton.test.ts`: delete it in this card if it is still on main when the branch starts or rebases. It
asserts that the package exports nothing, which this card's export line ends, and the module's own tests replace it for
coverage. If another WSL card has already deleted it, leave it absent. This is the one change outside the files above.

## 2. Contract

```ts
export type MatchResult =
  | {readonly kind: 'match'; readonly registeredName: string; readonly version: DistroVersion; readonly isDefault: boolean}
  | {readonly kind: 'distroUnknown'; readonly asTyped: string}
  | {readonly kind: 'noDistro'};
export function matchDistro(rows: readonly DistroRow[], typedName: string): MatchResult;
export function filterDockerDesktop(rows: readonly DistroRow[], includeDockerDesktop: boolean): readonly DistroRow[];
```

`matchDistro`: `typedName === ''` selects the first row with `isDefault`; none: `noDistro`. Otherwise a row whose
name equals `typedName` exactly wins; else the rows whose lower-cased name equals the lower-cased `typedName`: exactly
one is the match, none or several is `distroUnknown` with `asTyped` = `typedName` unchanged (no trim, no case change).
`registeredName` is the row's own spelling. Empty `rows` with a non-empty name: `distroUnknown`. `matchDistro` does
not remove Docker Desktop rows.

`filterDockerDesktop`: when `includeDockerDesktop` is true it returns `rows` unchanged; otherwise it returns the rows
whose lower-cased name is neither `docker-desktop` nor `docker-desktop-data`, in the input order. It never mutates.

## 3. Test table

Rows used: `Ubuntu` (default, running, 2), `Debian` (stopped, 2), `Legacy` (stopped, 1), `fixture γ` (running, 2).

| Citation | Given | Expected |
|---|---|---|
| F-6201.BR-1 | `matchDistro(rows, 'Ubuntu')` | `match`, `Ubuntu`, version 2, default true |
| F-6201.BR-1 | `'ubuntu'`, `'UBUNTU'` | `registeredName` `Ubuntu` (registered spelling) |
| F-6201.BR-1 | `'legacy'` | `match`, `Legacy`, version 1, default false |
| F-6201.BR-1 | `'FIXTURE Γ'` | `match`, `fixture γ` (case folding of non-ASCII letters) |
| F-6201 6.8 | `''` | `match`, `Ubuntu` (the default row) |
| F-6201 6.8 | `''` with no row marked default | `noDistro` |
| F-6201 7.E1 | `'nosuch'` | `distroUnknown`, `asTyped` `nosuch` |
| F-6201 7.E1 | `'NoSuch '` (trailing space) | `distroUnknown`, `asTyped` `NoSuch ` unchanged |
| F-6201 7.E1 | `' '` and empty `rows` with `'Ubuntu'` | `distroUnknown` (one `it` each) |
| F-6201.BR-1 | rows `Dup` and `dup`; typed `Dup` | `match`, `Dup` (exact case wins) |
| F-6201.BR-1 | rows `Dup` and `dup`; typed `DUP` | `distroUnknown` (provisional, see section 6) |
| F-6701.BR-3 | rows with `docker-desktop` and `docker-desktop-data`, flag false | both removed, order of the rest kept |
| F-6701.BR-3 | the same rows, flag true | the same array contents |
| F-6701.BR-3 | `Docker-Desktop` in the rows, flag false | removed |
| F-6701.BR-3 | `docker-desktop-extra` and `my-docker-desktop` | kept |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first; the input arrays are frozen in the tests; every branch has a row; coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: matchDistro and filterDockerDesktop (card wsl-04)`; answers R1–R6. Merge after wsl-02.

## 6. Open rows (stop and report)

- The two-names-differing-only-in-case rule (rows 10 and 11) is the brief's defensive design choice (question 4,
  unanswered); if the lead drops it, both rows and the "several" branch go.
- Whether `Docker-Desktop` (other case) is also hidden: F-6701 names the lower-case ids only; the card follows
  F-6201.BR-1's case-insensitive naming. Confirm.
- The order of a picker (default first, then alphabetical, F-6701.BR-4) belongs to F-6202; not this card.
