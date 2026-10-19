# Task card containers-43: F-0502's resolver and connection rows and tags (containers release 1)

Issue: #1053. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude` (iris, after
containers-41, #1050). The method is containers-41's (#1050) §1, §3 and §6; this card gives only what is F-0502's
own.

**What this card is:** every F-0502 line of `docs/architecture/catalogue/coverage-containers-r1.tsv` that is `todo`
(31 today) ends with a final tag, and every criterion this release builds gets the row that proves it.

Sources: F-0502 (remote-oss/remote-containers#57), all of it; `brief-release-1.md` §2 and §3 rulings 1 (the
transport: the server on the container's loopback, the host relay, a plain `ResolvedAuthority`), 2 (the connection
token never in argv or the environment) and 11 (telemetry off); `contracts.md` (this folder), C10 behind
lib-authority's resolver host; cards containers-08 (C10) and containers-19 (reuse and restart by id).

## 1. How our decisions read F-0502 (no judgement left here)

1. **The transport is brief ruling 1's.** A criterion that names a published container port, a tunnel factory or
   tunnel features is read against the relay: the host listens on `127.0.0.1` on the server's port number when free,
   else another, and the log names both. Rows assert our log lines (`packages/remote-containers/src/connect/
   host-relay.ts`), not the reference's.
2. **The token** (ruling 2): a row that inspects the server's process asserts that its argv and environment carry no
   token value (`docker exec <id> cat /proc/<pid>/cmdline` and `environ`), and that the server reads
   `--connection-token-file`.
3. **Telemetry:** F-0502 AC-15 expects telemetry on; R-28 and ruling 11 keep it off. Tag AC-15 `acceptance` against
   our behaviour, with the row named `F-0502 AC-15 (R-28, ruling 11): …`, asserting `--disable-telemetry` on the
   server's command line. That the spec text differs is already athena's spec question (brief ruling 11).
4. **The shutdown half is increment 2** (F-0417, F-0502 BR-10): a criterion that needs the container stopped when its
   last window closes is `deferred` with `containers release 1: increment 2 (shutdown)`.
5. **The full contribution set** (brief ruling 8): F-0502 AC-34 and AC-37 are `deferred` already; leave them.
6. **Reuse and restart by id** are containers-19's rows (gate rows 3 and 4, on main): cite them, don't duplicate.

## 2. PRs

(a) resolve, reload and the reuse of a running server; (b) the transport, the token and the log; (c) reconnect and
the give-up rules. Each PR moves only its own lines of the coverage file. Folder names start `c43-`. PR titles:
`tests: F-0502's <subject> rows (card containers-43, #1053)`. Request athena only; hermes assigns the peer.

## 3. Gates and open rows

As containers-41 §5 and §6. A give-up or reconnect criterion that needs the network between the host relay and the
container cut: use `docker network disconnect` on the container, never on the engine's default bridge as a whole.
