# Task card server-06: V9 cache folders (pure)

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5 V9; ADR-0006 decision 4 (cache keyed by product and
commit for every product but genuine VS Code). Depends on server-01 merged. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/cache/folders.ts`, `src/index.ts` (exports only), test `test/unit/cache-folders.test.ts`.

## 2. Contract

```ts
export interface ProductKeys { applicationName: string; quality: 'stable' | 'insider' | string }
export const VSCODE_APPLICATION_NAMES: readonly string[];   // ['code', 'code-insiders']: the reference layout
export function cacheFolders(product: ProductKeys, commit: string, platform: string, volumeMounted: boolean):
  { serverTree: string | undefined; extensionsCache: string };
// serverTree: `/vscode/vscode-server/bin/${platform}/${commit}` when volumeMounted, else undefined;
// extensionsCache: `/vscode/extensionsCache` for code/code-insiders, `/vscode/extensionsCache-${applicationName}` otherwise (unchanged by volumeMounted)
export function clientArchiveFolder(cacheRoot: string, product: ProductKeys, commit: string): string;
// code/code-insiders: `${cacheRoot}/${quality}/${commit}`; every other product: `${cacheRoot}/${applicationName}/${quality}/${commit}`
export function isFromSameGallery(entryGallery: string, productGallery: string): boolean;   // exact string equality after trimming a trailing '/'
```

## 3. Test table

| Given | Expected |
|---|---|
| `cacheFolders({code, stable}, 'abc', 'linux-x64', true)` | serverTree `/vscode/vscode-server/bin/linux-x64/abc`; extensionsCache `/vscode/extensionsCache` |
| same, `volumeMounted false` | serverTree `undefined`; extensionsCache unchanged |
| `{code-insiders, insider}` | extensionsCache `/vscode/extensionsCache` |
| `{codium, stable}` | extensionsCache `/vscode/extensionsCache-codium` |
| `{codium-insiders, insider}` | `/vscode/extensionsCache-codium-insiders` |
| `{synthetic-editor, stable}` | `/vscode/extensionsCache-synthetic-editor` |
| `clientArchiveFolder('/c', {code, stable}, 'abc')` | `/c/stable/abc` |
| `clientArchiveFolder('/c', {code-insiders, insider}, 'abc')` | `/c/insider/abc` |
| `clientArchiveFolder('/c', {codium, stable}, 'abc')` | `/c/codium/stable/abc` |
| two products, same commit and quality | different folders unless both are in `VSCODE_APPLICATION_NAMES` |
| `isFromSameGallery('https://open-vsx.org/vscode/gallery/', 'https://open-vsx.org/vscode/gallery')` | `true` |
| `isFromSameGallery('https://marketplace.visualstudio.com/_apis/public/gallery', 'https://open-vsx.org/vscode/gallery')` | `false` |
| `VSCODE_APPLICATION_NAMES` | `['code','code-insiders']`, frozen |

Literal strings in this file: the ADR-0006 literal check allows product names only in `lib-product`'s table; so
`'code'` and `'code-insiders'` must come from `lib-product`'s exported constant if one exists (check
`packages/lib-product/src/index.ts` for a `VSCODE_APPLICATION_NAMES` or similar export); if none exists, stop and
report (the card then adds the export to lib-product's table in a separate card).

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: cache folders (card server-06)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

The product-name constant as described above.
