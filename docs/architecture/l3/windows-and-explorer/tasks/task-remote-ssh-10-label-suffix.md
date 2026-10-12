# Task card remote-ssh-10: the window label's suffix and when it is registered (#141 card B)

Why: `../brief-remote-ssh-window-surfaces.md`, card B. The runtime label formatter's workspace suffix is `SSH: <host
label>` (F-2502 BR-2, BR-3), and it is registered only for a connection that is up (AC-17, AC-34). This card is the pure
part. Card D registers it. Depends on card remote-ssh-09 (`hostLabel` for plain authorities) being merged; if it isn't,
stop and report. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/window/label-suffix.ts` | new |
| `packages/remote-ssh/test/unit/label-suffix.test.ts` | new |

Nothing else. No `vscode` import. The string table entry and its l10n keys belong to card D, which resolves the id.

## 2. Contract

```ts
import type {ConnectionState, SshTarget} from 'lib-authority';
import type {StringRef} from '../connect/picker-model.ts';

/** The id of the `SSH: {0}` text, the prefix of the window's label; not a spec id (the brief's ruling 2). */
export const SSH_LABEL_PREFIX_ID = 'sshLabelPrefix';

/** The workspace suffix of an SSH window: the prefix text with the host label as its value. */
export function workspaceSuffixOf(target: SshTarget): StringRef;   // {id: SSH_LABEL_PREFIX_ID, values: [hostLabel(target)]}

/** Whether the runtime label is registered for a resolve in this state: only for a connection that is up. */
export function shouldRegisterLabel(state: ConnectionState): boolean;   // true only for 'connected'
```

The prefix carries a named id, not English (R-29). `SSH: {0}` has no STR id in F-2502, and the brief rules it a
string-table entry of our own, so card D maps `SSH_LABEL_PREFIX_ID` to the template `SSH: {0}`.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2502 BR-2 | `workspaceSuffixOf({kind: 'plain', text: 'my-alias'})` | `{id: 'sshLabelPrefix', values: ['my-alias']}` |
| F-2502 BR-3 | `workspaceSuffixOf({kind: 'plain', text: 'u@192.0.2.10:2222'})` | `values` `['192.0.2.10:2222']` |
| F-2502 BR-3 | `workspaceSuffixOf({kind: 'host', hostName: 'my-alias', user: 'u', port: 2222})` | `values` `['my-alias']` |
| F-2502 AC-17 | `shouldRegisterLabel('connected')` | `true` |
| F-2502 AC-34 | each of `'resolving'`, `'failed'`, `'transportLost'`, `'transportClosed'` | `false` (one `it` each) |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the window label's suffix (card remote-ssh-10, #141 card B)`; Part of #141.

## 6. Open rows

None.
