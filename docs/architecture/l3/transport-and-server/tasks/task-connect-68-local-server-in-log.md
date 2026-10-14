# Task card connect-68: the local connection server's start, reuse and pids in the log

Issue: #847. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2102 §9 (log). Size: S.
Builder: `task:claude`.

## 1. The changes

1. **lib-ssh:** the helper's welcome payload gains `helperProcessId` (its `process.pid`). Its `connected` event gains
   `sshProcessId`, the pid of its ssh child. Both are optional, so an older helper is still accepted.
2. **remote-ssh, shared mode,** at `info`:
   - `Local connection server started: pid <helper>, ssh pid <ssh>` when this connect spawned the helper;
   - `Local connection server reused: pid <helper>, ssh pid <ssh>` when it joined one;
   - `Local connection server record was stale and replaced` on lib-helper's stale path.
   - **Kill:** it logs the host picked and the record looked up: `Kill: host <hostString>, record <found|none>`.
3. **Terminal mode:** writes none of these.

## 2. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-ssh `handler.test.ts` | `F-2102 §9: the welcome and connected carry the pids` | a fake helper | `helperProcessId`; `sshProcessId` |
| `connection-step.test.ts` | `F-2102 §9: started, reused and stale are logged` | claim; join; stale | the three lines |
| `connect-commands.test.ts` | `F-2102 §9: Kill logs the host and the record` | a Kill with and without a record | the line, `found`, then `none` |

**Acceptance:** two windows on `harness`. The second window's log has `Local connection server reused: pid <n>`, and
`<n>` is the helper's pid (`connectionHelpers()`).

## 3. Gates and review

Run all gates and the VSCodium run. PR title `lib-ssh, remote-ssh: the local connection server's start, reuse and pids
in the log (card connect-68, #847)`. Request athena only.
