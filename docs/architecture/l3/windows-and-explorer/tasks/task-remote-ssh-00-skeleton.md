# Task card remote-ssh-00: the remote-ssh package skeleton (no contributions yet)

Why: the connect-flow cards need a package to live in before the identifier inventory (card remote-ssh-01) lands.
Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/remote-ssh/`: `package.json` (identity fields are already there from #91; add only what this card lists),
`identifiers.json`, `src/extension.ts`, `coverage.json`, the existing `tsconfig.json`/`tsconfig.test.json` (keep; add
`src` to the include if missing), `README.md` (keep #91's text; add the maintainers' table in `remote-ssh-edit`'s
shape with "Components: none yet"), the root tsconfig references if absent. No `contributes`, no `activationEvents`
beyond an empty list, no settings, no commands.

## 2. Contract (exact values)

| Field | Value |
|---|---|
| `main` | `./dist/extension.js` |
| `engines.vscode` | the root constant (`tools/editor-floor.ts`) |
| `extensionKind` | `["ui"]` |
| `capabilities.untrustedWorkspaces.supported` | `true` |
| `activationEvents` | `[]` (F-2001's list comes with card remote-ssh-01) |
| `extensionPack` | `["remote-oss.remote-ssh-edit", "remote-oss.remote-explorer"]` (R-22 / F-3904); no `extensionDependencies` |
| `license` | `MIT` (unchanged) |
| workspace dependencies | `lib-identifiers`, `lib-standdown`, `lib-log`, `lib-ssh` (`workspace:*`), so the connect-flow and diagnostics cards can import them |
| `identifiers.json` | `source` citing remote-oss/remote-ssh#78, `standsDownFor` `ms-vscode-remote.remote-ssh`, `standingDownKey` `""` (pending; the check reports it as pending), `locales` the 14 of F-2002 (cs, de, es, fr, it, ja, ko, pl, pt-br, qps-ploc, ru, tr, zh-cn, zh-tw), empty ledgers |
| `src/extension.ts` | `export function activate(): void {}` and `export function deactivate(): void {}`; excluded from coverage with the reason "loads the editor", listed in the README |
| `package.nls.json` + 14 locale files | only the `description` key with the English sentence (as the other packages) |

## 3. Test table

| Given | Expected |
|---|---|
| manifest fields | exactly the values above (a test reads the manifest) |
| `pnpm identifiers` then `pnpm check-identifiers` | passes; the standing-down key reported pending |
| nls key parity over 15 files | passes (existing tool) |
| `pnpm build` and `pnpm package` | a VSIX `remote-ssh-0.0.0.vsix` builds with `dist/extension.js` and no node_modules |
| README forbidden-words grep | clean |

## 4. Rule for the worker

Tests first; no contribution of any identifier; all gates.

## 5. Gates and review

PR title `remote-ssh: package skeleton (card remote-ssh-00)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows

None.
