# Task card server-06: V9 cache folders (pure)

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5 V9; ADR-0006 decision 4 (cache keyed by product and
commit for every product but genuine VS Code). Depends on server-01 merged. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/cache/folders.ts`, `src/index.ts` (exports only), test `test/unit/cache-folders.test.ts`; and in lib-product
(amended 2026-10-12, #279): `src/product-table.ts` gains `volumeServerFolder(applicationName)`, `src/index.ts` its
export line, and its test one row per case below. The server folder's name is the product table's data (ADR-0006: a
server folder name appears in package code only in the product table); lib-server never spells it, whole or in parts.

## 2. Contract

```ts
export interface ProductKeys { applicationName: string; quality: 'stable' | 'insider' | string }
export function cacheFolders(product: ProductKeys, commit: string, platform: string, volumeMounted: boolean):
  { serverTree: string | undefined; extensionsCache: string };
// serverTree: `/vscode/${volumeServerFolder(applicationName)}/bin/${platform}/${commit}` when volumeMounted, else undefined;
// lib-product's volumeServerFolder: the reference folder for code/code-insiders (keepsReferenceLayout), `${applicationName}-server` otherwise
// (ADR-0006 decision 4, R-58: products share commit ids, so the server tree is per product like the extension cache; ruled 2026-10-12, #279)
// extensionsCache: `/vscode/extensionsCache` when lib-product's keepsReferenceLayout(applicationName), `/vscode/extensionsCache-${applicationName}` otherwise (unchanged by volumeMounted)
export function clientArchiveFolder(cacheRoot: string, product: ProductKeys, commit: string): string;
// code/code-insiders: `${cacheRoot}/${quality}/${commit}`; every other product: `${cacheRoot}/${applicationName}/${quality}/${commit}`
export function isFromSameGallery(entryGallery: string, productGallery: string): boolean;   // exact string equality after trimming a trailing '/'
```

## 3. Test table

| Given | Expected |
|---|---|
| `cacheFolders({code, stable}, 'abc', 'linux-x64', true)` | serverTree `/vscode/vscode-server/bin/linux-x64/abc`; extensionsCache `/vscode/extensionsCache` |
| same, `volumeMounted false` | serverTree `undefined`; extensionsCache unchanged |
| `cacheFolders({codium, stable}, 'abc', 'linux-x64', true)` | serverTree `/vscode/codium-server/bin/linux-x64/abc` (not the reference folder) |
| `cacheFolders({synthetic-editor, stable}, 'abc', 'linux-x64', true)` | serverTree `/vscode/synthetic-editor-server/bin/linux-x64/abc` |
| `{code-insiders, insider}` | extensionsCache `/vscode/extensionsCache` |
| `{codium, stable}` | extensionsCache `/vscode/extensionsCache-codium` |
| `{codium-insiders, insider}` | `/vscode/extensionsCache-codium-insiders` |
| `{synthetic-editor, stable}` | `/vscode/extensionsCache-synthetic-editor` |
| `clientArchiveFolder('/c', {code, stable}, 'abc')` | `/c/stable/abc` |
| `clientArchiveFolder('/c', {code-insiders, insider}, 'abc')` | `/c/insider/abc` |
| `clientArchiveFolder('/c', {codium, stable}, 'abc')` | `/c/codium/stable/abc` |
| two products, same commit and quality | different folders unless both keep the reference layout |
| `isFromSameGallery('https://open-vsx.org/vscode/gallery/', 'https://open-vsx.org/vscode/gallery')` | `true` |
| `isFromSameGallery('https://marketplace.visualstudio.com/_apis/public/gallery', 'https://open-vsx.org/vscode/gallery')` | `false` |

Product names never appear in this file: use `keepsReferenceLayout` from `lib-product` (card product-01, merged
first); the ADR-0006 literal check stays green.

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: cache folders (card server-06)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected (card product-01 provides the names).
