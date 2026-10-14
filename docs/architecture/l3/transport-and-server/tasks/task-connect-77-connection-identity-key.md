# Task card connect-77: one connection helper per connection identity, whatever the spelling

Issue: #865. Gating: milestone 0.2. F-2501 BR-3, AC-6, AC-7, AC-8 and AC-25; F-2102 BR-6 and 6.3 step 2. Size: S.
Builder: `task:local`.

## 1. The defect

hestia measured it on #590 (coverage-19). Each of these pairs started two helpers and two key logins, where F-2501
BR-3 wants one:
- the hex of `{"hostName":"127.0.0.1","user":"harness","port":P}` and the same with `"port":"P"` (AC-6);
- `harness` and the hex of `{"hostName":"harness"}` (AC-7);
- the hex with user and port and the plain `harness@127.0.0.1:P` (AC-8).

**The cause:** `packages/remote-ssh/src/pipeline/connection-step.ts:69` keys the helper with
`input.connectionKey ?? input.rawHostString`, the authority's payload exactly as written. Kill and the own-host rule
already use `payloadOf(target)` (`maintenance/target.ts:24`, `maintenance-commands.ts:92-138`). So today Kill also
misses the helper of a window opened on a plain `user@host:port`, whose raw text is not its `payloadOf`.

**The ruling** (athena, 2026-10-14; transport contracts §9, amended on main): the helper key is the connection
identity, `payloadOf` of the decoded target. Plain and hex spellings of one target, and a port given as a number or a
string, give one key. A different or missing user or port, other letter case, or an alias against a typed
`user@address` give different keys (F-2102 BR-6). The helper key, the record and Kill all use it. Maintenance keeps
its own key (`payloadOf + NUL + runKey`).

## 2. The fix

1. **`pipeline/connection-step.ts:69`:**

   ```ts
   hostString: input.connectionKey ?? payloadOf(sshTargetOf(input.target)),
   ```

   Import `payloadOf` from `../connect/connect-commands.ts` and `sshTargetOf` from `./host-settings.ts`. Both modules
   are imported by the maintenance code already, so no cycle is added.
2. **`pipeline/steps.ts:43`, the `connectionKey` JSDoc:** "The record key of the connection helper the connect
   acquires; when absent, the target's connection identity, `payloadOf(sshTargetOf(target))` (F-2501 BR-3)."
3. **`lib-ssh/src/connection-server/client.ts:40`, the `hostString` JSDoc:** "The helper's key: the target's connection
   identity (one helper per identity, transport contracts §9), or a maintenance run's own key." Nothing else in
   lib-ssh changes.
4. **Nothing else changes:**
   - `rawHostString` stays as the authority wrote it for everything that isn't a key: the channel (`wiring.ts:283`), the
     companion's `hostKey` (`register-connect.ts:185`, which reopens the authority) and the log.
   - The record file follows the key, since `recordPath` takes `request.hostString`.

**The one-time effect, for the release notes:** a helper that an earlier build started under a raw key that isn't
canonical (a hex alias, a string port, a plain `user@host:port`) isn't found by the first window after the upgrade.
That window starts a second helper, and the old one ends by its grace once its windows have gone (F-2102 BR-3).

## 3. Rows

**Unit rows, in `packages/remote-ssh/test/unit/connection-step.test.ts`.** `P` is 2222. The two hex values are the
codec's:
- `HEX_USER_PORT` = `7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a226861726e657373222c22706f7274223a323232327d`
- `HEX_USER` = `7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a226861726e657373227d`

| Name | Given (`connecting(undefined, {...INPUT, target, rawHostString})`) | Expected `requests[0]?.hostString` |
|---|---|---|
| rename line 208 to `F-2501 BR-3: asks for the helper of the target's identity, with the connect cancellation` | as now (`INPUT`, plain `harness`) | as now: `['harness', true]` |
| `F-2501 BR-3: a structured alias is keyed as the plain alias` | `target: {kind: 'host', hostName: 'harness'}`, `rawHostString: '7b22686f73744e616d65223a226861726e657373227d'` | `'harness'` |
| `F-2501 BR-3: a plain user, host and port is keyed as its structured form` | `target: {kind: 'plain', text: 'harness@127.0.0.1:2222'}` | `HEX_USER_PORT` |
| `F-2501 BR-3: a structured user, host and port gives the same key` | `target: {kind: 'host', hostName: '127.0.0.1', user: 'harness', port: 2222}` | `HEX_USER_PORT` |
| `F-2501 BR-3: a missing port is another identity` | `target: {kind: 'plain', text: 'harness@127.0.0.1'}` | `HEX_USER` |
| `F-2501 BR-3: other letter case is another identity` | `target: {kind: 'plain', text: 'Harness'}` | `'7b22686f73744e616d65223a224861726e657373227d'` |
| `F-2102 6.3 step 2: the key is the one Kill ends for the same typed text` | `target: {kind: 'plain', text: 'harness@127.0.0.1:2222'}` | equals `payloadOf(parseTypedHost('harness@127.0.0.1:2222'))` |

Each row's `rawHostString` is the text the authority carries: the plain text itself, or the hex the row gives (for
the structured user, host and port row, `HEX_USER_PORT`). The row at line 222 (`connectionKey` wins) stays. On main
the structured-alias row and every plain-text row except `harness` fail.

**Acceptance rows** come from hestia's coverage-19 rows, posted as comments on #865. Add them to
`tests/acceptance/windows/` in the file that comment names:
- AC-6: the hex with a number port, then the same with a string port. Both connect, with 1 helper and 1 key login.
- AC-7: `harness`, then the hex of `{hostName: 'harness'}`, then the same with `foo: 'bar'`. All connect, with 1 helper
  and 1 key login.
- AC-8: the hex with user and port and the plain `harness@127.0.0.1:P` share a helper; the hex with a user only and
  the plain `harness@127.0.0.1` share a second. That is 2 helpers, 2 key logins and no `notice` line.
- AC-25: `harness`, then the hex of `{hostName: 'harness'}`, then `harness@127.0.0.1:P`. That is 2 helpers, and the
  first two share.

Each row fails on main with one helper more than expected.

## 4. Gates and review

Run all gates and the VSCodium run. PR title: `remote-ssh: one connection helper per connection identity (card
connect-77, #865)`. Request athena only; hermes assigns the peer. Mark F-2501 AC-6, AC-7, AC-8 and AC-25 `acceptance`
in `docs/architecture/catalogue/coverage-slice1.tsv`.
