# Task card containers-56: the Containers progress is determinate while "Installing server" shows (F-0503 AC-30)

Issue: #1149. Milestone 0.4, containers release 1. Size: S–M. Builder: hestia (`task:claude`), who knows the progress path from
#1118. Spec: remote-oss/remote-containers#34 (F-0503), AC-30: "Given a volume miss, when the install is in progress,
then the notification's progress bar is determinate (not the animated infinite bar) while "Installing server"
shows." This follows containers-55 (#1130, athena's ruling on #1109), whose rule stands unchanged.

## 1. What's measured, and what's known (daedalus, 2026-10-20)

- **Iris on #1050, current main:** the connect toast ending in `: Installing server` reads `infinite` with hestia's
  `notificationProgress`. That holds with the run's normal download source (a fresh download folder) and with the
  slow one. The `: Starting server` toast reads `discrete` (hestia's row d1).
- **Core isn't the cause.** [oss] 1.139.1 `src/vs/workbench/services/progress/browser/progressService.ts`:
  `createNotification` gives `{total: 100, worked: increment}` for any numeric `increment >= 0`, else
  `{infinite: true}`. `updateNotification` calls `updateProgress` only when `typeof step.increment === 'number'`,
  which makes the bar determinate for any number `>= 0`, 0 included. That's why Starting server, a stage with
  `increment: 0`, is `discrete`.
- **On main, the host and the adapter look right.** `lib-authority/src/resolver/host.ts` `connect()` reports
  `incrementOf()` on every phase whose `titleOf` is non-empty, when `determinateStages` is on. `vscode-resolver.ts`
  `progressOf` passes a defined increment to `progress.report`. Containers' `progress-titles.ts` titles `installing`
  and `serverDownloadPercent` with S209. So a report that arrives *while Installing server shows* and carries no
  number has to come from somewhere this reading missed.

## 2. Measure first

Find which report the Installing toast last got. Candidates, most likely first:
1. **The toast isn't the connect's progress.** Another `withProgress` shows the same text with its own infinite
   bar, for example a download or install step's own progress in `remote-containers/src/connect/server-steps.ts` or
   lib-server. Check with `notificationCentre`: are there two notifications?
2. **A phase during the install isn't staged.** One of the connector's phases between `installing` and
   `startingServer` has an empty `titleOf`, so it sets `shown.staged` to false. Its report carries no increment. Check every phase name
   the containers connector emits on a volume miss, against `STAGE_TEMPLATES`.
3. **The toast opens before the first staged report.** `open()` runs on the first non-quiet phase, and the toast is
   created infinite from that step. That alone wouldn't keep it infinite after a staged report, so it only matters
   together with 1 or 2.

Measure with a temporary log line, in your worktree only and never committed. It goes in `progressOf`'s report
callback, writing `{message, increment}` to the launch's log file (`REMOTE_OSS_ACCEPTANCE_LOG`). Run the containers
launch with the volume tree emptied, the way containers-41 does. Put the sequence of reports in the PR.

## 3. Fix

Make every report shown while a stage suffix shows carry its number, per containers-55 §1:
- For **1**, the duplicate progress goes. Its phase reaches the connect's progress as a phase of its own, or is
  folded into the existing ones.
- For **2**, the phase gets the stage's text in `STAGE_TEMPLATES`. A suffix stays until the next stage replaces it
  (F-0408 BR-2), so an install-time phase titles `Installing server`. Or the host keeps `staged` true for an untitled
  phase while the shown title still has a stage. Pick whichever fits F-0408 BR-2's wording, and say which in the PR.

If the cause is none of these, or the fix would change Remote - SSH's progress (whose rows must not change), stop
and tell me the measured sequence.

## 4. Rows

- **Unit**, at the cause: the phase sequence the measurement found gives a number on every staged report. That's
  `lib-authority/test/unit/` for the host, or `remote-containers/test/unit/progress-titles.test.ts` and
  `register-connector.test.ts` for the titles.
- **Acceptance**, `F-0503 AC-30 (installing-determinate)`, in `tests/acceptance/containers/` next to hestia's d1
  row: on a volume miss, the toast whose message ends in `: Installing server` reads not `infinite` with
  `notificationProgress`, each time it's read while the suffix shows. Use the slow download source so the stage
  lasts long enough to read.
- `docs/architecture/catalogue/coverage-containers-r1.tsv`: F-0503 AC-30 `todo` → `acceptance`; `check-coverage`
  passes.

## 5. Gates

All gates, the changed files at 100 %, the whole diff linted, and `jscpd` and `knip` clean. The containers launch
must pass. PR title: `remote-containers: the progress is determinate while "Installing server" shows (card
containers-56, #1149)`. Request athena only. Tell iris (#1050) when it merges.
