> Status (2026-10-07, `remote-coding-worker-1`): `feature/lib-ssh-pure` is at the contract (contracts.md section 3,
> amended with the lead's rulings of 2026-10-07) and follows the library convention. Every open row is decided: no
> card has a section 6 row left. Rows marked (provisional) rest on a spec reading rather than a confirmed answer; the
> lead receives their list after the cards have run.

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

The sources of all six cards already exist on `feature/lib-ssh-pure` (its head), so cards 01 to 06 may run in parallel. The import edges decide the order of merging:

- 03 first among the config cards: `hosts.ts` (02) and `locate.ts` (06) import `config/files.ts`, and 03 owns the shared test helper `memory-reader.fixture.ts` that 02 uses.
- `config/files.ts` imports `expandHome` from `arguments/invocation.ts`, and `invocation.ts` imports the type `EffectiveOptions` from `config/effective.ts`: merge 01 and 03 in the same window, 01 first.
- 04 and 05 import nothing from the other cards.

Merge order: 01, 03, 02, 04, 05, 06.

## Shared notes

- The packaging is done on the branch (`src/index.ts`, `exports`, README, root `tsconfig.json` pair); no card touches `package.json`, `tsconfig*`, `coverage.json` or `knip.jsonc`. The integrator records the coverage ratchet (`pnpm coverage:update`) once the cards have merged; until then `pnpm coverage` fails for lib-ssh only.
- Gate traps: property names of four characters or more; no `const` arrow helpers (`func-style`); JSDoc on public class members; jscpd also flags five-line clones inside one file. Tests import through `../../src/index.ts` where the export exists.
- Fixture recording (cards 03, 05, 06): local `ssh -G` prints `connecttimeout none` when unset and `localforward 8080 [127.0.0.1]:80`. A `ProxyCommand` script that writes chosen lines to stderr and exits 255 reproduces exact texts (an inline command breaks, because ssh expands `%`). An `SSH_ASKPASS` script with `SSH_ASKPASS_REQUIRE=force` records the real question texts against a local sshd; OpenSSH 10.3 prints the colon fingerprint form. Remove the local host-key fingerprint, user name and home paths from every recording before commit; record only against 127.0.0.1, `.invalid` names and TEST-NET addresses.
- Test style: Mocha with `node:assert`, files named `*.test.ts` under `packages/lib-ssh/test/unit/`, helper files named `*.fixture.ts`.
- The voice rule of the public-surface ADR applies to code comments and JSDoc: no feature, rule or decision ids and no origin framing. Test names keep the ids.
