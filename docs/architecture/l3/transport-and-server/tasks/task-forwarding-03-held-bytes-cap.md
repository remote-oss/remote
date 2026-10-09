# Task card forwarding-03: a cap on the bytes a relay bridge holds before the host side opens (#184)

Why: `bridge` in `window-tunnel/relay.ts` holds every chunk a client sends until the dial to the host completes; the
dial's time bound ends the hold, but nothing bounds its size (worker-2's note on #176; filed as #184, slice 2).
Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-forwarding/src/window-tunnel/relay.ts`, `src/window-tunnel/wait.ts` (the limits type only),
`src/index.ts` (no new export beyond the widened type), `test/unit/window-tunnel.test.ts` (rows added), the README
sentence on bounds. Nothing else; `factory.ts` passes its `limits` through unchanged and needs no edit.

## 2. Contract

```ts
export interface WaitLimits {
  readyMilliseconds: number;
  retryMilliseconds: number;
  /** The most bytes a bridge holds for a client before the host side opens; a policy value. */
  heldBytesMaximum: number;
}
```

Rule in `bridge`: the held chunks' total length is counted as they arrive; a chunk that would take the total past
`heldBytesMaximum` is not held: the client connection is closed at once (`client.close()`), the hold is dropped, and
the host side, when its dial completes, is closed without sending anything (the existing `clientGone` path). Once
the host side is open nothing is held, so the cap never applies after that. Exactly at the cap is allowed; one byte
past it is not.

## 3. Test table

| Given (`heldBytesMaximum: 8`) | Expected |
|---|---|
| client sends 3 bytes then 5 bytes before the dial completes | both held; after the dial the host receives 8 bytes in order; client open |
| client sends 8 bytes in one chunk | held and delivered (exactly at the cap) |
| client sends 9 bytes in one chunk | client closed before the dial completes; the host side, when it opens, is closed; nothing sent |
| client sends 5 bytes then 4 bytes | the second chunk closes the client; the first is never sent |
| host side already open, client sends 100 bytes | forwarded, no cap |
| `heldBytesMaximum: 0`, client sends 1 byte before the dial | client closed |
| the factory's `forward` with the widened limits | unchanged outcomes (the existing factory rows still pass) |

## 4. Rule for the worker

As card log-01; the ratchet may only rise; no comment beyond what the guide requires.

## 5. Gates and review

PR title `lib-forwarding: held-bytes cap on the relay bridge (card forwarding-03, #184)`.

## 6. Open rows

None. The policy value's number is the caller's (the connect pipeline's record), not this card's.
