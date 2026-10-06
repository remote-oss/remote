# ADR-NNNN: The manifest is the single source of identifiers; code reads generated tables

- Status: proposed. Draft by `remote-architect-worker-2`. The approach was agreed by the lead on 2026-10-06; the lead
  assigns the number
- Date: 2026-10-06
- Deciders: the lead. The reference-inventory input (Decision 5) is ruled: R-81.
- Scope: every extension package; `lib-identifiers`; `tools/`
- Requirements: D-14, R-27, R-29, R-46; the identity decisions F-1406 and F-1401 (remote-containers), F-3901
  (remote-ssh), F-4901 (remote-ssh-edit), F-5901 (remote-explorer), F-9901 (pack), and those of remote-wsl and
  remote-server; F-0102 (legacy setting precedence); F-0107, F-2006 and F-5002 (command catalogues and out-of-context
  behaviour); ADR-0003 (no duplicated code, no dead code); the stand-down gating ADR draft

## Context

D-14 fixes every identifier a user or another extension can bind, verbatim from the reference: settings, commands,
views, context keys and `when` clauses, menus, authorities, language ids. The counts are large: Dev Containers alone
has 71 commands, 43 settings, 13 context keys and 6 menus with 132 entries. Each identifier appears twice: in the
manifest, which core reads, and in code, which registers commands, reads settings and sets context keys. A typo on
either side is silent at build time and shows up only as a missing command or a setting that never takes effect.

R-27 adds identifiers of our own. Each lives in the reference's namespace, is tagged `[adaptation]`, is listed in the
repo's identity decision, and must not match any reference identifier. The clean side may not read the reference
manifest, so the "must not match" check needs another input.

R-29 keeps titles and categories verbatim. The conformance runner finds commands by palette title and groups the
indicator menu by category, so titles are as binding as ids.

## Decision

1. **The package manifest is the single source** of every contributed identifier and its manifest-side strings
   (titles, categories, `when` clauses, setting schemas, through `package.nls*.json`). Nobody writes an identifier
   into code by hand.
2. **Code reads a generated table.** A tool under `tools/` reads each extension's manifest and writes one typed module
   into that package. It holds one object per kind (commands, settings, views, context keys, authorities, languages),
   mapping a descriptive name to the literal id. It is generated at build time and git-ignored. The type checker
   then rejects any id that is not in the manifest. One exported object per kind keeps `knip` quiet about members
   that only the manifest uses (ADR-0003's dead-code check is per export).
3. **Ids that core sees but the manifest does not contribute** come from a second source file per package, the
   companion and internal list. These are the `remote-internal.*` and `remote-tunnels.internal.*` ids, served or
   called (F-5902 §5). The list is checked against the manifest's `onCommand:` activation events. A served id must
   have its event (F-5902 AC-1, AC-24, AC-33). No internal id may appear in `contributes.commands` or a menu.
4. **Invented identifiers have a ledger per package**, next to the manifest. Each row holds the identifier, its kind,
   the spec that introduces it and its `[adaptation]` tag, the R-27 citation, and the date. The ledger copies the
   identity decision's list, and a mismatch is a question to the room, not an edit here. Examples today:
   `remote-internal.sshHostsChanged` (F-5901 §6), the stand-down keys (stand-down gating ADR draft),
   `remote.SSH.serverDownloadUrlTemplate` (F-3901), and the proposed-API gate's window-claim key (contracts §3.4).
5. **CI check `identifiers`** fails when:
   - the generated table is stale against the manifest;
   - a ledger entry is missing from the manifest or companion list, or an invented id sits outside its kind's
     reference namespace (R-27);
   - a stand-down-gated entry's `when` does not end in the gating clause (stand-down gating ADR);
   - against the rooms' published identifier inventories (R-81), an id that is in
     neither the inventory nor the ledger, or a ledger id that is in the inventory. Until then this part is skipped
     and the CI job says so.
6. **`lib-identifiers` holds the behaviour shared over the tables**, never the tables themselves (a library never
   imports an extension, layout rule 4):
   - `registerCommands(table, handlers)`. Every command in the table must get a handler (no silent gap), and each
     handler runs behind the R-46 out-of-context guard its spec chooses (F-2006 BR-9, F-5002).
   - `readSetting(table, key)` with the declared legacy pairs and their precedence as data (F-0102 BR-4: the new key
     wins, except the three `dotfiles` pairs where the legacy key wins).
   - `setContextKey(table, key, value)`, only for keys the table declares as extension-set.
   - `checkStringTables(package)`, a build check of key parity across the 14 locales of `package.nls*.json` and
     `l10n/bundle.l10n.*.json`. These are the string tables conformance addresses (container view, `lib-identifiers`;
     F-0103, F-2002, F-4003, F-5001). The bundles stay in their package.
   The operations' contracts are in `l3/windows-and-explorer/contracts.md` §1.

## Options considered

| Option | For | Against |
|---|---|---|
| Manifest is the source; generated tables (chosen) | One place per id; core and code cannot drift; the conformance-visible strings stay in the files core reads | A build step and a generator to maintain |
| Hand-written constants module per package | No generator | Two copies of every id. ADR-0003 forbids duplicated code, and a drift is silent |
| A source table that generates the manifest | Typed source of truth | The manifest becomes an output, so reviewers check a generated file against the specs. Nls files and `when` clauses are awkward to express twice |
| One shared table for the whole family in `lib-identifiers` | One place for everything | Every extension would bundle every other extension's ids. Ids belong to one package each |

## Consequences

- Coding workers add a manifest entry and run the build. Code then refers to the generated name. Review checks the
  manifest against the spec's verbatim list, which is the only place an id is typed.
- The ledger makes the R-27 duties visible per package, and the CI job keeps it honest.
- Settings precedence and out-of-context behaviour are written once, in `lib-identifiers`, and tested there.
- Remote Explorer and ssh-edit have no log by spec. `lib-identifiers` therefore logs nothing itself and takes a
  logger only where a caller passes one (contracts §5).
- The generator is a tool under `tools/` and meets ADR-0003 like any tool (tests, coverage).

## Check

The CI job `identifiers` (Decision 5) runs with the layout and lint jobs. There are unit tests of the generator and of
`lib-identifiers`. The manifest-equality conformance cases (F-5901 AC-2, F-0101 and F-2006 catalogues) are the final
proof.
