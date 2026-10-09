# Task card connect-06: the connection step's lease leak, and the notice/answer pass-through

Why: two findings of #186's review (2026-10-09). Rewritten 2026-10-09 to main's names; the platform threading that
was here is card connect-07 (slice 3). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/remote-ssh/src/pipeline/connection-step.ts`, `src/pipeline/steps.ts` (the `ConnectionLease` type only),
their tests; plus real no-op `onNotice`/`answer` members on the `ConnectionLease` fixtures in `test/unit/connect.test.ts` and `test/unit/server-steps.test.ts`, which the widened type forces (added 2026-10-09). Nothing else.

## 2. Contract

```ts
// steps.ts: ConnectionLease gains two members, passed through from the SharedConnection unchanged (no logic):
onNotice(listener: (notice: ConnectionNotice) => void): () => void;
answer(promptId: number, text: string): Promise<boolean>;
// (`refuse(promptId)` joins them when card ssh-10 lands; not this card.)
// connection-step.ts: in `openConnectionStep`, when `channelFor` (or anything after the lease was taken) throws,
// the lease is released before the step returns its failure.
```

## 3. Test table

| Given | Expected |
|---|---|
| `channelFor` throws after the lease was taken | the lease is released exactly once; the step fails (kind `unknown`, the message as reason) |
| ~~`channelFor` throws before any lease~~ | removed 2026-10-09 (#196): `channelFor` runs only after the lease is taken (acquire → onNotice → connect → channelFor), so the case is unreachable; row 1 is the throw test; no restructuring |
| `lease.onNotice(listener)`; the SharedConnection emits a `prompt` | the listener receives it unchanged; the returned function unsubscribes |
| `lease.answer(3, 'yes')` | forwarded to the SharedConnection's `answer(3, 'yes')`; its result returned |
| the existing connection-step rows | unchanged |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: lease release on a throwing channel, notices and answers on the lease (card connect-06)`.

## 6. Open rows

None.
