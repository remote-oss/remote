# Task card explorer-01: the row model of the SSH group (pure)

Why: the "SSH" group shows one row per configured host and, under it, one row per recent folder or workspace
(remote-oss/remote-explorer#9 F-5102, #11 F-5104). This card is the pure model between the companion's answers and the
tree. Reviewing coder: `remote-coding-worker-1`. No `vscode` import, no `lib-companion` import: the inputs are plain
values, so the card does not wait for that package.

## 1. Package and file boundary

`packages/remote-explorer` exists on main with `package.json`, `README.md`, `tsconfig.json` and `tsconfig.test.json`
only (checked with `git ls-files`); it has no `src/` and no `coverage.json`. This card adds:

| File | Role |
|---|---|
| `packages/remote-explorer/src/model/ssh-group.ts` | new |
| `packages/remote-explorer/test/unit/ssh-group.test.ts` | new |
| `packages/remote-explorer/identifiers.json` | new, exactly the first block below |
| `packages/remote-explorer/coverage.json` | new, exactly the second block below |

```json
{
  "source": "remote-oss/remote-explorer#7 (F-5901)",
  "standsDownFor": "ms-vscode.remote-explorer"
}
```

```json
{
  "exclude": {},
  "ratchet": {
    "lines": 100,
    "branches": 100,
    "functions": 100
  }
}
```

Nothing else may change: no `package.json`, no `src/index.ts`, no dependency. (Amended 2026-10-12: the package gets
its first `src/` file here. From then on the identifier generator requires an `identifiers.json`, since an extension
with `src/` needs one, and every gate runs `pnpm identifiers` first. The coverage tool measures the package and needs
its ratchet. Both files are the minimum: the source and the reference id of the identity decision, F-5901; no
`standingDownKey`, `internal` or `locales` yet, which later cards add with the code that uses them. Checked on main
with a stand-in module: `pnpm identifiers`, `check-identifiers`, `check-layout`, `typecheck`, `lint`,
`format:check`, `dead`, `dupes` all green; coverage 100/100/100 with no problem. The README already lists the coverage
exclusions as none.)

## 2. Contract

```ts
export interface FolderRow { kind: 'folder' | 'workspace'; hostKey: string; path: string; label: string }
export interface HostRow { rowId: string; alias: string; folders: FolderRow[] }

export function hostRowId(alias: string): string;                  // 'ssh-host:' + alias, nothing else
export function isWorkspacePath(path: string): boolean;            // the path ends with the lower-case '.code-workspace'
export function folderLabel(path: string): string;
export function orderedPaths(paths: readonly string[], sortSetting: unknown): string[];
export function buildSshRows(
  aliases: readonly string[],
  history: ReadonlyMap<string, readonly string[]>,   // host key to paths, most recent first, as the companion sends them
  sortSetting: unknown,                              // the value of remote-explorer.foldersSortOrder as read
): HostRow[];
```

Rules. `folderLabel`: the text after the last `/` or `\` (the whole text when there is none); for a workspace path the
label is that text without the trailing `.code-workspace` plus ` (Workspace)`. A path ending in a separator, `/` alone
and the empty string give `''`. `orderedPaths`: only the exact string `alphabetical` sorts, by the recorded string
with plain `<` comparison of the characters (case-sensitive, no locale), keeping every duplicate; every other value
of any type returns the input order. The input is not modified. `buildSshRows`: one `HostRow` per alias in the given
order (no sorting, no merging, no removal); its `folders` come from the history entry whose key equals the alias
exactly, ordered by `orderedPaths`, one `FolderRow` per path (duplicates give duplicate rows) with `hostKey` the alias,
`path` as recorded, `kind` `workspace` for `isWorkspacePath` else `folder`; no entry means `[]`. Keys with no alias are
dropped. A row carries nothing but the fields above (the host name, user and port never appear).

## 3. Test table

| Cite | Given | Expected |
|---|---|---|
| F-5102.BR-7 | `buildSshRows(['zeta','Alpha','mid'], new Map(), undefined)` | rowIds `ssh-host:zeta`, `ssh-host:Alpha`, `ssh-host:mid` in that order; `alias` equal; every `folders` `[]`; with `aliases` `[]` and a history for `x`, the result is `[]` |
| F-5102.BR-8 | `Object.keys` of a host row and of a folder row | exactly `rowId, alias, folders` and `kind, hostKey, path, label` |
| F-5104.BR-4 | `orderedPaths(['/w/b','/w/a','/w/c'], undefined)` and with `'most recently used'` | `['/w/b','/w/a','/w/c']` (each) |
| F-5104.BR-5 | `orderedPaths(['/w/zz/aaa-label','/w/alpha','/w/_under','/w/bravo','/w/Charlie'], 'alphabetical')` | `/w/Charlie`, `/w/_under`, `/w/alpha`, `/w/bravo`, `/w/zz/aaa-label` |
| F-5104.BR-5 | `orderedPaths(['/srv/dup/b','/srv/dup/A','/srv/dup/b','/srv/dup/a','/srv/dup/b'], 'alphabetical')` | `A`, `a`, then three `b` (all kept); a frozen input array raises no exception and stays unchanged |
| F-5104.BR-5 | `orderedPaths(['c:\\x','\\\\srv\\s','D:\\d','C:\\','C:/f','/c:/u','/C:/U'], 'alphabetical')` | `/C:/U`, `/c:/u`, `C:/f`, `C:\`, `D:\d`, `\\srv\s`, `c:\x` |
| F-5104.BR-6 | (each) `orderedPaths(['/b','/a'], v)` for `v` = `'Alphabetical'`, `'alphabetical '`, `''`, `'alpha'`, `5`, `null`, `true`, `{}` | `['/b','/a']` |
| F-5104.BR-14 | (each) `folderLabel` of `/`, `/tmp/trailing/`, ``, `C:\`, `C:\Users\lab\trail\` | `''` |
| F-5104.BR-14 | (each) `folderLabel` of `~/tilde`, `C:\Users\x\proj`, `c:/Users/x/fwd`, `/srv/ünïcødé/Ω`, `/home/x/with space`, `\\srv\share\unc`, `plain` | `tilde`, `proj`, `fwd`, `Ω`, `with space`, `unc`, `plain` |
| F-5104.6.3 | `folderLabel` and `isWorkspacePath` of `/srv/proj.code-workspace`; `C:\Users\lab\ws.code-workspace` | `proj (Workspace)`, true; `ws (Workspace)`, true |
| F-5104.BR-15 | (each) `/w/UP.CODE-WORKSPACE`, `/w/Mixed.Code-Workspace`, `/w/x.code-workspace/` | `isWorkspacePath` false; `folderLabel` `UP.CODE-WORKSPACE`, `Mixed.Code-Workspace`, `` |
| F-5104.BR-1 | `buildSshRows(['a'], new Map([['a',['/p','/w.code-workspace']]]), undefined)` | `a`'s folders: `{kind:'folder',hostKey:'a',path:'/p',label:'p'}` then `{kind:'workspace',hostKey:'a',path:'/w.code-workspace',label:'w (Workspace)'}` |
| F-5104.BR-3 | `buildSshRows(['a'], new Map([['a',['/p','/p']]]), undefined)` | two identical folder rows |
| F-5104.BR-2 | `buildSshRows(['Alias','other'], new Map([['alias',['/x']],['gone',['/y']],['other',['/z']]]), undefined)` | `Alias` has `[]`; `other` has the `/z` row; `/x` and `/y` appear nowhere |
| F-5104.BR-5 | `buildSshRows(['a'], new Map([['a',['/b','/a']]]), 'alphabetical')` | folder paths `/a`, `/b` |

15 rows (an (each) row counts once).

## 4. Rule for the worker

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included (`now` excepted); no `const` arrow helpers; comments only where the guide requires
them, none with a feature, rule or decision id (ids may appear in test names); no duplicated code. Coverage of the
module: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `remote-explorer: SSH group row model (task-explorer-01)`. The description
answers R1 to R4 and R6, maps each cite to its test name (R5), and lists the section 6 rows hit.

## 6. Open rows (stop and report)

1. If any gate still reports a problem for remote-explorer with the two files of section 1 in place, stop and
   report the exact message; do not add a `src/index.ts`, an exclusion, a field to `identifiers.json` or a dummy.
2. The same alias twice in `aliases` (the companion's list already has none): two rows or one? Not tested.
3. Characters outside the Basic Multilingual Plane in the alphabetical sort: the spec says "character codes". Code
   unit or code point comparison? Not tested.
4. A workspace path with an empty name (`/w/.code-workspace`): the label ` (Workspace)` or something else? Not tested.
   F-5104 BR-14 has no row for it; the literal rule of F-5104 §3 gives ` (Workspace)`, which the code does. Asked on
   remote-oss/remote-explorer#18 (2026-10-12); a follow-up row lands when it is answered.
5. Description and tooltip text of a row (platform dependent for Windows-form paths) and the expansion state under
   `collapseRecentFolders` are not in this card.
