# Task card connect-65: the resolver line and the ports in the log, with the secrets rows

Issue: #844. Release 0.2, **gating** (athena's F-2003 scope ruling, register 2bb86d6). F-2003 (`remote-oss/remote-ssh#13`)
BR-6 items 1, 9 and 10, and rows for AC-16 and AC-21, because more is logged now. Size: S. Builder: `task:claude`.
Item 11 (the final error, BR-7) is connect-64's (#840). Items 2, 5 and 12 and BR-5's order are connect-71 (#850),
which isn't gating.

## 1. The gap

metis's comparison on #13 (2026-10-14, runs 1, 2 and 4) matches main: no line says which authority was resolved or on
which attempt, nor on which ports it ended. `log-content.ts` has the builders, but its `resolveLogLines(record)`
(connect-04) has no production caller: it builds one record at the end, while the log must be written as the resolve
goes, because 6.2's "details" link shows it while connecting.

## 2. The changes

1. **`packages/remote-ssh/src/diagnostics/log-content.ts`:**
   - **Remove** `resolveLogLines`, `ResolveRecord` and the private helpers only it uses (ADR-0003, dead code). Their
     rows go with them.
   - **Keep `masked` and `maskOf`, exported.** connect-66 and connect-67 use them.
   - **Export** `resolverLine(authority, attempt, reconnection)`: `Resolving ssh-remote+<authority>, attempt <n>`,
     with `, reconnection` appended for a reconnection.
   - **Export** `listeningLine(port)`: `Remote server listening on port <n>`.
   - **Export** `resolvedLine(authority, port)`: `Resolved ssh-remote+<authority> to local port <p>`.
   - **The texts** are the formatter's today. connect-71 adds the builders for items 2, 5 and 12 in the same file.
2. **When each line is written,** through the connect's logger at `info`:
   - **item 1:** first in `connect()` (`pipeline/connect.ts`), before `onPhase({kind: 'initializing'})`, with
     `input.attempt` and `input.isReconnection`;
   - **item 9:** where `server-steps.ts` learns the started or reused server's port;
   - **item 10:** when `connect()` returns `Connected`.
3. **The secrets (BR-14):** none of these lines can hold a secret. The rows below guard every line connect-66 and
   connect-67 add too.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `log-content.test.ts` | the builder rows | each builder | the texts above |
| `connect.test.ts` | `F-2003 BR-6: items 1, 9 and 10 in order on a successful resolve` | the pipeline fixture | the resolver line first; later the listening line; then the resolved line |
| `connect.test.ts` | `F-2003 BR-6 item 1: a reconnection is marked` | `isReconnection: true`, attempt 3 | `Resolving ssh-remote+harness, attempt 3, reconnection` |
| `connect.test.ts` | `F-2003 BR-7: a failed resolve writes no listening or resolved line` | a failing locate step | neither line |

**Acceptance** (`tests/acceptance/windows`; the record's `connectionLog()` for a fresh window `l1` on `harness`):

| Name | Expected |
|---|---|
| `F-2003 BR-6 items 1, 9 and 10: the log names the resolve and its ports` | `Resolving ssh-remote+harness, attempt 1`, then `Remote server listening on port <n>`, then `Resolved ssh-remote+harness to local port <p>`, in that order |
| `F-2003 AC-16: no typed answer is in the log` | the `password` alias, its `maskedInput` answered first with a wrong value `wr0ngPw-<run>` and then the right one: neither typed value occurs anywhere in `connectionLog()` |
| `F-2003 AC-21: no environment sentinel and no token is in the log` | the launch's editor environment gets `REMOTE_OSS_SENTINEL=sent1nel-<run>` (add it to the windows launch's environment in `tools/acceptance-launches.ts`). After a fresh connect at `debug`, and again after one with `remote.SSH.logLevel` `trace` (the agent's `updateSetting`), neither the sentinel value nor the server's connection token (read on the host from the token file) occurs in `connectionLog()` |

The AC-16 and AC-21 rows run after connect-66 and connect-67 have added their lines, so that they guard those lines.
If connect-65 lands first, they pass then, and they keep guarding as the other cards land.

## 4. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: the resolver line and the ports in the log (card connect-65,
#844)`. Request athena only.
