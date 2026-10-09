# Task card product-01: export the reference-layout application names from lib-product's table

Why: ADR-0006's literal check allows product names only in `lib-product`'s table file; `lib-server`'s cache folders
(card server-06, #94) need the two names that keep the reference layout. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-product/src/product-table.ts` (the one allowed file), `src/index.ts` (export only), test
`test/unit/product-table.test.ts` (add rows). Nothing else.

## 2. Contract

```ts
export const REFERENCE_LAYOUT_APPLICATION_NAMES: readonly string[];   // ['code', 'code-insiders'], frozen
export function keepsReferenceLayout(applicationName: string): boolean;  // exact match against the list
```

## 3. Test table

| Given | Expected |
|---|---|
| `REFERENCE_LAYOUT_APPLICATION_NAMES` | `['code','code-insiders']`, `Object.isFrozen` true |
| `keepsReferenceLayout('code')`, `('code-insiders')` | true |
| `keepsReferenceLayout('codium')`, `('code-oss')`, `('Code')`, `('')` | false |
| the ADR-0006 literal check (`pnpm check-layout`) | still passes (the names are in the allowed file) |

Card server-06 then imports `keepsReferenceLayout` instead of defining `VSCODE_APPLICATION_NAMES`; its row for that
constant is replaced by "uses lib-product's `keepsReferenceLayout`" (the lib-server package gains no new dependency:
lib-product is already allowed).

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-product: reference-layout application names (card product-01)`.

## 6. Open rows

None.
