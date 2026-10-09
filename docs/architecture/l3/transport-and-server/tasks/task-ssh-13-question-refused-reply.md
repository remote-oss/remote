# Task card ssh-13: the reply to a `refuse` request gets its own type

Why: card ssh-10 named the reply to a `refuse` request `refused`, which the `connect` request's refusal
(`{type: 'refused', reason: Refusal}`) already uses, so the client tells the two apart with a `'reason' in` check
(#234 review, 2026-10-09; the card's mistake). Depends on #234 merged. Reviewing coder: `remote-coding-worker-2`.

## 1. File boundary

`packages/lib-ssh/src/connection-server/messages.ts`, `handler.ts`, `client.ts`, their tests. Nothing else; the
wire is private to the helper and its windows of the same build, so no compatibility shim.

## 2. Contract

```ts
// messages.ts: the reply to {type: 'refuse', promptId} becomes
| {type: 'questionRefused'; accepted: boolean}
// {type: 'refused'; reason: Refusal} stays the connect request's refusal only.
// readConnectionReply reads the new type; handler.ts returns it; client.ts's refuse() checks reply.type ===
// 'questionRefused' and no longer tests 'reason' in reply.
```

## 3. Test table

| Given | Expected |
|---|---|
| `readConnectionReply({type:'questionRefused', accepted:true})` | the reply |
| `readConnectionReply({type:'questionRefused'})` (no boolean) | `undefined` |
| `readConnectionReply({type:'refused', reason:'notOwner'})` | unchanged: the connect refusal |
| the handler's answer to an owner's `refuse` of an open question | `{type:'questionRefused', accepted:true}` |
| the handler's answer to a non-owner's `refuse` | `{type:'questionRefused', accepted:false}` |
| `SharedConnection.refuse` on `{type:'questionRefused', accepted:true}` | `true` |
| `SharedConnection.refuse` on a `{type:'refused', reason}` reply (a mismatched helper) | `false` |
| the existing ssh-10 rows | unchanged outcomes |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-ssh: questionRefused reply (card ssh-13)`.

## 6. Open rows

None.
