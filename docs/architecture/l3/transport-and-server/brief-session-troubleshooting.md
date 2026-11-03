# Brief: F-2605 session hints and the troubleshooting terminal, and F-2606's absence

Owner: athena (architect). Plan: #1807 group 10. Specs:
- remote-oss/remote-ssh#72 (F-2605) and #73 (F-2606), both `spec:reviewed`, republished 2026-11-03 under F-3907;
- remote-ssh#72's republish note.

Decisions: D-58 (3), D-86 as amended by D-105, F-3907, R-26, R-28, R-31, R-79, ADR-0013. The component is R2
ssh-diagnostics (`components.md`).

## 1. What exists, and what this adds

- **Already built** (connect-04, connect-24): the hint store (`diagnostics/hint-store.ts`, the two newest records,
  oldest first), the error-hint recorder, the log content of F-2003 BR-6 and its summary block, and the clear command.
  The manifest already has what F-3907 requires: no `chatParticipants`, no `remote.SSH.experimental.chat`, and no
  `enablement` or `commandPalette` entry on `opensshremotes.clearAllSessionHints`.
- **This adds:**
  - a record for every resolve (BR-9);
  - the environment and log hints;
  - the numeric status;
  - the summary check that opens the troubleshooting terminal;
  - the terminal itself;
  - the "Output Log..." link;
  - the README's accessor;
  - F-2606's absence rows.

## 2. The record (BR-8 to BR-10)

- **Every resolve writes one record,** with the setting on or off and whether it succeeds or fails. The record starts at
  the resolve's start with its ISO time and its environment hints.
- **The environment hints come in BR-9's order:**
  - the 22 settings, without `experimental.chat`, each with the message "Extension setting '<name>' is set to value
    '<value>'":
    - the value is the effective one (`getConfiguration('remote.SSH').get`);
    - a string is written as is, anything else as JSON text, and no value as `undefined`;
    - the details are the setting's description from our manifest, except for `defaultExtensionsIfInstalledLocally` and `loglevel`, which BR-9 lists without details;
  - then "VS Code version: <vscode.version>";
  - then "Remote-SSH version: remote-ssh@<our version>";
  - then "<platform> <arch>".

  A pure function in lib-ssh builds them from a snapshot. The composition root reads `process.platform` and
  `process.arch` and passes them in (ADR-0013).
- **Error hints keep a numeric status as well as the code name** (BR-9's minimum, BR-5).
  - **The code name** (`OfflineError`) stays the table's Status cell.
  - **The number** comes from one table of ours in lib-ssh, one number per code, documented in the README. The
    reference's numbers (132, 137, …) are reference data and aren't copied.
  - **Records written before this change** have no number. They read as they are, and the table never needs the
    number.
- **The log hint:** when the resolve step ends, its log text, from the first line to the rule that ends the step, is
  added as the log hint.
  - **No secrets:** it's F-2003 BR-6's content, which is built without secrets (R-26), so the store holds none either.
  - **An error recognised after the summary check** follows the log hint (7.E2 b).
  - **Our resolve step always ends** (R-79), so a record always gets its log hint (AC-17; 7.E2 a is reference data).
- **The accessor** (BR-8, BR-9): the README documents the global-state key `remote.ssh.hints` and every field name of
  the record. The acceptance rows read the store only through that documentation. The key and the field names are
  ours.
- **Nothing in the store leaves the machine** (BR-11, R-28).

## 3. The summary check and the terminal (BR-1 to BR-7, BR-13; 5.0, 6.7, 6.8, section 11)

- **The summary check runs once per attempt,** when the resolve step ends, over that attempt's error hints (BR-1).
  - **With at least one hint and `enhancedSessionLogs` on,** it writes the summary block and opens the terminal.
  - **Otherwise** it logs that no hints were found, or that the feature is disabled (BR-2, AC-26). Log wording is ours.
- **The terminal opens before F-2601's failure surface is awaited,** so it exists within about a second of the summary
  (AC-2). R2 creates it, and then the failure presenter shows its dialog or notification.
  - **Focus** (AC-8): R2 is told which surface the presenter shows. It calls `show(preserveFocus)`:
    - preserving focus behind a modal dialog, which keeps the keyboard;
    - taking focus when the surface is only a notification (6.1).
- **The terminal is an extension terminal** named "Remote - SSH: Session Troubleshooting", with a `Pseudoterminal`.
  - **What it writes:** an empty line, STR:S138, the table, then "See verbose information in the Output Log..." with
    "Output Log..." in bold and underlined (SGR). There's no "Cmd+click" line, and the Status cells are plain (AC-3,
    AC-24).
  - **Input:** it hides the cursor and ignores all input (AC-7).
  - **Restricted Mode** is core's: an extension terminal waits for core's trust request and adds nothing of ours (6.8).
  - **Closing it** logs one line and changes no stored data (BR-13, AC-15).
- **The table is a pure renderer in lib-ssh:** (hints, width) → lines, by section 11's geometry.
  - **Its content:**
    - a double outer border and single inner rules;
    - "Status" centred, and as wide as its longest cell;
    - two columns filling the width, or four sharing the rest equally;
    - wrapping at spaces, and after "/", ".", "_" or "-" within a long word;
    - "• " list items, with a URL that doesn't fit after the bullet starting on the next line.
  - **Q4, decided (a):** one row per error hint in record order, with a single rule between rows (BR-6).
  - **Resizing:** the pseudoterminal's `setDimensions` redraws the table for the new width.
- **The "Output Log..." link (Q2, decided):** a terminal link provider for that terminal alone. It reveals the
  Remote - SSH output channel (F-2003) and nothing else. Core's "Open Detected Link..." list doesn't show it, as
  section 11 observes.
- **No STR:S011,** and no chat or language-model call of any kind (AC-25; F-2606 AC-26).

## 4. F-2606: what holds by absence

F-2606's live criteria are AC-15, AC-16, AC-25 and AC-26. They need no product code, only rows:
- **AC-15:** a unit row on the manifest:
  - no `contributes.chatParticipants`;
  - no `remote.SSH.experimental.chat`;
  - no chat or prompt library in `dependencies`;
  - no `enablement` on the clear command.

  Then an acceptance row: typing `@remote` in core's chat input offers no row from us.
- **AC-16:** F-2601's dialog has "Retry", "More Actions...", "Close Remote" in both kinds of empty window and in a folder
  window, also after Retry. F-2601's rows already assert the set; tag the line on them, or add the folder case.
- **AC-25:** `remote.SSH.experimental.chat` saved as `true`, then `false`, changes nothing. The clear command is still
  listed, the dialog has no Copilot button, and core's "Unknown Configuration Setting" marks the key.
- **AC-26:** a check that fails the build when remote-ssh or lib-ssh uses `vscode.chat`, `vscode.lm` or a
  language-model package. It's a check rule in `tools/` beside the identity checks, not a runtime row.

## 5. The cut and the cards

| Lines | Where |
|---|---|
| F-2605's 22 lines tagged "D-86: only clearAllSessionHints…" | `todo` now, carded |
| F-2605 AC-19 and AC-23: removed stubs in the republished text (no `enablement`, so there's no hidden or out-of-context case) | dropped from the coverage file, and AC-23's row with them |
| F-2605 AC-18, AC-20, AC-21: rewritten in the republished text (AC-18: always listed, with the chat key set either way; AC-20: the log line, and the other state entries kept) | their rows rechecked by card 1 |
| F-2605 Q3: the platform hint on macOS and Windows clients | `deferred`, `host: macOS` / `host: windows` |
| F-2606 AC-15, AC-16, AC-25, AC-26 | seeded into `coverage-slice1.tsv` by the card, then tagged on their rows |
| F-2606's removed stubs | not seeded |

**Suggested cards** (daedalus):
1. **The record:** §2, with the README accessor, in lib-ssh and remote-ssh. Rows: unit rows for the hint builder,
   the numbers and the order; acceptance rows for AC-16 and AC-17 through the accessor, and for AC-20 to AC-22.
2. **The terminal:** §3, after card 1. Rows: unit rows for the renderer's geometry tables; acceptance rows for AC-2 to
   AC-8, AC-15, AC-24 to AC-26, and the Restricted Mode case.
3. **F-2606's rows:** §4, independent of both.

**Amended tasks:** `task-connect-04-diagnostics-pure.md` has AC-17's row as "23 environment hints, three more". Card 1
restates it as 22 setting hints and three more, 25 in all, with the error hint's numeric status.
