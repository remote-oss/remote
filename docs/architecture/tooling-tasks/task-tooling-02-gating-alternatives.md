# Task card tooling-02: the gating rule accepts `||` alternatives (each alternative carries the key)

Why: F-3901 §5 (remote-ssh room, 2026-10-08): in a `when` clause with `||`, `&&` binds tighter, so the standing-down
key must appear in every top-level alternative; `check-identifiers` currently requires the clause to end with
` && !<key>` exactly once. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`tools/identifier-rules.ts` (the gating rule), its tests, and `tools/identifier-fixtures.ts` if fixtures live there.

## 2. Contract

The gating rule splits a `when` clause into top-level `||` alternatives (respecting parentheses: a `||` inside
parentheses does not split), and requires each alternative to end with ` && !<key>` exactly once; a clause without
`||` behaves as before. The error names the first alternative that lacks the key. An alternative that is only
`!<key>` is accepted (bare form, ruled 2026-10-08). `when: "false"` stays exempt.

## 3. Test table

| Given `when` (key `k.standingDown`) | Expected |
|---|---|
| `a && !k.standingDown` | ok |
| `a && !k.standingDown \|\| b && !k.standingDown` | ok |
| `a && !k.standingDown \|\| b` | fails, names alternative 2 (`b`) |
| `a \|\| b && !k.standingDown` | fails, names alternative 1 |
| `(a \|\| b) && !k.standingDown` | ok (the `\|\|` is inside parentheses; one alternative) |
| `!k.standingDown \|\| c && !k.standingDown` | ok |
| `a && !k.standingDown && !k.standingDown` | fails (the key twice in one alternative) |
| `false` | exempt |
| `a && !k.standingDown \|\| false` | fails (a `false` alternative inside a clause is not the exempt whole-clause form), names alternative 2 |

## 4. Rule for the worker

As card log-01; the existing gating tests keep passing.

## 5. Gates and review

PR title `tooling: gating rule over || alternatives (card tooling-02)`.

## 6. Open rows

None expected.
