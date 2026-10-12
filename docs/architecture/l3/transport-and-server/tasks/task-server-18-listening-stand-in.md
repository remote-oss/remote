# Task card server-18: a stand-in server that accepts connections on its port

Why: #140 part F, ruled on #253 Q14. The end-to-end connect needs a server that the window tunnel can reach. The
acceptance harness's stand-in server (`tests/acceptance/server/stand-in-server.ts`, behaviour `serving`) prints the
ready line with its port and then sleeps: nothing listens on that port. So the tunnel's readiness probe through the
connection's SOCKS relay would never connect, and a whole connect against the harness host would fail in the tunnel
step. This card adds a behaviour that really listens on the loopback port it reports. The host image (Alpine 3.22,
BusyBox 1.37) has `nc` with a persistent listen mode. Checked on the pinned image: `nc -lk -p 23456 -s 127.0.0.1 -e
/bin/cat` echoes for each of two connections. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `tests/acceptance/server/stand-in-server.ts` | `StandInBehaviour` gains `'listening'`; its launcher (section 2) |
| `tests/acceptance/server/start.test.ts` | the rows of section 3 |

Nothing else.

## 2. Contract

The `listening` launcher is the `serving` launcher (its option lines, its port choice from `--port`, a range's lower
end, or a random port for `0`), with its last part changed. After printing `Extension host agent listening on $PORT`,
it runs the listener **as a child** and waits for it, in place of the `while :; do sleep 1; done` loop:

```sh
nc -lk -p "$PORT" -s 127.0.0.1 -e /bin/cat &
wait
```

So the port it reports accepts connections on the host's loopback, each one echoing what it is sent, until the server
is killed.

**Not `exec nc`** (amended 2026-10-12, selene's finding on #140, ruled by daedalus). The lifecycle's `stop_servers`
kills a recorded PID only when the live process's command line still contains `$DATA_DIR/bin/` (`is_server_process`).
That guard is right: a `.pid` file can outlive its server and its PID can be reused, and killing by PID alone could end
an unrelated process of the user. A real server keeps its install path in its command line (the editor's runtime with a
script under `bin/<commit>/`). A launcher that `exec`s a bare binary does not, so to the guard it looks like a
recycled PID, and the kill skips it. With the listener as a child, the recorded PID stays the launcher (`/bin/sh
…/bin/…/stand-in-server`), the guard passes, `pkill -P` ends `nc`, and the kill ends the launcher. Checked on the
pinned Alpine image: after `pkill -P <launcher>` and `kill <launcher>`, `nc -w1 127.0.0.1 <port>` exits 1.

Share the common lines with `SERVING_LAUNCHER` (build both from one list and a final part), so jscpd stays at 0
clones. `LAUNCHERS` gains `listening`.

## 3. Test table

One assertion per `it`; the cite starts the name. Each row installs the `listening` archive and starts it with the
lifecycle helpers the existing `start.test.ts` rows use (`parametersFor`, `runStep`, the started server's port). Then
it checks on the host over SSH (`host.onHost` runs as the user `harness`).

| Cite | Given | Expected |
|---|---|---|
| #140 part F | a started `listening` stand-in | the start reports a port (as the `serving` rows do) |
| #140 part F | the same, then `printf 'ping\n' \| nc -w 2 127.0.0.1 <port>` on the host | the output is `ping` |
| #140 part F | the same, a second time | the output is `ping` again (the listener persists) |
| contracts §S9 | the same, then the lifecycle's `kill` | afterwards `nc -w 1 127.0.0.1 <port> </dev/null` on the host exits non-zero (nothing listens) |

The existing `serving` rows stay as they are.

## 4. Rule for the worker

As card log-01. `pnpm test:acceptance:server` is the gate for these rows (it needs Docker). The lifecycle is not changed
(section 2: its guard is right).

## 5. Gates and review

PR title `tests: a stand-in server that accepts connections on its port (card server-18, #140 part F)`.

## 6. Open rows

None.
