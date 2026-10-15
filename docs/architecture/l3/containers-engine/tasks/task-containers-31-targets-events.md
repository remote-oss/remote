# Task card containers-31: the Dev Containers view follows Docker's container events and the `dockerPath` change

Issue: #964. Milestone 0.4. Size: M. Builder: `task:claude`.

**Design:** athena's ruling on #960 ("How the list stays current"; card 2). **Builds after** containers-30 (#963).

Sources: F-0901 (remote-oss/remote-containers#76) 6.21, BR-12, AC-40, AC-44, AC-45, AC-56, AC-57, §16 ("Rebuild
display"); containers contracts (C2's `EngineHost.spawn`).

## 1. The change (`src/explorer/targets-events.ts`, new; wired in containers-30's adapter)

- **The process:** `docker events --filter type=container --format '{{json .}}'` through C2's `EngineHost.spawn`, with
  no shell, on containers-30's engine: the held connection's while C10 holds one, otherwise the one for the current
  `dockerPath`.
  - It runs only while the view is visible: started on `visible: true`, stopped on `visible: false` and on dispose.
  - It's read line by line. Each line that parses as JSON is one event, and the content isn't matched (ADR-0010
    rule 2: the type filter is Docker's).
- **Coalescing:** each event (re)starts a 300 ms timer (F-0901 §16, the reference's 0.3 s). When it fires, the view
  rebuilds once. A rebuild that's running when the timer fires is followed by one more rebuild, never two.
- **A process that ends** (an exit, or an error on spawn): no restart loop. The next rebuild (Refresh, visibility)
  starts it again if the view is visible. An engine that can't be reached shows WELCOME#0 through the rebuild, as
  containers-30 does.
- **AC-40:** nothing rebuilds on a timer. A tooltip's relative time changes only with an event or Refresh.
- **The `dockerPath` change (6.21):** on `onDidChangeConfiguration` for `dev.containers.dockerPath`:
  - **a local window** stops the events process and rebuilds with the new engine. A missing executable gives
    WELCOME#0 within about 3 s, with no notification (AC-44). It restarts the process on the new engine if that
    starts;
  - **a dev container window** (C10 holds a connection) changes nothing: the list reads and the events process keep
    the held connection's engine, so the rows, groups and title actions stay, and a container created afterwards
    still appears (F-0901 6.21 step 4, AC-45; athena on #965). The new value applies in local windows only.

## 2. Rows

### 2.1 Unit (`targets-events.test.ts`, with a fake `EngineHost` and fake timers)

- the argv, and no shell;
- started on visible and stopped on hidden and dispose, once each;
- three events 100 ms apart make one rebuild, 300 ms after the last;
- an event during a rebuild makes exactly one more;
- a line that isn't JSON is ignored;
- an ended process isn't restarted until the next rebuild;
- `dockerPath` changed in a local window: process restarted, rebuild, WELCOME#0 for a missing program;
- in a dev container window, after a `dockerPath` change to a missing program, a fake event still rebuilds through
  the held engine, and the events process isn't restarted;
- no timer-driven rebuild exists (AC-40): advance an hour, no rebuild.

### 2.2 Acceptance (the `containers` launch)

| # | Rows |
|---|---|
| Gate 14 | with the view visible, `docker run -d --label remote-oss.acceptance.run=<id> <image> sleep 600` makes its row appear, and `docker rm -f` makes it go, each within 5 s and with no Refresh (F-0901 AC-56) |
| AC-44 | in a local folder window showing rows, `dev.containers.dockerPath` set to `<run>/no-such-docker` gives WELCOME#0 within 5 s, with no notification. Restore it in `finally` |
| AC-45 | in the dev container window, with its view showing rows, set `dev.containers.dockerPath` to `<run>/no-such-docker`, then `docker run -d --label remote-oss.acceptance.run=<id> <image> sleep 600`: its row appears within 5 s, and no welcome content shows. Restore it in `finally` |
| AC-57 | collapse "Other Containers", run a new plain container: the header stays collapsed (BR-13) |

## 3. Gates and review

Run all gates and the containers launch. PR title: `remote-containers: the Dev Containers view follows Docker's
container events and the dockerPath change (card containers-31, #964)`. Request athena only.

**Open rows (stop and report on #964):**
1. `docker events` on the pinned engine emits lines that aren't one JSON object each.
