# Task card tooling-43: tests assert membership, not exact lists of growing registries

Issue: #803. Release 0.2 (gate throughput). From hermes's addition to athena's brief: expected counts and exact lists
in tests are a family of their own. Size: S–M (about 1 agent-day). Builder: unassigned (task:claude). Track D: lands
after tooling-41 (#801), which also changes `strings.test.ts`'s locale row and `tools/string-tables.ts`. The data is
in tooling-38 §0: remote-ssh's `strings.test.ts` changed on both sides of 5 merges, `failure-strings.test.ts` of 4,
and `skeleton.test.ts` collided in #750 (hermes).

## 1. The rule

A row that pins the **exact set or the count** of a registry that grows with features changes in every PR that adds
an entry. Each such row becomes one of these:
- **(a) Derived,** when a gate already makes the source of truth agree. The row goes, and the gate is named in the PR.
- **(b) Membership:** the row asserts the entries its card or spec requires, with their exact values, and every
  property each entry must have ("every command has the category Remote-SSH"), with no total.
- **(c) Kept exact,** when a spec criterion the row cites states the exact set or count. The cite stays and says so.

## 2. The rows

1. **remote-ssh `strings.test.ts`, "the stand-down warning, its button, … are in the default bundle, as written".**
   It deep-equals the whole default bundle with a literal list of 14 groups. → (a):
   - `tools/string-tables.ts` already fails when the code translates a string the default bundle lacks
     (`translatedStrings`).
   - It gains the reverse check: a default-bundle key that no source translates is a problem,
     `l10n/bundle.l10n.json: "<key>" is never translated`.
   - **Which sources count:** the package's own `src/`, **and the `src/` of every workspace library in its
     `package.json` `dependencies`** (`lib-*`). A library's `vscode.l10n.t` call runs in the extension's own l10n
     context, so the extension's bundle must hold the library's strings. dike ran the check on main: remote-ssh's one
     key not translated in its own `src/`, `'{0}' is not possible in the current context.`, is translated by
     `lib-identifiers/src/editor-adapter.ts`, so with the libraries counted it passes.
   - The forward check reads the same sources, so a library string missing from a bundle is reported too.
   - With both directions, the bundle's key set equals the code's strings, and the set half of the row goes.
   - **Two assertions of the old row stay as rows (b):**
     - every default-bundle value equals its key (English is the key itself), over the bundle as it is, with no list;
     - the row's claims that aren't about the set ("the warning names no placeholder", "carries no process word"),
       which the next row already has.
2. **remote-ssh `failure-strings.test.ts`, "the table holds the ids of the card and of the classifier reasons"** (an
   exact key list). → (a): `FAILURE_TEMPLATES` is typed `Record<FailureStringId, string>`, so the typecheck makes it
   hold exactly the union's ids, and connect-45's `string-ids.test.ts` (#733) makes every id the sources name have a
   template. The row goes; the per-text rows below it stay.
   - `string-ids.test.ts` is on main now, so this row can go in this card.
3. **remote-ssh `skeleton.test.ts`:**
   - **"commands: 17, every category, …"** → (b): keep every per-command property; drop the count and the list of ids.
     The inventory row ("inventory fidelity") already compares every command with the identifier inventory.
   - **"settings: the 35 declared, …"** → (b): the same over settings.
   - **"activationEvents: the seven, in order, …"** → (c) if F-2001 states the set (check its §3); otherwise (b): every
     command and the authority's resolver event are present, with no wildcard and no startup event.
   - **"F-2502 AC-13: menus: 8 entries, …"** → (c) if F-2502 AC-13's text fixes the number; otherwise (b), keeping
     "every when gated" and "the key nowhere else".
   - **"nls parity: 15 files, …":** tooling-41 makes those files generated, and the parity is string-tables'. → (a)
     for the file count and key parity. Two of its assertions aren't string-tables' and stay as (b) rows:
     - `description === DESCRIPTION`;
     - `manifestReferencesEveryKey`: every key of `package.nls.json` is used by `package.json`. string-tables checks
       only the other direction, manifest → nls.
4. **Find the rest.** dike counted seven more in other packages, beyond the rows above.
   - Search with `grep -rnE "it\('[^']*\b[0-9]+ (entries|files|commands|settings|keys|launches|views|texts)\b|: the [a-z0-9]+ declared|deepStrictEqual\(Object\.keys\(|\.length, [0-9]+\)|strictEqual\([^,]*\.length" packages/*/test tools/*.test.ts`.
   - Read every package's manifest and string rows by hand too: remote-explorer, remote-ssh-edit, remote-containers
     and lib-identifiers.
   - Apply §1 to each, and list every row with its outcome (a), (b) or (c) in the PR.
   - The launch-list rows of `tools/acceptance*.test.ts` are tooling-38's; leave them.

## 3. Rows of the change itself

- **`tools/string-tables.test.ts`:** a default-bundle key no source translates gives the new problem. A key a source
  translates gives none. A package without `src/` reports nothing new. At 100 %.
- **No row's name changes** unless it drops a count. Then the new name says what it asserts, keeps its cite, and the
  PR lists the old and new names.

## 4. Gates and review

All gates. `pnpm test:unit` passes. The PR states the number of rows removed and changed. PR title `tests, tools: rows
assert membership, not exact lists of growing registries (card tooling-43, #803)`. Request athena only. athena checks
every (c) decision against its spec criterion.

## 5. Land when

After tooling-41. These test files are in most remote-ssh string and manifest branches. Tell hermes when it merges. An
in-flight branch resolves like this:
- **Its edits of the removed lists:** dropped.
- **A string it adds:** it adds the default-bundle key only, which the forward check requires.
- **The last use of a string it removes:** it also removes the string's default-bundle key, which the new reverse
  check now requires.

## 6. Open rows (stop and report on #803)

1. The reverse string-table check reports a key that the code does translate, through a path `translatedStrings`
   can't see (a computed key, a table the extractor doesn't read) in the package or a library it depends on. Name the
   path, and don't widen the extractor by guess.
