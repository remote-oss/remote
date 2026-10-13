# Task card coverage-25c: the explorer slice-1 catalogue tags

Issue: #646. Release 0.3 (#43), explorer slice 1, item S8, part c. Why: slice 1's gate needs `check-coverage` green with
every criterion of the explorer coverage set tagged (brief, "The catalogue", ruled 233e3b7). Builder: iris or hestia
(each tag is a judgement against the issue's text). Size: about 2–3 agent-days. **Depends on:** coverage-25a (the
seeded file `docs/architecture/catalogue/coverage-explorer-slice1.tsv`), and the slice's builds and coverage-25b
merged, since their rows are what the tags point to.

## 1. The method

**What to read:** for each line of the explorer file, in file order, read the criterion in its issue: remote-explorer
#17, #12, #8, #9, #10, #7, #14, and remote-ssh #61 for F-2503. Then give it exactly one tag, by the first of these
rules that applies:

| Tag | When | Reason column |
|---|---|---|
| `recorded` | one of coverage-25b's eight rows cites it | empty |
| `acceptance` | another acceptance row (`tests/acceptance/**`) cites it | empty |
| `unit` | a unit row cites it, and what it checks is decided by our code alone, without the editor or the host | empty |
| `core` | what it checks is the editor's own behaviour that slice 1 only triggers (F-5101 §16's "VS Code core parts", for example the "Switch Remote" dropdown, the generated focus command, "Collapse All") | `core: <the part, in a few words>` |
| `deferred` | it needs a tunnel row or the tunnels companion | `D-55: no tunnel rows` |
| `deferred` | it needs recent folders, the history or delete ids, `setActiveFolders`, `sshHostsChanged`, or "Open SSH Config File" / "New Remote" | `explorer slice 1: increment 2` |
| `deferred` | it needs a second companion family (F-5301 territory) | `explorer slice 1: increment 3` |
| `deferred` | it depends on the Windows or macOS path form (F-2503 Q4) | `F-2503 Q4: the Windows and macOS path form` |

**When none applies:** if a criterion of slice 1's behaviour has no row yet, write the row:
- a unit row in the package whose code decides it;
- otherwise an acceptance row in `tests/acceptance/explorer/` (or `explorer-alone/`), with the helpers of tooling-30
  and coverage-25a.

Its name starts with the criterion's cite. Then tag it. A criterion that slice 1 can't meet as built is reported on
#646, not tagged around.

**Unit-row names:** the slice's unit rows were written with rule cites (`F-5902.5.rules`, `F-5101.BR-6`), which
`check-coverage` doesn't read. Where a unit row proves a criterion, add the criterion's cite in front of its name
(`F-5902.AC-15, F-5902.5.rules: ...`). Don't rewrite the rest of the name.

## 2. Done when

- `pnpm check-coverage` passes, with no `todo` left in the explorer file.
- The PR lists the count per tag, the criteria you wrote rows for, and every `core` line with its reason.
- All gates and the VSCodium run are green.

PR title `tests, docs: the explorer slice-1 tags (card coverage-25c, #646)`. themis or triton reviews. athena gives the
tag check, as for #607.

## 3. Open rows (stop and report on #646)

1. A criterion that fits two rules: list it with both, and tag it by the first.
2. A criterion whose text the slice's behaviour contradicts: report it with the row and the issue's words.
