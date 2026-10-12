# Task card ssh-26: the tunnel's success line is written once

Why: athena's follow-up on #353 (card ssh-23, merged). The tunnel run's command (`TUNNEL_COMMAND`, card ssh-19,
`arguments/invocation.ts`) and the gate's line (`TUNNEL_SUCCESS_LINE`, card ssh-23, `terminal/tunnel-session.ts`) spell
the same text twice. If one changes without the other, the gate never settles. The gate's check must stay an **exact**
line match, because `ssh -v`'s `debug1: Sending command: echo '…'` line contains the same text. So the command is
built from the line, and the line has one home. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/arguments/invocation.ts` | `TUNNEL_SUCCESS_LINE` moves here, and `TUNNEL_COMMAND` is built from it (section 2) |
| `packages/lib-ssh/src/terminal/tunnel-session.ts` | imports `TUNNEL_SUCCESS_LINE` from `../arguments/invocation.ts` instead of defining it |
| `packages/lib-ssh/src/index.ts` | `TUNNEL_SUCCESS_LINE` is exported from `invocation.ts` now |
| `packages/lib-ssh/test/unit/invocation.test.ts` | one row added (section 3) |

Nothing else.

## 2. Contract

In `arguments/invocation.ts`:

```ts
import {posixQuote} from '../process/remote-program.ts';

/** The line the tunnel run prints once its forwards are set up, as the host's own output. */
export const TUNNEL_SUCCESS_LINE = 'Connected to SSH Host - Please do not close this terminal';

/** What the tunnel run runs on the host: the line that says it is up, then a wait that holds the forward. */
export const TUNNEL_COMMAND = `echo ${posixQuote(TUNNEL_SUCCESS_LINE)}; exec sleep 2147483647`;
```

- **Why the line moves to `invocation.ts`, not the other way:** `tunnel-session.ts` already imports from
  `arguments/invocation.ts`. Defining the line there and importing it into `invocation.ts` would make a two-file
  cycle, which the `no-intra-package-cycles` lint rule refuses. `invocation.ts` → `process/remote-program.ts` is no
  cycle (`remote-program.ts` imports only lib-host).
- The built command is **exactly** today's text (checked: `echo 'Connected to SSH Host - Please do not close this
  terminal'; exec sleep 2147483647`), so every existing row that pins it passes unchanged.
- `tunnel-session.ts`'s gate still compares `line === TUNNEL_SUCCESS_LINE` (exact, never `includes`).

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| #353 (athena) | `TUNNEL_COMMAND` | equals `` `echo ${posixQuote(TUNNEL_SUCCESS_LINE)}; exec sleep 2147483647` `` |
| #353 | `TUNNEL_COMMAND` | is still `echo 'Connected to SSH Host - Please do not close this terminal'; exec sleep 2147483647` (the existing pinned row, unchanged) |

Every existing row of `invocation.test.ts` and `tunnel-session.test.ts` passes unchanged.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet; lint green (no cycle).

## 5. Gates and review

PR title `lib-ssh: the tunnel's success line is written once (card ssh-26)`.

## 6. Open rows

None.
