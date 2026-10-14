# Task card connect-46: Add New SSH Host refuses an unparsable picked file

Issue: #739. Release 0.2, **gating** (athena, register 2026-10-14, correcting her #709 answer). Size: S. Builder: selene.
Spec: F-2201 AC-20 (`remote-oss/remote-ssh#28`, 7.E1). coverage-30's AC-20 row (#713) waits on this card.

## 1. The defect

**The rule:** F-2201 AC-20. Given a file that can't be parsed, when Add New SSH Host runs from the Command Palette,
reaches the file step and the user picks that file, then AC-19's error is shown and the file is left unchanged. AC-19's
error is the command's error with the reader's message. The connect commands throw
`` `${file}: ${reason}` `` (`connect/connect-commands.ts`), and core shows it as "Command '<title>' resulted in an
error".

**What main does:** `packages/remote-ssh/src/config/add-host-command.ts` picks the file, then calls
`createdFile`, `files.read` and `files.write` with `writeHostBlock(...)`. It never parses the text, so it inserts its
block into the unparsable file.

## 2. The fix

1. **lib-ssh:** export `lexConfiguration` (and its `LexResult` type) from `packages/lib-ssh/src/index.ts`, beside
   `writeHostBlock`.
2. **`add-host-command.ts`:**
   - After `pathOf(...)`, and before `createdFile(...)`, read the picked file when it exists: `await files.exists(file)`,
     then `await files.read(file)`.
   - If `lexConfiguration(text)` gives `parseError`, throw `new Error(`${file}: ${reason}`)`. That's the connect
     commands' form, so core shows the same error. Nothing is created, written, opened or noticed.
   - When the file exists and parses, pass the text you read to `writeHostBlock`; don't read it a second time.
   - A missing file goes on as today: it's created, with an empty text.
3. Only the picked file is lexed, not the files it includes. AC-20 names the file the user picks.

Nothing else changes. The palette flow before the file step (the input and its parse errors, F-2204) is untouched.

## 3. Rows (`packages/remote-ssh/test/unit/add-host-command.test.ts`)

| Name | Given | Expected |
|---|---|---|
| `F-2201 AC-20: a picked file that cannot be parsed fails with the reader's message and is left unchanged` | `worldWith({disk: new Map([[`${HOME}/`, ''], [`${HOME}/.ssh/`, ''], [PLACES.userFile, 'Host "broken\n']])})`; run the handler | it rejects with the message `` `${PLACES.userFile}: unterminated quote after Host` `` (measure the lexer's exact text); the disk's text for `PLACES.userFile` is still `'Host "broken\n'`; `world.steps` has no `write`, `file` or `folder`; no notice; nothing opened |
| `F-2201 AC-20: a picked file that parses is read once and written` | a file with `Host old\n  HostName a\n` | the steps hold one `read`, then one `write` (as today's rows, with the read moved before the write) |
| existing rows | unchanged | they pass. Report any whose `steps` order changes because of the earlier read, and update only the order in it |

**Defect rule:** the first row must fail on main and pass with the fix. Paste both runs.

## 4. Catalogue

`F-2201.AC-20` goes from `todo` to `unit` in `docs/architecture/catalogue/coverage-slice1.tsv`. Then coverage-30's
acceptance row for AC-20 re-tags it `acceptance` when it's built.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title
`remote-ssh: Add New SSH Host refuses an unparsable picked file (card connect-46, #739)`. themis or triton reviews;
athena gives the design check.

## 6. Open rows (stop and report on #739)

1. The lexer accepts `Host "broken` (no `parseError`). Report what it gives, and find with the reviewer a text it
   rejects; don't change the lexer.
