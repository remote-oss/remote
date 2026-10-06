# ADR-NNNN: One detached-helper pattern (lib-helper) for client-side processes that outlive a window

- Status: proposed (draft by `remote-architect-worker-1`, reviewed by `remote-architect-worker-3`, for the lead,
  who assigns the number). The pattern itself was ruled by the lead on 2026-10-06.
- Date: 2026-10-06
- Deciders: the lead
- Scope: `lib-helper` (new), `lib-ssh` (S9), `remote-containers` (the watchdog of F-0417), `remote-server` (T2, if the
  relay stays)
- Requirements:
  - remote-ssh F-2102 BR-2 to BR-6;
  - remote-containers F-0417 AC-43;
  - remote-server F-8103 BR-6;
  - ADR-0002 rule 8 (no native modules);
  - the ADR draft "Local connection server".

## Context

Three consumers need a process on the client that outlives the extension host of the window that starts it, is
shared by several windows, and ends by a rule:
- **SSH** keeps one `ssh` per host string across windows and reloads.
- **Dev Containers** stops a container once every window using it is gone, after a delayed check.
- **Tunnels** may keep a relay per profile.

Written three times, the same lease counting, stale detection, race handling and endpoint security would drift
apart, and ADR-0003's rule on duplicated code forbids it.

## Decision

1. **One library.** `lib-helper` provides three parts:
   - the client side (acquire, release, request, events, stop);
   - a runtime bundled into each helper script;
   - a registry.

   Consumers supply only a message handler and a record payload.
2. **The process.** A helper is a script in the VSIX, run on the editor's own runtime, detached, with stdio closed.
   No native module, no binary, no TCP listener.
3. **Leases.** A lease is an open connection to the helper's endpoint. A crashed extension host releases its lease
   by the socket closing. Leases are ordered by arrival, and consumers build ownership on that order.
4. **End policies are data:** `graceAfterLastLease`, `delayedCheckAfterLastLease` with an action, and
   `idleAfterLastLease`. A consumer that needs another rule asks for a new policy value, never a branch.
5. **The registry.** It sits in a folder the caller chooses: per profile (the extension's global storage) or per
   user (shared across profiles and editor instances, as the watchdog needs).
   - Claims are atomic exclusive creates, and the loser joins the winner.
   - A stale record is replaced once.
   - A per-helper nonce authenticates the hello.
6. **Endpoints.** Unix sockets with mode 0600, or named pipes restricted to the current user. The Windows form is
   provisional (lab) under D-60.

## Options considered

| Option | For | Against |
|---|---|---|
| One library with end policies as data (chosen) | One implementation of the hard parts; pure tests with a fake clock | A small protocol of our own; one more library in the graph |
| One helper per consumer | Each tuned freely | Three copies of lease, race and security code |
| No helper: global state shared across windows | No process | Cannot own an `ssh` or stop containers after the last window dies; polling and races |

## Consequences

- The container view gains `lib-helper`, with edges from `lib-ssh` and `remote-containers`, and from
  `remote-server` if the relay stays.
- S9's ADR draft keeps only what is SSH's own: the record, login ownership and prompt hand-over.
- Windows clients need one lab run for the endpoint and detachment before the contract is final.

## Check

- Unit tests of the lease state machine and each end policy, with a fake clock and endpoint.
- A race test of two simultaneous claims.
- The conformance timing cases of F-2102 (reload within the grace; the end 2 to 4 s after the last window) and
  F-0417 AC-43.
