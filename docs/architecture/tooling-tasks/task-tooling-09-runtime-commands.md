# Task card tooling-09: `runtimeCommands` in identifiers.json (#253 Q4)

Why: some reference command ids are registered at runtime only. They are never contributed, have no palette entry
and no activation event, for example `opensshremotes.showDetails`, the "(details)" link of the connect progress
(F-2304 §3.1, BR-12). The identifier model had no kind for them. The architect ruled a new declared kind
(`../l3/windows-and-explorer/contracts.md` §1.1, ddb5ff2; #253 Q4): the check verifies the namespace and that the id
is not contributed, and the generator emits the ids so that code registers the generated id, never a literal. Part E
of #140 needs it. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

| File | Change |
|---|---|
| `tools/identifier-sources.ts` | the `RuntimeCommand` type, the field in `DeclaredIdentifiers`, `'runtimeCommands'` in `DECLARED_FIELDS` (after `'internal'`), and its reading in `readDeclared` |
| `tools/identifier-rules.ts` | the function `runtimeCommandProblems`, called next to `internalProblems` |
| `tools/identifier-table.ts` | one `tableKind('runtimeCommands', …)`, before `internalCommands` |
| `tools/identifier-fixtures.ts` | `runtimeCommands: []` in the declared defaults, after `internal: []` |
| `tools/identifier-sources.test.ts`, `tools/identifier-rules.test.ts`, `tools/identifier-table.test.ts` | the rows of section 3 |

Nothing else. No package's `identifiers.json` changes here: `opensshremotes.showDetails` is added by part E of #140,
with the code that registers it.

## 2. Contract

```ts
interface RuntimeCommand {
  id: string;
  purpose: string;
}
// DeclaredIdentifiers gains: runtimeCommands: RuntimeCommand[];
```

- **Reading:** `runtimeCommands` is optional, defaulting to `[]`. Each entry has exactly the fields `id` (a string)
  and `purpose` (a non-empty string), read with `onlyFields(['id', 'purpose'])` as `internal`'s entries are.
- **Rule `runtimeCommandProblems(sources)`,** for each entry:
  - when the id is in `contributes.commands`:
    `` `runtime command '${id}' is contributed in contributes.commands` ``
  - when the id starts with none of `declared.namespaces.commands`:
    `` `runtime command '${id}' is outside the reference namespace of commands: ${prefixes or 'none declared'}` ``
    (the same wording as the ledger's namespace problem).
  - Nothing else. In particular, no activation event is required or checked.
- **Generator:** `tableKind('runtimeCommands', 'The reference command ids of identifiers.json that the extension
  registers at runtime only.', plainIds(declared.runtimeCommands.map(command => command.id)))`. Each id becomes a plain
  string entry named by `descriptiveNames`, so `opensshremotes.showDetails` gives `runtimeCommands.showDetails`.

## 3. Test table

One assertion per `it`.

| File | Given | Expected |
|---|---|---|
| sources | an `identifiers.json` without the field ("defaults every optional field") | `runtimeCommands: []` in the expected object (the existing row, extended) |
| sources | "reads every field" with `runtimeCommands: [{id: 'opensshremotes.showDetails', purpose: 'p'}]` | that entry in the expected object (the existing row, extended) |
| sources | an entry with a third field | fails as an unknown field of an entry |
| sources | an entry with `purpose: ''` | fails as an empty string |
| rules | namespaces `{commands: ['opensshremotes.']}`, entry `opensshremotes.showDetails`, not contributed | no problem |
| rules | the same id also in `contributes.commands` | the "is contributed" problem |
| rules | entry `remote.SSH.showDetails` | the "outside the reference namespace" problem naming `opensshremotes.` |
| rules | no `commands` namespace declared | the namespace problem with `none declared` |
| rules | a runtime command with no `onCommand:` activation event | no problem (the event is not required) |
| table | one runtime command `opensshremotes.showDetails` | the table has `export const runtimeCommands = {` with `showDetails: 'opensshremotes.showDetails'` |

Checked on a prototype on main (2026-10-12): with `opensshremotes.showDetails` added to remote-ssh's
`identifiers.json` by hand, `pnpm check-identifiers` printed `identifiers: ok`. The generator emitted
`runtimeCommands.showDetails`. A `remote.SSH.` id gave the namespace problem. Only the two "sources" rows above
needed their expected objects extended.

## 4. Rule for the worker

As card log-01; the tools ratchet may only rise.

## 5. Gates and review

PR title `tooling: runtimeCommands in identifiers.json (card tooling-09, #253 Q4)`; answers R1–R6.

## 6. Open rows

None.
