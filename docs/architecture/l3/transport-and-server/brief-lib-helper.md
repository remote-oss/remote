# Coding brief: lib-helper (slice 1, build-order step 7)

> Issued by `remote-architect` 2026-10-07; the PM allocates the seat. Design: `contracts.md` §9 (X1 helper-client,
> X2 helper-runtime, X3 registry) and `adr-drafts/` "detached helper". Binding: ADR-0002, 0003, 0007, 0008. One
> Claude task; the pure parts (X3 decisions, the lease state machine, the end policies) may become local-worker
> cards once the package shape exists.

## What is built

`packages/lib-helper`, consumers `lib-ssh` (S9), `remote-containers` (the shutdown watchdog) and, if its design
survives, `remote-server`. Depends on `lib-log` only (a logger passed in; the helper itself logs to its own file).

| Piece | Content |
|---|---|
| `src/index.ts` | The contract surface: `acquire`, `release`, `request`, `events`, `stop` (X1); the end-policy types; the record and lease types |
| `src/runtime/` | X2 `serve`: endpoint listener, hello with nonce check, leases in arrival order, message dispatch to the consumer's handler, end policies as data (`graceAfterLastLease`, `delayedCheckAfterLastLease`, `idleAfterLastLease`), exit; bundled into each consumer's helper script by esbuild as a separate entry |
| `src/registry/` | X3: `claim` by atomic exclusive create, `isStale` from one hello exchange, record shape (endpoint, nonce, pid, started-by, payload); file access through a port |
| `src/endpoint/` | The endpoint port: Unix socket mode 0600 in the runtime folder (temp folder on macOS); the Windows named-pipe form behind the same port, marked provisional (lab) and left unimplemented with a clear failure until the Windows run |
| `src/testing/` | A fake clock, a fake endpoint pair (in-process), a recording consumer handler |

## Behaviour to get right (each a named test)

- **Atomic claim and race.** Two acquirers for the same key: exactly one `claimed`, the other joins with the winner's
  record; a stale record (no hello answer within the limit) is replaced once and never in a loop; a third acquirer
  during the replacement joins the new helper.
- **Leases.** Numbered in arrival order; the oldest live lease is first; `release` and a closed connection are the
  same event; `leaseListChanged` reaches every live lease; `startedByMe` true only for the acquirer whose claim
  spawned the helper.
- **End policies, with the fake clock.** Grace: the helper ends `ms` after the last lease closes and a new lease
  within the grace cancels the end (the SSH value must carry a reload: a release followed by an acquire within 2–4 s
  keeps the helper); delayed check: after `ms` a second check runs, then the consumer's action, then the end; idle:
  as grace with its own value. A helper never runs without a policy (construction fails).
- **Hello and nonce.** A hello without the record's nonce is refused and the connection closed; the record carries no
  secret beyond the nonce; prompt answers or credentials never enter a record (a type-level rule plus a test that
  the record serializer rejects unknown fields).
- **Requests.** `request` returns the handler's reply; `timeout` is the caller's; `helperGone` on a closed endpoint;
  `stop` ends the helper and is a no-op when nothing runs.
- **Process rules.** Detached, no console window, stdio closed, run on the editor's own runtime from a bundled
  script; no TCP listener; never another user. These are asserted on the spawn specification (a fake spawner records
  the options), not by spawning in unit tests; one integration test spawns a real helper under the editor's Node
  and exercises claim, lease, grace end.

## Acceptance (unit now; harness later)

No slice-1 acceptance criterion names the helper directly; its behaviour is proven through S9's criteria (F-2102:
one connection server per host string, shared across windows and reloads, Kill Local Connection Server) once S9
exists. Until then: unit coverage at the ADR-0003 gates and the one integration test above.

## Done

Gates green; the library convention (index as the contract surface, `./testing/*` subpaths); no origin framing or
ids in comments or README (ADR-0008); the PR body answers R1–R6 and lists the Windows named-pipe form as provisional.
