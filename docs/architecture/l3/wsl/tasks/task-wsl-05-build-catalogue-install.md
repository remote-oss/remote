# Task card wsl-05: Windows build, catalogue order and the install line

Why: three small pure rules of the distro inventory (contracts.md §1 D2): the old-build check for several distros
(F-6103.BR-1, 7.E3), the order of the online catalogue (F-6102.BR-2) and the exact install line typed into the "WSL"
terminal (F-6102.BR-3, BR-4). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-wsl/src/windows-build.ts`, `packages/lib-wsl/src/install.ts` (new), `test/unit/windows-build.test.ts`,
`test/unit/install.test.ts` (new), `src/index.ts` (one export line each). `install.ts` imports the TYPE `OnlineRow`
from `./online.ts` (card wsl-03; merge 03 first). Nothing else.

## 2. Contract

```ts
export function windowsBuildFromRelease(osRelease: string): number | undefined;
export function multiDistroAllowed(windowsBuild: number | undefined): boolean;

export function sortOnlineCatalogue(rows: readonly OnlineRow[]): readonly OnlineRow[];
export type InstallLine =
  | {readonly kind: 'line'; readonly text: string}
  | {readonly kind: 'invalidName'};
export function installCommandLine(name: string): InstallLine;
```

- `windowsBuildFromRelease`: split at `.`; with at least three parts and a third part of digits only, the third part
  as a number; otherwise `undefined`. (`10.0.17763` gives 17763; the OS release string's third part is the build.)
- `multiDistroAllowed`: `undefined` gives true; a number gives true when it is 18362 or more, false below.
- `sortOnlineCatalogue`: a new array ordered by `friendlyName.toLowerCase()` compared by UTF-16 code units with `<`
  and `>` (never `localeCompare`, never a numeric compare of digits); rows that compare equal keep the input order;
  the input is not changed.
- `installCommandLine`: `name` is valid when it matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`; then
  `{kind: 'line', text: 'wsl.exe --install -d ' + name}`; otherwise `{kind: 'invalidName'}`. The first character is
  restricted so a name can never read as an option.

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-6103.BR-1 | `windowsBuildFromRelease('10.0.17763')`, `'10.0.22631'` | 17763, 22631 |
| F-6103 7.E3 | `'10.0'`, `''`, `'10.0.abc'`, `'10.0.'` (one `it` each) | `undefined` |
| F-6103.BR-1 | `windowsBuildFromRelease('10.0.26200.1')` | 26200 |
| F-6103.BR-1 | `multiDistroAllowed(18362)`, `(26200)` | true |
| F-6103.BR-1 | `multiDistroAllowed(18361)`, `(17763)` | false |
| F-6103 7.E3 | `multiDistroAllowed(undefined)` | true |
| F-6102.BR-2 | friendly names `AlmaLinux OS 8`, `AlmaLinux OS 10` | `AlmaLinux OS 10` first (digits compared as text) |
| F-6102.BR-2 | `Oracle Linux 9.5`, `openSUSE Leap 15`, `Kali Linux` | `Kali Linux`, `openSUSE Leap 15`, `Oracle Linux 9.5` |
| F-6102.BR-2 | `beta`, `Alpha`, `ALPHA2` | `Alpha`, `ALPHA2`, `beta` (case ignored) |
| F-6102.BR-2 | two rows with friendly names `Same` and `same`, different `name` | input order kept; the input array is unchanged |
| F-6102.BR-3 | `installCommandLine('Ubuntu')` | `line`, text `wsl.exe --install -d Ubuntu` |
| F-6102.BR-3 | `'Ubuntu-24.04'`, `'OracleLinux_9_5'` | `line` with that internal name |
| F-6102.BR-3 | friendly name `Ubuntu 24.04 LTS` | `invalidName` (the internal name is used, never the friendly one) |
| brief "Install line" | `''`, `'-d'`, `'a;b'`, `'a&b'`, `'$(x)'`, `'a"b'`, `'a\nb'`, `'ünï'` (one `it` each) | `invalidName` |

## 4. Rule for the worker

As card log-01; names of four characters or more (`now` excepted); no comment beyond what the guide requires; tests
first; every branch has a row; coverage 90/85/90 and the ratchet.

## 5. Gates and review

PR title `lib-wsl: windows build, catalogue order, install line (card wsl-05)`; answers R1–R6. Merge after wsl-03.

## 6. Open rows (stop and report)

- The valid-name character set is the brief's "WSL's name characters" with no list in the spec (F-6102 shows only
  `Ubuntu`-like internal names); the card uses the set observed in WSL's published name list. Confirm before release;
  a name outside it (for example one with `+`) is reported, not allowed.
- `contracts.md` §1 D2 lists no failure for `installCommandLine`; the brief adds the validation; the `InstallLine`
  union is therefore provisional.
- A release string such as `10.0.19045-ge` (a suffix in the third part): `undefined` under the rule; the spec is
  silent.
