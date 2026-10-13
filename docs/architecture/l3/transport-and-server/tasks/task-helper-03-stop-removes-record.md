# Task card helper-03: `stop` removes the stopped helper's record

Issue: #596. Why: athena's ruling on #532 (2026-10-13), contracts X1's `stop` row (amended on main). F-2412 BR-7 and
POST-3, and F-2411 6.1 step 2, say nothing stored for the host outlives Kill Current. Today lib-helper's `stop`
(`packages/lib-helper/src/client/acquire.ts`) asks the helper to end and leaves its registry record, which the next
acquire only replaces as stale. Builder: hestia or iris (hermes assigns). Size: S. connect-23's part 2c (iris, #532)
uses it.

## 1. The behaviour

`stop(environment, folder, namespace, helperKey)`:
1. reads the record, as now; with no record (or one that doesn't parse), it's done;
2. when the endpoint answers: sends `hello` with the record's nonce and `stop`, as now, then **waits for the connection
   to close** (the helper ends and its end closes it), bounded by `environment.helloLimitMilliseconds` on
   `environment.timer`;
3. when the endpoint doesn't answer, the helper is already gone: go on to step 4;
4. **removes the record only if it's still the stopped helper's.** It reads the file again and removes it when the
   record there has the same `nonce` (the helper's start token). A record with another nonce was written by a newer
   helper, which a concurrent acquire started meanwhile; it stays. A file that no longer exists is fine.

If the bounded wait expires (the helper didn't end in time), `stop` still goes to step 4: the record is the stopped
helper's and would only be found stale later. `stop` never throws; a failing remove is ignored, as a failing connect is
today.

## 2. Rows (`packages/lib-helper/test/unit/client.test.ts`, the fake environment)

| Name | Expected |
|---|---|
| `contracts X1: stop removes the stopped helper's record once it has ended` | the fake endpoint closes after `stop`; the record file is gone |
| `contracts X1: stop keeps a record a newer helper wrote meanwhile` | between `stop` and the close, the fake file port's record is replaced by one with another nonce; that record stays |
| `contracts X1: stop removes the record of a helper that no longer answers` | `connect` rejects; the record is gone |
| `contracts X1: stop removes the record when the helper doesn't end in time` | the endpoint never closes; after the limit on the fake timer the record is gone |
| `contracts X1: stop with no record is done and removes nothing` | no `remove` call |
| `contracts X1: a failing remove leaves stop done` | `remove` rejects; `stop` resolves |

The existing `stop` rows stay green. lib-helper stays at its gates (100/100/100).

## 3. Review

PR title `lib-helper: stop removes the stopped helper's record (card helper-03)`. athena checks the nonce rule against
X1, themis or triton reviews.
