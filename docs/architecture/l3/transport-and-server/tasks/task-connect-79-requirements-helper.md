# Task card connect-79: every row's requirements check is the server's bundled helper; `serverBundled` and exit 207 go

Issue: #905. Release 0.2. Size: S–M. Builder: `task:claude`.
Design: proteus and athena's ruling on #253 (2026-10-20). The contracts edit is #1078: this card's PR changes no
document under `docs/`.

## 1. Why

The pinned VSCodium server's launcher (`bin/codium-server`) runs no requirements check. The check is the separate
helper `bin/helpers/check-requirements.sh`, which exits 99 and prints its reasons on an unsupported host, and 0
otherwise (measured in containers-21 §1). remote-ssh's policy row is `serverBundled`, which waits for a launcher exit
207 that this server never gives. In `ubuntu:18.04`, lib-server's own start script ends `ServerFailedToStart` with no
`server.failure` fact. So F-2401's requirements dialog can't show, and the 207 branch is dead code (ADR-0003).
Containers already runs the helper (`bundledHelper`, containers-21).

**Don't read Microsoft's server launcher** to check whether `code` exits 207. The reference installs that program, so
it's under the guard (ruling point 3).

## 2. The rule (ruling points 1 to 5)

1. **remote-ssh's `SSH_POLICY` is `bundledHelper`.** lib-server runs the helper before each launch, never on a reuse.
   Exit 99 ends the start as `LinuxPrereqs`, with the helper's output as facts (up to 20 lines of 500 characters,
   ADR-0010 rule 1), as containers-21 built it.
2. **WSL's row is `bundledHelperPlusAlpineProbe`:** the helper, then the Alpine libstdc++ probe (F-6302). Only the
   value changes in this card. The probe isn't built anywhere today, and WSL's package isn't built: the value names
   the policy that card will build. The helper half runs for it now, as for `bundledHelper`.
3. **`serverBundled` and `serverBundledPlusAlpineProbe` leave the type, and the 207 branch leaves the start
   script.** A helper that is missing from the archive, or exits 126 or 127 (it can't run), launches the server, as
   any exit other than 99 does. So a server we don't pin is never refused. The missing helper keeps its existing fact
   and notice (`server.prerequisitesHelper missing`, `requirementsHelperMissing`).
4. **Criteria:** an F-2401 or F-2703 criterion that names exit 207 is read as the helper's exit 99. The user sees the
   same dialog. A row that asserts the code itself cites the ruling in its name's label: `(ruling-253-<case>)`, e.g.
   `F-2401 AC-3 (ruling-253-helper): …`.
5. **V7's ready wait:** the prerequisites check fails at once, before any wait, through the helper. A server that exits
   before reporting a port is still reported at the end of the wait (contracts V7, F-2409 AC-25).

## 3. The change

**lib-server:**
- `policy/record.ts`: `RequirementsCheck` is `'none' | 'bundledHelper' | 'bundledHelperPlusAlpineProbe'`. Its doc
  comment names both helper values.
- `policy/validate.ts`: its list of values to match.
- `policy/rows.ts`: `SSH_POLICY.requirementsCheck: 'bundledHelper'`; `wslPolicy`'s `requirementsCheck:
  'bundledHelperPlusAlpineProbe'`.
- `lifecycle/runtime.ts`: `requirementsHelper` is true for `bundledHelper` and for `bundledHelperPlusAlpineProbe`.
- `scripts/bootstrap.ts`: in the ready wait, delete the `SERVER_ENDED` block (`SERVER_ENDED=no`, the `if [
  "$SERVER_ENDED" = no ]` block with its `wait` and `EXIT_CODE`, and the 207 line). Nothing else reads `SERVER_ENDED` or
  `EXIT_CODE`; check with `grep` and keep the rest of the loop (`[ "$LAUNCHED" = yes ] || start_failed`,
  `cve_terminated`) as it is.

**remote-ssh:**
- `pipeline/failure.ts`: `prerequisitesMissing` becomes `logged('prerequisiteMissing', failure.detail)`, so the
  helper's lines reach the log, as `copyToolMissing` does. The dialog is F-2401's, unchanged.
- Where the pipeline reads a started server (the caller of the `start` step in `pipeline/`), a
  `requirementsHelperMissing` notice gives one warning line: `the server has no requirements helper; the host's
  requirements weren't checked`. That's containers-21's line with "host" for "container".

## 4. Rows

**lib-server unit (`bootstrap-script.test.ts`, `runtime.test.ts`, `policy` rows):**
- The `F-2703.7.E2: a server that exits with 207 is LinuxPrereqs` row is replaced by `F-2703 … (ruling-253-exit)`: a
  server that exits 207 after launch is now `ServerFailedToStart` at the end of the wait, like any other early exit.
  Name it with the criterion the old row cited.
- The containers-21 helper rows (exit 99, no helper, reuse, the flag off, marker lines) stay. Add one: a helper that
  exits 127 launches.
- `runtime.test.ts`: the `serverBundled` fixtures become `bundledHelper` or `none`, whichever the row means. A row
  shows the helper runs for `bundledHelperPlusAlpineProbe`.
- The policy rows: SSH is `bundledHelper`, WSL is `bundledHelperPlusAlpineProbe`, and validation rejects
  `serverBundled`.

**Server acceptance (`tests/acceptance/server/`, the stand-in server):**
- `stand-in-server.ts`: the behaviour `missingLibraries` (a launcher exiting 207) becomes `requirementsUnmet`. Its
  archive has `bin/helpers/check-requirements.sh`, which prints two lines (`Warning: Missing GLIBC >= 2.28! from
  /lib/libc.so` and `Error: Missing required dependencies.`) and exits 99, and its launcher serves. Add
  `helperUnrunnable`, a helper that exits 127, with a serving launcher.
- `start.test.ts`: the two 207 rows become:
  - `contracts V7, F-2401 (ruling-253-helper): a host the helper refuses fails at once, before any wait`: under 1 s
    with `readySeconds: 10`;
  - `contracts V7 (ruling-253-helper): reports the helper's refusal as missing prerequisites, with its lines`:
    `{kind: 'failed', failure: {kind: 'prerequisitesMissing', detail: <the two lines>}}`. Assert the detail as
    lib-server joins the facts.
  - A third row: `helperUnrunnable` starts.
- These rows run the start with the SSH policy's `requirementsHelper: true`, the way `start.test.ts` passes start
  options today.

**remote-ssh unit:** `failure.test.ts`: the prerequisites failure logs its detail. The notice row: one warning line
for `requirementsHelperMissing`.

Every changed file at 100 %.

## 5. Gates and review

All gates, and `pnpm test:acceptance:server`. PR title: `lib-server, remote-ssh: every requirements check is the
server's helper, and exit 207 goes (card connect-79, #905)`. Request athena only; hermes assigns the peer.

## 6. Open rows (stop and report on #905)

1. Something other than the 207 block reads `SERVER_ENDED` or `EXIT_CODE`.
2. The real VSCodium server's helper path differs from `bin/helpers/check-requirements.sh` in the pinned archive. Read
   the archive's file list, not the launcher.
