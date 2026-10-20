# Task card containers-55: the Containers progress is determinate while it shows a stage (F-0503 AC-30, F-0408 AC-3)

Issue: #1130. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`. Design: athena's ruling on #1109
(hestia's F-0408 AC-3 open row on #1118), which corrects her ruling 6 there: F-0503 AC-30 and F-0408 AC-3 both want
a **determinate** bar while a stage suffix shows. Remote - SSH's progress doesn't change.

## 1. The rule

- **Which reports carry an `increment`:** while the Containers progress shows a stage suffix (`: Installing server`,
  `: Starting server`, card containers-08 §3.3 with #1046), its reports carry an `increment`, so core draws a
  determinate bar.
- **During the server download,** the increments follow the download's own percentage: lib-authority's
  `serverDownloadPercent` phase, `percent` 0–100. Each report adds `percent − the percent already reported`, never
  less than 0.
- **Otherwise** a report with a stage carries `increment: 0`. The bar is determinate and nothing is invented.
- **A report with no stage suffix** carries no `increment`, as today.
- **It's a per-family option of the resolver host,** on for Containers and off for Remote - SSH, so Remote - SSH's
  rows don't change.
- **The source:** cite the `[oss]` path that makes a notification's progress determinate on an `increment`. That's
  `src/vs/workbench/services/progress/browser/progressService.ts`, where a report with a numeric `increment` sets the
  notification's total and worked. Read it to confirm that `increment: 0` makes the bar determinate. If it doesn't,
  that's an open row (§4).

## 2. The change

**lib-authority:**
- `resolver/host.ts`: `ResolverOptions` gains `determinateStages?: boolean`, absent or false by default.
  `ProgressPort.withProgress`'s `update` gains a third argument, `increment?: number`. When the option is on, the host
  computes it per §1. A phase whose `titleOf` is non-empty has a stage, and `serverDownloadPercent` gives the
  percentage. The host keeps the percent reported so far for the connect.
- `resolver/vscode-resolver.ts` (`progressOf`): `progress.report({message, ...(increment === undefined ? {} :
  {increment})})`.
- `testing/recording-resolver-editor.ts`: records the increment with each update.

**remote-containers:**
- `connect/register-connector.ts`: `determinateStages: true`.
- `connect/server-steps.ts`: the transfer's `onPhase` (now `() => undefined`) forwards `{kind: 'progress', step:
  'download', percent}` as the connector's `{name: 'serverDownloadPercent', percent}` phase.
- `connect/progress-titles.ts`: `phaseTitleOf` gives `serverDownloadPercent` the installing stage's text (S209), so
  the suffix stays `Installing server` during the download (F-0408 BR-2: a suffix stays until the next stage replaces
  it). The other phases are unchanged.

## 3. Rows

**Unit:**
- **lib-authority host** (the recording editor):
  - with the option on, a stage report carries `increment: 0`;
  - percents 0, 40, 100 give increments 0, 40, 60;
  - a percent lower than the last gives 0;
  - a report with no stage carries none.
- **lib-authority host, with the option off:** no report carries an increment. That's Remote - SSH's case.
- **`vscode-resolver.ts`:** an increment reaches `progress.report`, and none means no `increment` key.
- **remote-containers:**
  - the transfer's download percents reach the connector as `serverDownloadPercent`;
  - `phaseTitleOf` of it is `Installing server`;
  - register-connector passes `determinateStages: true`.

**Acceptance, if the harness can read the bar:** core's notification progress is a `.monaco-progress-container` with
the class `infinite` while indeterminate, and `discrete` (or no `infinite`) when determinate. Add a renderer helper
`notificationProgress(name)` to `tests/acceptance/windows/renderer.ts` that reads it for the connecting toast. Then
write a row in `tests/acceptance/containers/` that catches the toast with a stage suffix (`Starting server` on a warm
server, or `Installing server` with the volume tree emptied, as containers-41 does) and asserts it isn't
`infinite`. If the bar can't be read reliably, the unit rows are the proof, and say so in the PR.

Then F-0503 AC-30 and F-0408 AC-3 follow this card: `acceptance` with the toast row, else `unit`. Tell hestia (#1118)
and iris (#1050) when it merges.

## 4. Gates and open rows

All gates, the changed files at 100 %. PR title: `lib-authority, remote-containers: a determinate progress while the
Containers progress shows a stage (card containers-55, #1130)`. Request athena only.

**Open row:** `increment: 0` doesn't make core's bar determinate. Report it with the `[oss]` lines. athena decides
between a minimal first increment and another reading.
