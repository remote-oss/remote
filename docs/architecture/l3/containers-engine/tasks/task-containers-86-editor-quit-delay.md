# Task card containers-86: the editor takes about 56 s to quit after a launch that connected a container

Containers release 1. Size: M. Builder: `task:claude`. Found by proteus on the `@containers` CI part (run 39425520701,
ci-2, main 51dac8a). After its rows, every launch that connects a container takes about 56 s to quit the editor:
`containers`, `containers-trust` and `containers-volume`. The launches that never connect one (`containers-standdown`,
`containers-no-proposals`) quit at once. `containers-volume` went just over the harness's 60 s grace, so the harness
ended it and failed the launch although its 9 rows passed. proteus is raising the grace to 3 min, but 56 s points at
something of ours holding the quit.

## 1. What is known (daedalus, reading main)

- Dev Containers has no `deactivate`. Its disposables (`context.subscriptions`) are the registrations, so the
  extension does no work of its own at shutdown.
- **Candidates that outlive a window:**
  1. the Dev Containers view's long-running `docker events` process, spawned through `engine/node-engine-host.ts`
     `spawn`. It's killed on its cancellation, but is anything cancelling it when the window closes?
  2. the connection's exec relay, a `docker exec` per channel (`exec/exec-channel.ts`). Does core's remote extension
     host shutdown wait for a channel that our relay never closes?
  3. a CLI process (`cli/node-cli-host.ts`) still running.
- The near-60 s length suggests core waiting for a timeout. Find which one in [oss] 1.139.1: the remote extension
  host's shutdown handshake, or the window's `onWillShutdown` joiners.

## 2. Measure, then fix

1. Locally, run `node tools/acceptance.ts --editor vscodium --launches containers-volume`, the shortest of the three.
   Time from the harness's quit request to the editor's exit (the harness logs both; read
   `tools/acceptance-plain.ts`).
2. At the quit request, record the process tree under the editor's main process (`ps -eo pid,ppid,etimes,args`), and
   which of those processes are still there 10, 30 and 50 s later.
3. Add a temporary log line at each candidate's end (the events process, each exec channel, each CLI run), and see
   which one ends last, just before the editor exits.
4. **Fix it at the cause:**
   - a process of ours that nothing ends: end it when its window's extension host stops. Use a disposable in
     `context.subscriptions` that cancels the view's watch and closes the open channels, with a unit row each;
   - a core wait we can't shorten: comment here with the [oss] lines and stop. Don't hide it with a shorter harness
     bound.

## 3. Done when

- The three launches' editors quit in under 10 s after their rows, in two local runs each. Paste the timings.
- All gates pass.
- PR title: `remote-containers: a window that connected a container quits without waiting (card containers-86, #1274)`. Request athena only.
