# Task card helper-03: a helper removes its own record before it closes, and `stop` cleans up after one that doesn't

Issue: #596. Why: athena's ruling on #532 (2026-10-13), contracts X1's `stop` row (amended on main). F-2412 BR-7 and
POST-3, and F-2411 6.1 step 2, say nothing stored for the host outlives Kill Current. Today lib-helper's `stop`
(`packages/lib-helper/src/client/acquire.ts`) asks the helper to end, and the helper leaves its registry record, which
the next acquire only replaces as stale. Builder: hestia or iris (hermes assigns). Size: S. connect-23's part 2c (iris, #532)
uses it.

## 1. The behaviour

**Why the helper removes its own record** (athena on #597; contracts X1 and X2 amended on main, 8b53fd7). After a Kill,
the windows the helper served get `helperGone` and reconnect at once. Their acquires run `replaceStale` (remove, then
claim) on the old record. If `stop` read, compared and removed the record afterwards, it could delete the new helper's
record and leave two helpers for one host. So the helper itself removes its record while it still answers. While it
answers no acquire can call its record stale, and the windows reconnect only after its endpoint has closed.

**One nonce-checked removal, shared.** lib-helper exports `removeOwnRecord(files, recordFile, nonce)`. It reads
`recordFile` and removes it only when the record there parses and carries `nonce`. A record with another nonce stays,
and a missing file is fine. Every removal of a helper's record goes through it: `serve`'s, `stop`'s stale path, and
lib-ssh's connection helper's.

**`serve`** (`packages/lib-helper/src/runtime/serve.ts`):
- `ServeOptions` gains `recordFile: string` (the helper's own record) and `files: Pick<RegistryFilePort, 'read' |
  'remove'>`. The helper's start passes them, as it already knows the folder, namespace and key.
- When the helper ends, by a client's `stop`, its control's `stop` or its end policy: after the end action (if any)
  and **before** it closes any connection and the endpoint, it calls `removeOwnRecord(files, recordFile, nonce)`.
- A failing read or remove is logged with `logLine` and doesn't stop the close.

**`stop`** (`packages/lib-helper/src/client/acquire.ts`):
1. reads the record, as now. With no record (or one that doesn't parse), it's done.
2. When the endpoint answers: sends `hello` with the record's nonce, then `stop`, as now, then **waits for the
   connection to close**, bounded by `environment.helloLimitMilliseconds` on `environment.timer`. A close means the
   helper has removed its record. `stop` removes nothing.
3. **The stale path:** the endpoint doesn't answer, or the wait expires. The helper is gone or hung. `stop` removes the
   record only when it still carries the nonce it read in step 1: the same tolerance as `replaceStale`.

`stop` never throws: a failing remove is ignored, as a failing connect is today.

**lib-ssh's connection helper** (`packages/lib-ssh/src/connection-server/helper.ts`, triton on #597): its outer
`finally { await environment.files.remove(options.recordFile) }` runs after `serve` has closed the endpoint, with no
nonce check. By then the windows have reconnected, and a new helper may own the record, so the old helper deletes it:
the very race this card removes. The fix:
- pass `recordFile` and `files` to `serve`, so the removal happens before the close;
- make the `finally` call `removeOwnRecord(environment.files, options.recordFile, parameters.nonce)`. It still runs when
  `serve` throws before it listens, and it keeps a newer helper's record.

No other helper of the family removes its record today. A grep for `files.remove(` and `.remove(recordPath` under
`packages/*/src` lists the places; the PR says what it found.

## 2. Rows

`packages/lib-helper/test/unit/serve.test.ts` (contracts X2):

| Name | Expected |
|---|---|
| `contracts X2: a stopped helper removes its own record before it closes` | with a recording file port and endpoint, the order is `remove(recordFile)`, then the connections' `close`, then the server's `close` |
| `contracts X2: a helper ended by its end policy removes its own record, and keeps another nonce's` | an end policy fires. With the file holding the helper's nonce it's removed; with the file holding another nonce, no `remove` |
| `contracts X2: a failing record removal is logged and the helper still closes` | `remove` rejects; one log line; the endpoint closes |

`packages/lib-helper/test/unit/client.test.ts` (contracts X1):

| Name | Expected |
|---|---|
| `contracts X1: stop waits for the helper to close and removes nothing itself` | the fake endpoint closes after `stop`; no `remove` call by `stop` |
| `contracts X1: stop removes the record of a helper that no longer answers` | `connect` rejects; the record with the read nonce is removed |
| `contracts X1: stop removes the record of a helper that doesn't end in time` | the endpoint never closes; after the limit on the fake timer, the record is removed |
| `contracts X1: on the stale path stop keeps a record another helper wrote` | `connect` rejects, and the file meanwhile holds another nonce; no `remove` |
| `contracts X1: stop with no record is done and removes nothing` | no `remove` call |
| `contracts X1: a failing remove leaves stop done` | `remove` rejects; `stop` resolves |

`packages/lib-helper/test/unit/registry.test.ts` (or the file where the registry's rows are):

| Name | Expected |
|---|---|
| `contracts X1: removeOwnRecord removes a record with its nonce` | the file is gone |
| `contracts X1: removeOwnRecord keeps a record with another nonce, and a file that doesn't parse` | no `remove` |
| `contracts X1: removeOwnRecord with no file is done` | no `remove`, no throw |

`packages/lib-ssh/test/unit/connection-helper.test.ts` (or the file where `helper.ts`'s rows are):

| Name | Expected |
|---|---|
| `contracts X2: the connection helper's record is removed before its endpoint closes` | order: `remove`, then the endpoint's `close` |
| `contracts X2: an ended connection helper keeps a record a newer helper wrote` | the record file holds another nonce when the helper ends; no `remove` |
| `contracts X2: a connection helper that fails before it listens removes its own record` | `serve` throws; the record with its nonce is removed |

The existing `stop`, `serve` and connection-helper rows stay green. lib-helper and lib-ssh stay at their gates.

## 3. Review

PR title `lib-helper: a helper removes its own record before it closes (card helper-03)`. athena checks the nonce rule against
X1, themis or triton reviews.
