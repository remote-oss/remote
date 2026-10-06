# The local connection server (component A3)

- Status: draft for the lead's review
- Date: 2026-10-06
- Requirements: F-2102 (ssh#20), F-2103 BR-9 (ssh#21), F-2104 BR-1 and BR-8 (ssh#22), F-2306 BR-9 to BR-11 (ssh#39),
  F-2408 (ssh#53), F-2505 BR-1 (ssh#63)

**What it is.** With `remote.SSH.useLocalServer` on (the default), one helper process per host string holds the one
`ssh` connection that every window of that host uses (F-2102 BR-2). It is our own program: a script bundled in the
extension and run by the editor's own Node runtime as a detached child of the extension host that starts it. No other
binary is involved. The helper owns three things:

- the `ssh` child with its SOCKS forward (F-2104 BR-1);
- a control endpoint, which is a Unix socket in the user runtime folder with mode 0600;
- the askpass endpoint for that `ssh`.

Its record lives in the extension's global storage under the host string. The record holds the helper's process id,
the control endpoint, the SOCKS port, and what a later window needs to reuse the server: remote port, operating
system and architecture, temp folder and connection token (F-2102 BR-6). The record is written when the first connect
completes, never while the login is pending (F-2102 BR-6, 7.E7).

**Built on lib-helper** (lead's ruling 2026-10-06): the helper, leases, registry and grace are lib-helper's
(`contracts.md` §9). This note keeps what is SSH's own: one helper per host string, the record's contents, login
ownership and the prompt hand-over.

**Lifetime.**
- *Leases.* Every window that uses the connection holds a lease, which is an open connection to the control endpoint.
- *Starting.* The first window starts the helper.
- *Joining.* A later window, or the same window after a reload, finds the record, checks the helper is alive by
  connecting and exchanging one message, and takes a lease. A record whose helper does not answer is stale: it is
  deleted and a new helper starts (F-2102 7.E5).
- *Ending.* The helper ends a short grace after its last lease closes. The spec observed 2 to 4 seconds (F-2102
  BR-3). The same grace must also carry a window reload: F-2103 BR-9 and F-2306 BR-11 require that a reload asks for
  no new login. The grace value is therefore a contract item with a conformance check, not an implementation detail.
  It is open point 1.

**Ownership across windows.** The window whose lease started the helper owns the login. Every question `ssh` asks
comes through the helper's askpass endpoint:

- The helper sends the question to the owner and mirrors it to every waiting lease. Waiting windows show
  "Waiting for other windows to connect" (STR:S157).
- The first answer from any window is passed to `ssh`, and the other prompts close (F-2102 BR-4).
- If the owner cancels, its lease closes, or its login fails, the oldest waiting lease becomes the owner with a fresh
  helper (F-2102 BR-5).

Keeping the hand-over inside the helper replaces the reference's global-state entries. F-2306 BR-9 allows this,
provided no answer is ever stored. The helper also serialises the server install and start, so joined windows get the
owner's server instance. That is option (b) of F-2102 Q3 and removes the "Cannot reconnect" case of 7.E3.

**How it dies.**
1. The last lease closes and the grace runs out: normal end.
2. "Kill Local Connection Server For Host..." ends the `ssh` and the helper at once and deletes the record (F-2102
   BR-7, BR-8). It never touches the VS Code Server on the host or the user's own ControlMaster.
3. The `ssh` child exits, for example on a network loss or `ChannelTimeout`. The helper reports `transportLost` to
   every lease, deletes its record and exits. Core's next attempt then makes a fresh connection (F-2505 BR-1).
4. The editor quits: every lease closes, so case 1 applies.

A helper is never orphaned by a crashed extension host, because a crash closes the lease socket as well.

**Open points.**
1. **Grace length.** The value must carry a reload without exceeding F-2102 BR-3. It needs a timing case in the
   SSH suite.
2. **Windows clients (F-2102 Q1), provisional (lab) under D-60.** Unix sockets in a runtime folder do not exist there. The control and askpass
   endpoints become named pipes restricted to the current user. Several things need a Windows lab run before this
   contract is final:
   - whether Windows OpenSSH runs an `SSH_ASKPASS` program that is a script rather than an `.exe`;
   - how a detached helper survives its extension host;
   - that the user's `ControlMaster` is ignored there.
3. **Shared state across profiles.** The record sits in per-profile global storage, as the reference's does. Two
   profiles on one host therefore run two helpers. This is accepted unless the lead wants one per machine.
