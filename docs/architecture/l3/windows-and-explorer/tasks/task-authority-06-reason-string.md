# Task card authority-06: a failure reason with values (#253 Q6)

Why: F-2104 shows a failed tunnel as F-2601's S031 whose reason nests strings: S067 "Error establishing tunnel ({0})."
around S089, or around S073 around S095. `FailureReason` was `{id} | {text}`, an id without values, so it could not
carry that. The architect ruled a third form (`../contracts.md` §3.2, 45160c9; #253 Q6). This card adds the type and the
presenter's resolution. #140 part E then uses it for the tunnel's failures. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-authority/src/connector/results.ts` | `ReasonValue`, `ReasonString`, and the third `FailureReason` form (section 2) |
| `packages/lib-authority/src/index.ts` | export `ReasonString` and `ReasonValue` as types |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | `reasonText` resolves a `ReasonString`; the four ids join the `FailureStringId` union and `FAILURE_TEMPLATES` (section 2) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the four new templates as keys, each with its English text as the value in every file |
| `packages/remote-ssh/test/unit/failure-strings.test.ts` | the rows of section 3, and the four ids added to the existing row that lists the table's ids |

Nothing else. `FilledString` (hints and mitigations) stays as it is: a different type with flat `string` values.

## 2. Contract

```ts
/** A value of a reason's placeholder: a literal shown as it is, or a string of the table resolved in turn. */
export type ReasonValue = string | ReasonString;
/** A string of the table with values for its placeholders, which may themselves be strings of the table. */
export interface ReasonString {
  id: string;
  values: readonly ReasonValue[];
}
/** The reason a failure carries: a string of the table, text the failing step wrote, or a string with values. */
export type FailureReason = {id: string} | {text: string} | ReasonString;
```

`reasonText(reason, translate)` in `failure-strings.ts`:

- `{text}`: as today (empty is no reason).
- `ReasonString` (it has `values`): the template of `id`, with each value put in its `{n}` place. A `string` value is
  inserted as it is, **never looked up**, even when it equals an id. A `ReasonString` value is resolved the same way,
  at any depth. When an id at any depth has no template, the whole reason is `undefined` (the presenter then shows
  S030, as for an unknown `{id}`).
- `{id}` without `values`: as today.

The four new templates (F-2104 §3.4, exactly, including S095's **two** spaces after `'{0}-{1}'.`):

| Id | Template |
|---|---|
| S067 | `Error establishing tunnel ({0}).` |
| S073 | `Failed to find a free local port: {0}` |
| S089 | `Max wait time exhausted` |
| S095 | `No free ports in specified range '{0}-{1}'.  Remove or update the 'Preferred Local Port Range' setting and try again.` |

S095 takes the range's start and end as two **literal** values, the numbers as strings. The contract's example,
`{id: 'S095', values: []}`, leaves them out. A reason built for S095 must carry them, or the dialog would show a raw
`{0}`; see the last rows.

## 3. Test table

One assertion per `it`; the cite starts the name. `translate` is the identity.

| Cite | Given | Expected |
|---|---|---|
| F-2104 7.E3 b | `{id: 'S067', values: [{id: 'S089', values: []}]}` | `Error establishing tunnel (Max wait time exhausted).` |
| F-2104 7.E1 | `{id: 'S067', values: [{id: 'S073', values: [{id: 'S095', values: ['41060', '41061']}]}]}` | `Error establishing tunnel (Failed to find a free local port: No free ports in specified range '41060-41061'.  Remove or update the 'Preferred Local Port Range' setting and try again.).` |
| contracts §3.2 | `{id: 'S073', values: ['S089']}`: a literal that equals an id | `Failed to find a free local port: S089` (not translated) |
| contracts §3.2 | `{id: 'S067', values: [{id: 'S999', values: []}]}`: an unknown nested id | `undefined` |
| contracts §3.2 | `{id: 'S999', values: []}` | `undefined` |
| F-2601 S031 | the presenter with reason `{id: 'S067', values: [{id: 'S089', values: []}]}`, alias `box` | `Could not establish connection to "box": Error establishing tunnel (Max wait time exhausted).` (the template's own full stop, no second one) |
| contracts §3.2 | the existing `{id}` and `{text}` rows | unchanged, and pass |
| F-2104 | the existing row "the table holds the ids of the card and of the classifier reasons" | its list gains S067, S073, S089 and S095 |
| string tables | the bundles | `pnpm check-layout` green: the four keys in all 15 |

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-authority, remote-ssh: a failure reason with values (card authority-06, #253 Q6)`.

## 6. Open rows

None. All rows were checked on a prototype on main (2026-10-12): the six new rows pass, and the presenter's S031
row ends with the template's own full stop.
