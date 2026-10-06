# ADR-NNNN: Gate static contributions with a stand-down key that defaults to visible

- Status: proposed (draft by `remote-architect-worker-2` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead. The polarity of the key changes wording in five spec issues, so those revisions go through
  `remote-development` to the rooms. R-54 itself does not fix the polarity.
- Scope: every family extension with code: remote-containers, remote-ssh, remote-ssh-edit (if R-54 is extended to it),
  remote-explorer, remote-wsl, remote-server; `lib-standdown`
- Requirements: R-54; remote-containers F-1406 §5 and F-0101 BR-10; remote-explorer F-5901 §5 steps 1 to 6, AC-4,
  AC-6 and AC-8, F-5001 BR-11, F-5902 AC-30; remote-ssh F-3901, F-2001 (lazy activation), F-2006 AC-1, AC-2, AC-12 and
  Q1; remote-ssh-edit F-4002 AC-23 (never a startup activation)

## Context

R-54 makes a family extension register nothing at run time when the reference is enabled in the same window. It
shows one warning instead. Core reads every manifest contribution before activation [oss], so activation cannot
withdraw static menu, palette and welcome entries. Core appends those entries without removing duplicates. Only the
implicit palette entries are de-duplicated by id (F-1406 §3). F-1406 §5 and F-5901 step 6 therefore gate each such
entry with a context key "that only the running reimplementation sets, after it has decided not to stand down": a
key that means *serving* and is unset (false) until activation.

That polarity collides with lazy activation. Remote-SSH activates only on its resolver, URI, own commands and the
five internal commands (F-2001). ssh-edit activates only on its language and never at startup (F-4002 AC-23). The
explorer must not be active before its view is shown (F-5901 AC-6, F-5902 AC-30). In a fresh local window with only
our Remote-SSH installed, the six gated palette entries stay hidden until something activates the extension. F-2006
AC-1, AC-2 and AC-12 then fail (F-2006 Q1). A single install is the supported, common case. The case the gate
protects, both extensions enabled in genuine VS Code, is unsupported (F-1406 §3, F-5901 §5).

Core keeps context keys set by an extension at window level. A key survives an extension-host restart and is gone
after a window reload [oss] (`contextKeyService.ts`, F-5901 step 2).

## Decision

1. **The gating key means "standing down" and defaults to visible.** Each extension declares one invented key under
   its reference's namespace (R-27), for example `remote-explorer.standingDown`, recorded in its identity decision's
   ledger. Every gated entry carries the reference's own `when` clause verbatim, followed by `&& !<key>`. An unset key
   evaluates as false, so a lone install shows every entry before and after activation.
2. **The key is set to true only by `lib-standdown`, at an activation that finds the reference present** (R-54 step
   1, before any registration). It is set to false at an activation that finds the reference absent. That clears a
   value an earlier host run in the same window left behind (F-5901 step 2).
3. **No startup activation is added for the guard.** Every extension keeps the activation events its spec fixes.
   Extensions that already activate at startup (Dev Containers, WSL) run the guard at startup anyway.
4. **The residual is accepted and stated.** With the reference enabled, a lazily activated extension shows its gated
   entries next to the reference's from window start until its first activation. After that, each entry shows once,
   the reference's. Both copies name the same command ids and run the reference's handler, so nothing misbehaves. In
   the explorer the window is the moment of showing the view, because showing it activates the extension. In
   Remote-SSH it lasts until a resolver, URI or command activates it, and in a local window that may be the whole
   session. The README's "unsupported alongside the reference" line covers it (F-1406 §6).
5. **What R-54 already guarantees is unchanged.** At every activation that finds the reference, nothing registers at
   run time, one warning appears, and the extension stays inactive until a later activation finds the reference
   absent.

## Options considered

| Option | For | Against |
|---|---|---|
| A: "standing down" key, default visible, no extra activation (chosen) | Every single-install AC holds (F-2006 AC-1, AC-2, AC-12; F-5001; F-0101). Activation ACs hold (F-2001, F-4002 AC-23, F-5901 AC-6, F-5902 AC-30). One rule for the family | Duplicates before the first activation in the unsupported both-enabled case. F-1406 §5's acceptance ("each entry exactly once with both enabled") holds only after activation, so the specs need a wording revision |
| B: "serving" key, as F-1406 §5 and F-5901 step 6 are written | No duplicates at any time in the both-enabled case | Fails F-2006 AC-1, AC-2, AC-12 in the supported single-install case. Hides the Remote-SSH palette entries in every fresh window. Trades the common case for the unsupported one |
| C: A, plus an `onStartupFinished` activation that runs only the guard (the lead's preference) | Closes the duplicate window in the both-enabled case | An extension cannot activate "only the guard". Activation is all or nothing, and the activation time becomes visible. It breaks F-2001's exact activation list, F-4002 AC-23 ("never a startup activation") and F-5901 AC-6 and F-5902 AC-30 (explorer inactive before the view is shown), and adds startup cost to every window for the unsupported case |
| D: B plus C | No duplicates, entries visible after startup | Inherits C's AC failures. Entries still missing in the first moments after start, which F-2006 AC-1 can catch |
| E: no gating; rely on R-54's run-time stand-down only | Simplest | Every gated entry is duplicated for the whole session when both are enabled. Contradicts F-1406 §5, which the user's ruling R-54 builds on |

Option C would remove the duplicates only where the user already runs an unsupported combination. It would cost
three spec-fixed activation contracts that conformance checks in every window. Option A keeps the supported case
exact and leaves only a timing residual in the unsupported one. I recommend A over the lead's preference for this
reason.

## Consequences

- Revisions through `remote-development`: F-1406 §5 and F-0101 BR-10 (polarity, and acceptance "after the
  reimplementation's first activation"), F-5901 §5 step 6 and AC-4, F-5001 BR-11 (rename `remote-explorer.serving` to
  a standing-down key), F-3901 §5 and F-2006 §16 and Q1 (answered with option (b)). The R-27 ledgers take the new
  names.
- `lib-standdown` offers one operation: `standDownIfReferencePresent(referenceId, standingDownKey)` returns `standing`
  or `serving`. It sets the key both ways and shows the warning when standing. Every extension calls it first.
- The identifier tables (ADR draft "Identifier tables") list the key and the gated entries. A manifest check verifies
  that every gated entry's `when` equals the reference clause followed by `&& !<key>`, and that no other entry
  carries the key.
- The explorer's title action "Refresh" becomes visible before activation, as the reference's is. F-5001 AC-24's
  allowance for the difference is no longer needed.

## Check

- Manifest lint (with the identifier tables): the gated set and the `when` shape above.
- Conformance: F-2006 AC-1, AC-2 and AC-12, F-5901 AC-4, AC-6 and AC-8, and F-5902 AC-30 pass as written once the
  specs carry the polarity revision. A unit test of `lib-standdown` covers present, absent, a stale key from an
  earlier host run, and the warning shown exactly once.
