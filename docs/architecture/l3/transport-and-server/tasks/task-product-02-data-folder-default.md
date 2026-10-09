# Task card product-02: `serverDataFolderNameOrDefault` (one place for the fallback)

Why: a profile without `serverDataFolderName` (a product we do not know) needs one deterministic, product-scoped
fallback, never `~/.vscode-server` (ADR-0006; ruled 2026-10-08). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-product/src/profile-reader.ts` (or the profile module as named on main), `src/index.ts` (export only),
the profile tests (add rows). Nothing else.

## 2. Contract

```ts
export function serverDataFolderNameOrDefault(profile: Pick<ProductProfile, 'serverDataFolderName' | 'applicationName'>): string;
// profile.serverDataFolderName when present and non-empty; else `.${profile.applicationName}-server`
```

## 3. Test table

| Given | Expected |
|---|---|
| `{serverDataFolderName: '.vscodium-server', applicationName: 'codium'}` | `'.vscodium-server'` |
| `{serverDataFolderName: undefined, applicationName: 'synthetic-editor'}` | `'.synthetic-editor-server'` |
| `{serverDataFolderName: '', applicationName: 'x'}` | `'.x-server'` (empty counts as absent) |
| the synthetic product fixture without the field | the derived name; the VS Code and VSCodium fixtures keep theirs |
| the ADR-0006 literal check | still passes (no product name in this function) |

## 4. Rule for the worker

As card log-01; the ratchet may only rise.

## 5. Gates and review

PR title `lib-product: data-folder default (card product-02)`.

## 6. Open rows

None.
