# Task card containers-61: a stopped container's window gets core's "Cannot reconnect" dialog every time (F-0409 AC-8, 10, 23)

Issue: #1162. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude` (hestia or iris). Found by dike on #1159
(#1119): the dialog showed in one of four runs. Athena's reading: core draws it from our resolver's answer on the
re-resolve. F-0409 AC-8, AC-10 and AC-23 went back to `todo`. Spec: remote-oss/remote-containers#23 (F-0409) 6.4,
6.5 and 6.6.

## 1. How the answer reaches core (daedalus, reading main)

- Core's reconnection loop ([oss] `src/vs/platform/remote/common/remoteAgentConnection.ts`, `PersistentConnection`)
  re-resolves the authority on each attempt. A `RemoteAuthorityResolverError.NotAvailable` gives
  `ReconnectionPermanentFailure`, which is the "Cannot reconnect. Please reload the window." dialog (6.4), with
  `handled` from the error (ours is not handled, so the dialog shows). Read at 1.139.1 (`_runReconnectingLoop`): only
  `TemporarilyNotAvailable`, a connect-time `ETIMEDOUT`/`ENETUNREACH`/`ECONNREFUSED`/`ECONNRESET` and a cancellation
  keep the countdown loop going ("Attempting to reconnect in {0} seconds...", 6.5; waits 0, 5, 5, 10… s). Any other
  error is permanent. So an answer of the held address whose relay has closed gives `ECONNREFUSED`, and the loop
  goes on.
- Our side. `connector.connect` with `isReconnection` and a held connection runs `reconnect(held)`
  (`packages/remote-containers/src/connect/connector.ts`). That inspects the container and calls
  `reconnectionOutcomeOf` (`connect/reconnection.ts`):
  - `missing` → `containerGone`;
  - `paused` → `transportLost`;
  - not running, or another start → `containerGone`;
  - running with the same start → `held` if the server's process answers, else `transportLost`;
  - an inspect that fails (`unreachable`) → `transportLost`.
  `mapFailure` (`lib-authority/src/resolver/failure-mapping.ts`) turns `transportLost` (retryable) into
  `TemporarilyNotAvailable`, and `containerGone` on a reconnection into `NotAvailable` (not handled).
- So the dialog shows only when the first re-resolve after the stop already sees the container exited.
  `docker stop` gives PID 1 a grace period (10 s by default) in which `docker inspect` still says `running` with the
  same start. A re-resolve in that window answers `held` (the server still runs, but its relay closed) or
  `transportLost`. Either keeps core looping, and the dialog comes later or never in the row's time. That's the
  likely race. An inspect failing mid-stop is a second one.

## 2. Measure first

- Add a permanent log line to `reconnect()`, which the product should have anyway, at `info`:
  `reconnection: container <short id> is <status|missing|unreachable>, <same start|another start>, server <alive|down|not checked>: <outcome>`.
  Check that no other log line gives the same facts.
- With dike's rows from #1159 (stop, pause and remove), run each five times and collect `containersLogSince`'s
  reconnection lines with their times. Collect core's dialog with `waitForDialog` and its time too. Put the table in
  the PR: for each run, the sequence of outcomes and whether and when the dialog showed.

## 3. Fix

Decide from §2's table and say which in the PR. These options are in daedalus's order of preference:
- **(a) A container that is stopping counts as gone.** When the held relay has closed and the container is still
  `running` with the same start, poll `docker inspect` for up to the stop grace (a constant, 10 s, with a comment
  citing Docker's default). If it turns not-running, answer `containerGone`. If it's still running at the end, keep
  today's rule. That gives 6.4's dialog on the first re-resolve that follows a stop.
- **(b) Wait for Docker's own end.** Hold the re-resolve on `docker wait <id>` bounded by the same constant. That's
  equivalent but costs a process.

Constraints:
- A paused container (6.5) must still give `transportLost`, so its countdown loop and the "Attempting to reconnect"
  dialog (AC-10, AC-23) stay. A **running** container whose server merely restarted must still reconnect (F-0409's
  other rows).
- A removed container (6.6) is `missing` and gives `containerGone` at once. Check it in §2.
- The relay's "closed" fact is `relay.onClosed`. Keep it on `Held` as a flag, not a new subscription per resolve.
- If §2 shows the cause is elsewhere (for example the host's queue, or core never re-resolving within the row's
  time), stop and report the table. That's a design question.

## 4. Rows

- **Unit** (`connector.test.ts`, `reconnection.test.ts`):
  - a re-resolve with the relay closed and a container that turns `exited` on the second inspect answers
    `containerGone`, with the polling bounded;
  - one that stays `running` past the bound keeps today's outcome;
  - `paused` still gives `transportLost` at once;
  - the log line for each outcome.
- **Acceptance:** dike's rows on #1159 for F-0409 AC-8, AC-10 and AC-23 (they're on that PR: coordinate with dike
  through hermes, so that either #1159 waits for this card or this card adds them after #1159 merges). Each must pass
  **five runs in a row** of its launch. Paste the five summary lines.
- **Coverage:** AC-8, AC-10 and AC-23 go from `todo` to `acceptance` with those rows.

## 5. Done when

All gates, with connector.ts and reconnection.ts at 100 %, the whole diff linted, and `jscpd`, `knip` and
`check-coverage` clean. PR title: `remote-containers: a stopped container's window gets core's "Cannot reconnect"
dialog on the first re-resolve (card containers-61, #1162)`. Request athena only.
