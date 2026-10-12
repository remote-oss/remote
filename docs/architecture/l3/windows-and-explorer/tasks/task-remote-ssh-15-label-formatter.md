# Task card remote-ssh-15: the window's label is registered once the connection is up (#141 card D)

Why: athena's window-surfaces brief (#141), card D. F-2502 BR-2: an SSH window's workspace names carry the suffix
`SSH: <host label>` once the window is connected, and a failed resolve shows only the static `[SSH]`. lib-authority's
`registerAuthorityLabel` and card B's `workspaceSuffixOf` and `shouldRegisterLabel` exist, but nothing calls them.
Two named string ids of our own also have no way to text yet: card B's `sshLabelPrefix` (whose `SSH: {0}` key is not
even in the bundles) and card remote-ssh-13's `platformPickPlaceholder` (whose template is in the bundles). This
card adds that one table and the label's adapter. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/own-strings.ts` | new: the templates of our own named ids, and `ownText` (section 2.1) |
| `packages/remote-ssh/src/surfaces/label-formatter.ts` | new: `registerWindowLabel` (section 2.2) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the key `SSH: {0}`, English value |
| `packages/remote-ssh/test/unit/own-strings.test.ts` | new |
| `packages/remote-ssh/test/unit/label-formatter.test.ts` | new |
| `packages/remote-ssh/test/unit/strings.test.ts` | the default bundle's row gains `SSH: {0}` |

Nothing else. No `vscode` import in either new file: the editor is behind lib-authority's `LabelFormatterHost` and
the resolver handle. The wiring (E6c, daedalus) calls `registerWindowLabel` with the real ones.

## 2. Contract

### 2.1 `surfaces/own-strings.ts`

```ts
import type {StringRef} from '../connect/picker-model.ts';
import {type Translate, filled} from './strings.ts';

/** The ids of the strings that are ours alone, with no id in the specs, and their English templates. */
export const OWN_TEMPLATES = {
  sshLabelPrefix: 'SSH: {0}',
  platformPickPlaceholder: 'Select the platform of the remote host "{0}"',
} as const;

/** The text of a string of our own: its template translated and filled. Throws for an id this table lacks. */
export function ownText(reference: StringRef, translate: Translate): string;
```

- `ownText` looks the id up in `OWN_TEMPLATES` with `Object.hasOwn`. A missing id throws
  `Error('no template for the string id <id>')`: the callers pass ids from this package's own constants, so a miss is
  a defect.
- `OWN_TEMPLATES.sshLabelPrefix` equals card B's `SSH_LABEL_PREFIX_ID` key. Import `SSH_LABEL_PREFIX_ID` from
  `../window/label-suffix.ts` and use it as the computed key (`[SSH_LABEL_PREFIX_ID]: 'SSH: {0}'`), so the id has one
  spelling. `platformPickPlaceholder` stays a literal key (the picker file holds it as a literal).

### 2.2 `surfaces/label-formatter.ts`

```ts
import {type LabelFormatterHost, type ResolverHandle} from 'lib-authority';
import type {Translate} from './strings.ts';

/**
 * Registers the window's label once its first resolve has settled with the connection up. Gives back what removes it,
 * which does nothing when nothing was registered.
 */
export function registerWindowLabel(
  resolver: Pick<ResolverHandle, 'currentConnection' | 'onFirstResolveSettled'>,
  formatter: LabelFormatterHost,
  translate: Translate,
): {dispose(): void};
```

- It subscribes with `onFirstResolveSettled`. When the listener runs, it reads `currentConnection()`. It registers
  only when the connection is present, `shouldRegisterLabel(state)` is true (card B), and `decodedTarget.target` is
  an SSH target. `DecodedTarget.target` is a union of every family's target; the SSH shapes are the only ones with a
  `kind` field, so the test is `'kind' in decodedTarget.target`, the same rule the connector uses
  (`pipeline/connector.ts`, `pipelineInputOf`). It then calls
  `registerAuthorityLabel(formatter, decodedTarget, ownText(workspaceSuffixOf(target), translate))`.
- The registration lives for the window's life: the returned `dispose` disposes it, and is safe to call before the
  resolve settled, after a failed one, and twice.
- A failed first resolve registers nothing; the window keeps the static `[SSH]` (F-2502 AC-34). A later
  reconnection does not register again: the window's first resolve is the one that decides (core reloads the
  window after a failure's Retry, F-2601, so a failed window never turns connected in place).
- When the resolver was not registered (the gate found `resolvers` missing), E6c does not call this function at all
  (F-2502 §16). That is E6c's branch, not this file's.


## 3. Test table

One assertion per `it`; the cite starts the name. The fakes: a `LabelFormatterHost` that records the formatters it
was given and counts disposals; a resolver handle whose `onFirstResolveSettled` keeps the listener for the test to
fire, and whose `currentConnection` answers a value the test sets; `same` (the translation that returns its
template) and `german` (a translation that maps `'SSH: {0}'` to `'SSH-Host: {0}'` and returns any other template
as it is).

### 3.1 `own-strings.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2502 BR-2 | `ownText({id: 'sshLabelPrefix', values: ['dev']}, same)` | `'SSH: dev'` |
| F-2206 AC-2 | `ownText({id: 'platformPickPlaceholder', values: ['box']}, same)` | `'Select the platform of the remote host "box"'` |
| F-3902 rule 8 | `ownText({id: 'sshLabelPrefix', values: ['dev']}, german)` | `'SSH-Host: dev'` (the template is translated, then filled) |
| R-29 | `ownText({id: 'nothing', values: []}, same)` | throws `/no template for the string id nothing/` |
| string tables | every key of `OWN_TEMPLATES` | its template is a key of `bundle.l10n.json` |

### 3.2 `label-formatter.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2502 BR-2 | first resolve settles `connected` for the plain target `dev` | one formatter registered, its `formatting.workspaceSuffix` is `'SSH: dev'` |
| F-2502 BR-2 | the same | its `authority` is `ssh-remote+dev` (lib-authority's, passed through) |
| F-2502 BR-3, AC-14 | `connected` for the plain target `alex@my-alias:22` | suffix `'SSH: my-alias'` |
| F-2502 AC-34 | first resolve settles `failed` | nothing registered |
| F-2502 AC-34 | the listener runs and `currentConnection()` is `undefined` | nothing registered |
| F-2502 BR-2 | `connected` with a `wsl` decoded target (a target with no `kind`) | nothing registered |
| F-2502 BR-2 | nothing has settled yet | nothing registered |
| F-2502 BR-2 | `connected`, then `dispose()` | the registration was disposed once |
| F-2502 BR-2 | `dispose()` called twice after `connected` | disposed once |
| F-2502 AC-34 | `dispose()` after a failed resolve | no throw, nothing disposed |
| R-29 | `connected` for `dev`, with `german` | the suffix is `'SSH-Host: dev'` |
| string tables | `strings.test.ts`'s default bundle row | includes `SSH: {0}` |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the window's label is registered once the connection is up (card remote-ssh-15, #141 D)`.

## 6. Open rows

None.
