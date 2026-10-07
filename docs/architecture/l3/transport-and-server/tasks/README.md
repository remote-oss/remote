> Status (2026-10-07, `remote-architect`): drafts, 261 table rows and 43 open rows. Before any card is assigned,
> `remote-coding-worker-1` reviews the shape of `feature/lib-ssh-pure` against contracts.md §3 and brings the branch
> to the contract (the contract governs where the draft differs: option parsing ends at the destination; terminal
> mode runs `sh`; no `-l`/`-p`/`user@`/`-P` beyond the contract; `candidates(setting, PATH, platform)` and `ssh.exe` on
> Windows; `channelClosed` on "Connection closed."; `authentication` carries the PermissionDenied hint; an `ssh -G`
> argument builder exists; the "Server host key" debug line is kept; the fixed `choices` switches go), and resolves
> each open row either into a table row (when the contract or a confirmed room answer decides it) or into a note to
> the lead (when it does not). Only then does the PM assign the cards.

# Local-worker task cards: lib-ssh pure parts

Six cards for the pure parts of `packages/lib-ssh` (brief `../brief-lib-ssh-pure.md`, contracts `../contracts.md` section 3, build order `../../../build-order.md` "Local-worker task cards"). A card is a work order without judgement calls: the worker writes the tests from the given-to-expected table, makes the module pass, and stops at anything the card does not decide.

| Card | Contract | Modules |
|---|---|---|
| `task-ssh-01-arguments.md` | S2 | `arguments/target.ts`, `arguments/invocation.ts` |
| `task-ssh-02-config-lexer-hosts.md` | S4 | `config/lexer.ts`, `config/hosts.ts` |
| `task-ssh-03-config-files-effective.md` | S4 | `config/files.ts`, `config/effective.ts` (the `ssh -G` reader) |
| `task-ssh-04-config-writer-add-host.md` | S4 | `config/writer.ts`, `config/add-host.ts` |
| `task-ssh-05-diagnostics.md` | S5 | `diagnostics/classify.ts`, `diagnostics/rules.ts` |
| `task-ssh-06-prompts-locate.md` | S6, S1 | `prompts/classify.ts`, `client/locate.ts` |

## Card format

Every card has exactly six sections:

1. Package and file boundary: the module files, their test files (`packages/lib-ssh/test/unit/<module>.test.ts`; `diagnostics-classify` and `prompts-classify` where two modules share the name `classify`), and fixtures under `packages/lib-ssh/test/fixtures/<area>/`. Each fixture file carries a `source` field: recorded with the local OpenSSH against 127.0.0.1, `.invalid` names or TEST-NET addresses and sanitised, or constructed from the public manual pages. Nothing else may change.
2. Contract: the `contracts.md` subsection implemented, and the exported signatures of the branch. The contract governs; every difference is an open row in section 6.
3. Test table: one row per case, given to expected, with the citation of the acceptance criterion or behaviour rule (`F-2205.BR-3`). The citation starts the test name. A row marked (each) is one `it` per listed input.
4. Rule for the worker: tests first, fix only what fails, no signature or contract change, comment and name rules, coverage 90/85/90, the gate list.
5. Gates and review: reviewer `remote-coding-worker-1`; PR title `lib-ssh: tests and fixes for <modules> (task-ssh-0N)`; the R1 to R6 lines.
6. Open rows: cases the card cannot decide, each with its question. The worker stops at such a case and reports; it neither tests nor implements it.

## Order

The sources of all six cards already exist on `feature/lib-ssh-pure` (3c0463a), so cards 01 to 06 may run in parallel. The import edges decide the order of merging:

- 03 first among the config cards: `hosts.ts` (02) and `locate.ts` (06) import `config/files.ts`, and 03 owns the shared test helper `memory-reader.fixture.ts` that 02 uses.
- `config/files.ts` imports `expandHome` from `arguments/invocation.ts`, and `invocation.ts` imports the type `EffectiveOptions` from `config/effective.ts`: merge 01 and 03 in the same window, 01 first.
- 04 imports nothing from the other cards (only `choices.ts`); 05 imports nothing.

Merge order: 01, 03, 02, 04, 05, 06.

## Shared notes

- `packages/lib-ssh/NOTES.md` applies. Its packaging convention (items 1 to 7: `exports`, root `tsconfig.json` pair, `coverage.json` ratchet, README, the identifiers check) is not part of any card: it is done once by the integrator before the branch merges, and no card touches `package.json`, `tsconfig*`, `coverage.json` or `knip.jsonc`. Its gate traps (property names of four characters, no `const` arrow helpers, JSDoc on public class members, five-line clones inside one file) apply to every card. Its fixture recording notes apply to cards 03, 05 and 06; the NOTES file is deleted before the merge.
- Test style: Mocha with `node:assert`, files named `*.test.ts` under `packages/lib-ssh/test/unit/`, helper files named `*.fixture.ts`.
- `choices.ts` is not touched by any card; card 04 and card 05 raise it as an open row.
- The voice rule of the public-surface ADR applies to code comments and JSDoc: no feature, rule or decision ids and no origin framing. Test names keep the ids.
