# Coding brief (draft): remote-explorer and lib-companion

Status: draft by `remote-architect-worker-2`, 2026-10-06. It is ready for the lead's review and is meant to start
when remote-ssh-edit ships. The design is in `components.md` (lib-companion, remote-explorer), and the contracts are
`contracts.md` §4 (lib-companion) and §3.3 and §3.4 (opener and gate). The ADRs that bind it are 0002, 0003, 0007 and
the drafts "Identifier tables" and "Stand-down gating".

## What is built, in this order

1. **`lib-companion`**:
   - the versioned envelope;
   - the caller with its 10 s limit;
   - the server wrapper with the foreign-payload rule;
   - fire-and-forget;
   - detection across hosts, with the silent same-host fallback;
   - the endpoint id lists;
   - `docs/companion-interface.md`, written from F-5902 §5;
   - the recording fake, as a test fixture only.

   It owns F-5902 (36 ACs).
2. **`remote-explorer`**, seven components that own nine features:

| Feature | Component | ACs |
|---|---|---|
| F-5001, F-5002, F-5901 | `explorer.package` | 26, 19, 19 |
| F-5101, F-5301 | `explorer.targets-view` | 44, 28 |
| F-5102 | `explorer.ssh-group` | 54 |
| F-5103 | `explorer.connect-actions` | 40 |
| F-5104 | `explorer.recent-folders` | 52 |
| F-5201, F-5202 | `explorer.tunnels-group` | 39, 46 |

The seventh component, `explorer.inbox`, owns no feature: it serves `setActiveFolders` and `sshHostsChanged`.

Two entry points, `main` and `browser`. In both, the bundle includes no area A library.

## Libraries and the contract subset

| Library | Subset used |
|---|---|
| `lib-identifiers` | the generated table, `registerCommands` (the 13 hidden commands, F-5002), `setContextKey` |
| `lib-standdown` | the guard with `ms-vscode.remote-explorer` and the explorer's standing-down key |
| `lib-companion` | all of it |
| `lib-authority` | the proposed-API gate only (`contribViewsRemote`, `extensionsAny`). Connect actions go through the companions' open commands, never through the window opener (F-5902 §5) |

Two edges of the container view are not used:

- `lib-log`: the explorer has no output channel (F-5901 §6). The companion version-mismatch hook is left empty.
- `lib-product`: no explorer feature reads `urlProtocol`.

I propose removing both edges.

## Acceptance

- **No conformance suite exists yet** for remote-explorer. The target is the ACs above (403 as numbered, including F-5902; a few are marked removed in their issues), proved by
  integration tests in the editor's harness against the recording fake. The fake can play both the SSH companion
  and the tunnels companion. The cases come when the room publishes its suite.
- **The real companions do not exist yet.** Our remote-ssh is not built, and the tunnels client is frozen pending
  the user. Every group is therefore built and tested against the fake only. That is the design: the explorer never
  depends on a companion's code.
- **Blocking for conformance later:** the runner enables no proposed API, and the explorer needs
  `contribViewsRemote` for its view to exist at all. This is with `remote-development` for the kit owner.

## Open before coding (through the lead)

Settled by the explorer room's republication (2026-10-06):

- WSL rows follow F-5202 3.3: one "WSL" row per online Windows tunnel machine. The generic connect pair uses the
  default distro, and the distro pair asks for one. F-5104, F-5002, F-5201 and F-5301 are aligned.
- The companion interface, explorer side: see `contracts.md` §6 (two `setActiveFolders` callers, host key, no
  configFile signal, first-recorded tunnel history, the `folder-active` mark from `getActiveRemote`).
- The key is `remote-explorer.standingDown`. Every gated entry is `when: <reference clause> &&
  !remote-explorer.standingDown`, visible by default, with no added activation.

Still open: the F-3906 side of the interface (remote-ssh#83). The interface document is frozen at 1.0 when it
lands.
