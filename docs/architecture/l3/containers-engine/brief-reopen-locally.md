# Brief: F-0406, leaving a dev container (Reopen Folder Locally, in SSH, in WSL, in Tunnel)

Owner: athena (architect). Issue: #1204 (daedalus's request, comment 6580567864). Spec: remote-oss/remote-containers#68
(F-0406). Decisions: D-105 (no deferrals; host-only rows wait for a host, ADR-0013), ADR-0010, R-46, R-27.

## 1. Why now

`remote-containers.reopenLocally` has no handler, and three criteria of families already in release 1 wait on it:
- F-0101 AC-7;
- the second half of F-0301 AC-48 (the discovery notification comes back after Reopen Folder Locally);
- the shutdown AC-62 of containers-69.

So it moves ahead of Compose in plan #1807.

## 2. The four decisions

1. **The component: C6 open-flows, on lib-authority's existing opener.**
   - C6 already reloads this window into a container through lib-authority's opener. Leaving a container is the same
     motion in reverse, so C6 takes the four commands.
   - The part shared across extensions (F-0406, F-1301, F-1302, F-6204, F-6701) is the opener: `openLocalCommand` and
     `openRemoteCommand` in lib-authority. That's already shared, so there's no new library code and no new component.
   - The origin is per extension, because each owns its payload: remote-containers owns `dev-container` (contracts §3).
     This settles the catalogue's `containers.reopen-origin` candidate: the opener is shared, and the origin is the
     payload owner's.
2. **The origin is decoded from the window's own `dev-container+<hex>` authority, never stored.**
   - BR-7 and AC-14 forbid new state. The payload already names the origin: `hostPath` and `configFile`.
   - A pure `originOf(target)`, next to the codec in `authority/payload.ts`, gives one of:
     - `local` with the folder: `configFile` is a `file` URI;
     - `ssh` with its authority and path: `vscode-remote` with an `ssh-remote+` authority;
     - `wsl` or `tunnel` likewise;
     - `none`: a target with no host counterpart (a volume clone, once volumes exist).
   - BR-13: the origin is always the payload's `hostPath`, never the folder the window shows now. So after File > Open
     Folder inside the container, the command still reopens the host folder (AC-34). It maps nothing back.
3. **No explicit `leave`: the shutdown helper sees the window's lease end at the reload.**
   - C6's rebuild sends `leave` before it reloads, because it always reloads. This command doesn't always reload.
   - When the origin is already open in another window, core focuses that window instead (7.E9, `vscode.openFolder`'s
     one-window-per-folder rule [oss]). The container window stays connected, and its container must keep running.
   - A `leave` sent first would end its shutdown registration under a window still using it. So the command hands the
     opener the target and lets the reload end the lease. The registry's `leasesChanged` then ends the connection,
     and F-0417's `shutdownAction` takes it from there:
     - the container is stopped, not removed (AC-3);
     - `none` leaves it running (AC-26);
     - a failed SSH reconnect still stops it (BR-6), because the lease ended at the reload.
4. **The cut, by what can exist today.** A window kind no release-1 flow can open can't be tested, so each part comes
   with its family. Every row is written now, and none is a permanent deferral (D-105).

   | Part | Criteria | When |
   |---|---|---|
   | Reopen Folder Locally from a local-Docker folder window; its availability and label; Close Workspace (core's `workbench.action.closeFolder`) and the no-folder no-op; Close Remote Connection (core); the out-of-context rule | AC-1, 2, 3, 8, 9, 12, 14, 15 (local half), 18, 20, 22, 23 (local half), 24, 26, 32, 33, 34, 36 | **now** (this brief's card) |
   | Reopen Folder in SSH, from a container-on-SSH window | AC-4, 5, 15 (SSH half), 19, 37 | with F-1302 (engines over SSH), plan group 10 |
   | S009 and S010 in volume windows; the four-button dialog's Close Remote | AC-6, 7, 10, 11, 13, 23 (volume half), 35 | with volumes and Clone in Volume, plan group 7 |
   | Workspace windows keep "Folder" and reopen the workspace | AC-30, 31 | with multi-root, plan group 4 (the payload then carries the workspace file) |
   | Reopen Folder in WSL; the dual availability; executeInWSL | AC-16, 27, 28, 29 | built with F-1301; rows `deferred`, `host: windows` (ADR-0013) |
   | Reopen Folder in Tunnel | AC-17, 25 | with Remote - Tunnels (D-101's answers) |

## 3. What the card builds (the "now" row)

- **The manifest:** the four commands, each labelled exactly as F-0406 3.1 has them (AC-18: "Reopen Folder Locally",
  capital L). Their palette, remote-indicator and Dev Containers row-menu entries are gated on `canReopenLocally`,
  `canReopenInSSH`, `canReopenInWSL` and `canReopenInTunnel` and `!hideConnectCommands`. "Close Workspace" in the row
  menu invokes `workbench.action.closeFolder` (BR-10); it's no command of ours. All four commands have handlers, so
  none is contributed without one (D-86's principle).
- **The context keys:** set once in a dev-container window, from `originOf` of `env.remoteAuthority`'s payload. Exactly
  one is true for a resolved origin (BR-2), and none in a local, SSH or attached window (AC-12).
- **The handlers (R-46: never trusting `when`):** each one decodes the window's payload again and decides:
  - **no folder open:** nothing at all (AC-8, BR-13 after Close Workspace);
  - **an origin of the command's own kind:** the opener's command, same window, `reuseWindow` (AC-22). The folder is the
    origin, never the open path;
  - **a local-Docker window, but SSH, WSL or Tunnel invoked:** S010, S012 or S011 as an information message with no
    buttons, and nothing else (AC-32);
  - **a window that isn't a dev container:** nothing; no Docker call is made (AC-33);
  - **an origin of `none`:** S009 or S010, when volumes exist.
- **Nothing written, nothing logged:** no state of ours (AC-14, BR-7), and no log line of the command's own (BR-8). The
  target window's connect logs as usual.
- **The rows:**
  - **Unit:** `originOf` for every URI shape and a malformed payload; the context-key table; each handler branch,
    with fakes for the opener and the notifier.
  - **Acceptance, in the containers launch:**
    - AC-1, 2 and 22 (the same window, the title without the suffix, the default local indicator, the F-0402
      notification back);
    - AC-3 (the container `Exited (0)` within 30 s);
    - AC-26 (`shutdownAction: none`, still `Up` after 40 s);
    - AC-34 (open a subfolder inside, reopen the origin);
    - AC-36 (two windows: the second's reopen leaves it connected, the container `Up`, no new window);
    - AC-8 and 24 (Close Workspace, then a silent no-op);
    - AC-14 (the state databases before and after);
    - AC-32 and 33 (keybinding invocations).

## 4. Boundaries

- **Not ours:** the reload itself and the remote indicator's rendering (core, BR-9); the container's stop (F-0417, by
  the lease); the target window's connect (F-0408); the F-0402 notification (C6's existing flow).
- **ADR-0010** doesn't apply: nothing is read from a program's output.
