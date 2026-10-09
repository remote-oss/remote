# Task card ssh-10: refusing a question (the window's cancel of a prompt)

Why: F-2306 BR-8 and F-2307 7.E2: cancelling a password or passphrase question ends the login attempt, and the
remaining questions of that `ssh` run are never shown. The askpass program already exits 1 when its question is
closed unanswered, which `ssh` takes as a cancelled prompt; what is missing is the window's way to close one
question and the helper's rule for the questions that follow (ruled 2026-10-09 for connect-03). An empty answer is
NOT a cancel: `ssh` retries on it. Reviewing coder: `remote-coding-worker-2`.

## 1. File boundary

`packages/lib-ssh/src/askpass/endpoint.ts`, `src/connection-server/messages.ts`, `handler.ts`, `client.ts`,
`src/index.ts` (exports), their tests. Nothing else.

## 2. Contract

```ts
// endpoint.ts
refuse(promptId: number): boolean;   // closes that one open question unanswered (its program exits 1); false when not open
// messages.ts: request {type: 'refuse', promptId}; reply {type: 'refused', accepted: boolean}
// client.ts: SharedConnection.refuse(promptId: number): Promise<boolean>
// handler.ts: on 'refuse' from the login's owner: endpoint.refuse(promptId); the attempt is marked cancelled by its
// owner, and every later question of the same ssh run is refused on arrival without a `prompt` event; the mark
// clears when the run ends (loginFailed / spawnFailed / connected / transportLost). A 'refuse' from a lease that is
// not the owner is answered {accepted: false} and does nothing.
```

## 3. Test table

| Given | Expected |
|---|---|
| an open question, `refuse(id)` | `true`; the program's connection gets the close and the program exits 1; a `promptClosed` event |
| `refuse` of an id that is not open | `false` |
| owner refuses question 1; ssh asks question 2 in the same run | no `prompt` event for 2; its program exits 1 at once |
| the run ends (`loginFailed`), a new run (`ownerChanged`, new owner asks) | the mark is cleared: the new run's first question is a `prompt` event |
| a non-owner lease sends `refuse` | reply `{accepted: false}`; the question stays open |
| `answer` after a `refuse` of the same id | `false` |
| `readConnectionRequest({type:'refuse', promptId: 3})` | the request; a non-number id reads as undefined |
| client `refuse` on a helper that is gone | resolves `false` |

## 4. Rule for the worker

As card log-01; no change to the askpass program; the ratchet may only rise.

## 5. Gates and review

PR title `lib-ssh: refusing a question (card ssh-10)`.

## 6. Open rows

None.
