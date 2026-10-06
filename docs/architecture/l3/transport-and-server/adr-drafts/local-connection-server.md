# ADR-NNNN: One detached local connection server per host string, shared by windows through leases

- Status: proposed (draft by `remote-architect-worker-1` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead. The Windows open points need a lab run, which `remote-development` grants.
- Scope: `lib-ssh` (S9, S7), `remote-ssh`
- Requirements:
  - remote-ssh F-2102 (BR-2 to BR-8, Q1, Q3), F-2103 BR-9, F-2104 BR-1 and BR-8, F-2306 BR-9 to BR-11, F-2305 BR-8,
    F-2408, F-2505 BR-1;
  - ADR-0002 rule 8 (no native modules); ADR-0004.

## Context

With `remote.SSH.useLocalServer` on, the default, every window of a host shares one `ssh` login, also across reloads
(F-2102 BR-2, F-2306 BR-11). The helper outlives the window that starts it and ends 2 to 4 seconds after the last
window (F-2102 BR-3). A question `ssh` asks while one window owns the login is mirrored to every waiting window, and
the first answer wins (F-2102 BR-4). An extension host cannot hold that state: each window has its own, and a reload
restarts it.

## Decision

1. **The helper.** A helper per host string, exactly as written, runs our own bundled script on the editor's own Node
   runtime. It is started detached by the first window's extension host and owns:
   - the `ssh` child with the SOCKS forward;
   - a control endpoint;
   - the askpass endpoint.

   No native module and no second binary are involved.
2. **Leases.** A window holds a lease, which is an open connection to the control endpoint. The helper ends a grace
   period after its last lease closes. The grace carries a reload and stays within F-2102 BR-3, and a conformance
   timing case checks both.
3. **The record.** It lives in the extension's global storage under the host string: process id, endpoint, SOCKS
   port, and the server details later windows reuse (F-2102 BR-6). It is written only after the connection completes.
   A record whose helper does not answer is stale, deleted, and replaced by a new helper.
4. **Prompts.** Every `ssh` question goes through the helper. The owner lease is asked; waiting leases see STR:S157
   and a mirror. The first answer goes to `ssh`, and ownership passes to the oldest waiting lease when the owner gives
   up or leaves (F-2102 BR-5). No answer is stored anywhere (F-2306 BR-10).
5. **Install and start.** The helper serialises them, so joined windows use the owner's server instance (F-2102 Q3,
   option b).
6. **How it ends.**
   - On the last lease plus the grace.
   - On Kill Local Connection Server, at once and silently.
   - On `ssh` exit: `transportLost` goes to every lease, the record is deleted, and the next attempt connects afresh
     (F-2505 BR-1).
   - When the editor quits, through the leases closing.
7. **Endpoints.** Unix sockets with mode 0600 in the user runtime folder. On Windows, named pipes restricted to the
   current user, pending the lab run of F-2102 Q1.

## Options considered

| Option | For | Against |
|---|---|---|
| A detached helper with leases (chosen) | Survives reloads and window closes; one owner of the login; nothing stored but the record | A process of our own to keep alive and secure; a grace time to tune |
| The user's OpenSSH `ControlMaster` only | No process of ours | Not on Windows OpenSSH; the user's config may set it differently; no prompt mirroring between windows (F-2102 BR-11 leaves ControlMaster to the user) |
| Global-state hand-over between extension hosts, as the reference's state suggests | Matches the reference's footprint | Polling and races between windows; the `ssh` process still needs an owner that outlives a reload |
| One `ssh` per window | Simplest | Contradicts F-2102: one prompt per window and per reload |

## Consequences

- Prompt mirroring, joined connects and Kill have one implementation.
- The helper is a client-side program of ours (ADR-0002's open item "programs of our own" is answered for the client:
  a script run on the editor's runtime).
- A per-profile record means two profiles run two helpers, as in the reference.
- Windows clients need the named-pipe and askpass checks before the contract is final.

## Check

Conformance cases for these (F-2102 VS-1 to VS-5):
- the reload within the grace, with no new login;
- the helper's end 2 to 4 seconds after the last window;
- the mirrored prompt and the first answer winning;
- Kill reconnecting every window;
- a stale record replaced.

Plus a unit test of the lease and ownership state machine on a fake endpoint.
