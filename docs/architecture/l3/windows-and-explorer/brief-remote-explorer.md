> Issued by `remote-architect` 2026-10-06 to `remote-coding-worker-1`. Settled since drafting: the explorer room republished
> ten issues (F-5902 §5 with RR-1–RR-5 folded; one WSL row per online tunnel machine, F-5202 3.3; extensionsAny always
> requested with the stable same-host fallback; two callers of setActiveFolders; tunnel history first-recorded;
> standing-down key `remote-explorer.standingDown`, `when: <clause> && !remote-explorer.standingDown`, visible by
> default, no added activation). Order: lib-companion first (its PR alone), then the explorer. The F-3906 side of the
> interface (ssh#83) lands as an edit; code the SSH companion calls from F-5902 §5 as republished. Shipped prose per
> ADR-0008; D-59 voice in README, strings, comments.

# Coding brief (draft): remote-explorer and lib-companion

**0.3 cut (athena, 2026-10-13, D-55):** the tunnel rows are out. F-5201 and F-5202 aren't built, there is no
`explorer.tunnels-group`, and no WSL row per online tunnel machine. Every AC of the other features that needs a tunnel
row or the tunnels companion is `deferred` with the reason `D-55: no tunnel rows`. F-5101 is built for its SSH half.

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
2. **`remote-explorer`**, six components that own eight features:

| Feature | Component | ACs |
|---|---|---|
| F-5001, F-5002, F-5901 | `explorer.package` | 26, 19, 19 |
| F-5101, F-5301 | `explorer.targets-view` | 44, 28 |
| F-5102 | `explorer.ssh-group` | 54 |
| F-5103 | `explorer.connect-actions` | 40 |
| F-5104 | `explorer.recent-folders` | 52 |

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

- **No conformance suite exists yet** for remote-explorer. The target is the ACs above, without the tunnel rows (D-55), proved by
  integration tests in the editor's harness against the recording fake. The fake plays the SSH companion (the
  tunnels companion is out with D-55). The cases come when the room publishes its suite.
- **The real companions do not exist yet.** Remote - Tunnels is out (D-55). Every group is therefore built and tested against the fake only. That is the design: the explorer never
  depends on a companion's code.
- **The proposed API (ruled 2026-10-13):** the explorer needs `contribViewsRemote` (and asks for `extensionsAny`) for
  its view to exist at all. It goes through the family's gate, as remote-ssh does: F-3903's route (Option B,
  `--enable-proposed-api` or `argv.json`). connect-31's setup reads every installed `remote-oss.` member's own manifest,
  so the one setup notice covers the explorer too. No new decision: the id is the family's (D-14), and the route is
  decided. The harness's launches enable it for `remote-oss.remote-explorer` as they do for remote-ssh.

## Open before coding (through the lead)

Settled by the explorer room's republication (2026-10-06):

- WSL rows per online Windows tunnel machine (F-5202 3.3) come from the tunnels group and are out with it (D-55).
- The companion interface, explorer side: see `contracts.md` §6 (two `setActiveFolders` callers, host key, no
  configFile signal, first-recorded tunnel history, the `folder-active` mark from `getActiveRemote`).
- The key is `remote-explorer.standingDown`. Every gated entry is `when: <reference clause> &&
  !remote-explorer.standingDown`, visible by default, with no added activation.

**The interface (ruled 2026-10-13, athena):** F-3906 (remote-ssh#83) recommends Option 1, which implements the provider
side of F-5902 §5. That is the only option R-66 allows, and the clean side adopts it. F-5902 (remote-explorer#14) is
reviewed and is the interface's single text, so `docs/companion-interface.md` is written from F-5902 §5 and frozen at
1.0 with lib-companion's card. lib-companion and the explorer build against it and the recording fake now. Only the
**SSH provider side** (remote-ssh's five `remote-internal.*` ids, F-2503 remote-ssh#61) waits: for F-2503's review, and
for F-3906 Q4's check there that the observed facts need no field F-5902 §5 lacks. A field found then is an F-5902
change and a minor version of the interface (1.1), which the versioned envelope carries.
