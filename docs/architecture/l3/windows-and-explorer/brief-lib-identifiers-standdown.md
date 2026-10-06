# Coding brief: lib-identifiers and lib-standdown (second coding target from area B)

Status: draft by `remote-architect-worker-2` for the lead's review, 2026-10-06. Design: `components.md` §1. Contracts:
`contracts.md` §1 and §2. ADRs: 0002, 0003, 0007 and the drafts "Identifier tables" and "Stand-down gating". Both
libraries are built and unit-tested before any resolver, view or companion exists. They need no other library (see
"Dependencies").

## What is built

| Piece | Where | Content |
|---|---|---|
| Identifier data file | `packages/<x>/identifiers.json`, one per package, hand-written and reviewed against the package's identity decision | `reference` (the reference's extension id, for example `ms-vscode.remote-explorer` from F-5901), `standingDownKey` (named by the room's identity decision once the polarity revision lands), `internal` (served or called ids, kind `query`, `change` or `push`; F-5902 §5), `invented` (the R-27 ledger: id, kind, spec, date), `settingPairs` (current key, legacy key, winner; F-0102 BR-4) |
| Generator | `tools/` (name by the lead) | Reads `package.json` and `identifiers.json` and writes the git-ignored typed table into the package: one object per kind (commands, settings, contextKeys, views, authorities, languages, internalCommands), descriptive name to literal id, plus each command's palette flag and R-46 policy |
| Check `identifiers` | `tools/`, a CI job | Fails on a stale table, a ledger id missing from the manifest or internal list, an invented id outside its kind's reference namespace (R-27), an internal id that is contributed or in a menu, a served internal id without its `onCommand:` event (F-5902 AC-1, AC-24, AC-33), and a gated menu entry whose `when` does not end in `&& !<standingDownKey>`. The reference-inventory part is reported as skipped until the rooms publish inventories |
| String-table check | `tools/`, a build step | Key parity of `package.nls*.json` and `l10n/bundle.l10n.*.json` across the 14 locales a package ships (F-0103, F-2002, F-4003, F-5001) |
| `lib-identifiers` | `packages/lib-identifiers` | `registerCommands`, the guarded handler, `readSetting`, `setContextKey` (contracts §1.2) |
| `lib-standdown` | `packages/lib-standdown` | `standDownIfReferencePresent` (contracts §2) |

## Behaviour to get right (each a named unit test)

- **R-46 guard.** A command whose precondition is false does nothing. With policy `infoLine` it shows the package's
  localized "'{0}' is not possible in the current context." with its title (F-5002 §6.4, F-2006 BR-9). With policy
  `silent` it shows nothing. Internal ids are always silent and never reject (F-5902 "Foreign callers", F-3906 rule
  11). The precondition is a predicate the package passes per command, since window contexts differ by package.
- **Legacy precedence** (F-0102 BR-4, its AC-8): the winner of each pair, the dotfiles pairs reversed, and "set"
  meaning exactly what F-0102 BR-4 says. Read the spec issue (remote-oss/remote-containers#88).
- **Stand-down** (R-54, F-5901 §5 steps 1 to 4, F-1406 §5, F-3901, F-8901). The lookup runs before anything is
  registered. When the reference is present: set the key to true, show one warning with one button that opens the
  Extensions view searched by `@id:<reference>`, and return `standing`. When it is absent: set the key to false
  (clearing a stale value from an earlier host run) and return `serving`. The warning is not awaited, so activation
  never blocks on it. No mid-session check (lead, 2026-10-06). Exactly one warning per standing activation.
- **Registration order.** `registerCommands` refuses to run after `standing`: a programming error that fails a test.

## Adapters (ADR-0002 rule 7)

One adapter module per library over `vscode`:

- `lib-identifiers`: register a command, set a context key, read configuration with its inspected scopes (needed by
  the precedence rule), show an information message.
- `lib-standdown`: look up an extension by id in the own host (stable `extensions.getExtension`), set a context key,
  show a warning message, run the Extensions-view search command.

Everything else is plain TypeScript tested under Mocha with fakes of the adapters. Integration tests in the editor's
harness cover only the adapters.

## Dependencies

- **None but `vscode`.** The container view lists `lib-log` for both libraries, but neither logs anything under the
  specs. The warning and the R-46 line are UI, and Remote Explorer and ssh-edit forbid a log. I propose dropping the
  two edges (question for the lead); a later need gets a logger passed in (contracts §5).
- **Before remote-ssh-edit ships**: its brief uses the generator for its `languages` table. The generator and the
  check are therefore this brief's first PR, and the two libraries come in the second.

## Done

- ADR-0003 gates green (90 % lines, 85 % branches, 90 % functions, no clones, no dead code). Every test is named after
  the AC or BR it proves.
- The generator and the check run over every package manifest on main and pass. They fail on synthetic fixtures for
  each failure rule above.
- No conformance case runs against a library alone. The cases that later prove them are F-5901 AC-4, AC-5, AC-8,
  AC-17 and AC-19, F-5002's out-of-context ACs, F-0102 AC-8, and F-2006 AC-1 and AC-2 with the revised polarity.
- The PR answers R1–R6.

## Open before coding (through the lead)

1. The two `lib-log` edges (above).
2. The standing-down key names come from the rooms' identity decisions after the polarity revision. Until then,
   `identifiers.json` leaves `standingDownKey` empty and the check reports it as pending rather than failing.
