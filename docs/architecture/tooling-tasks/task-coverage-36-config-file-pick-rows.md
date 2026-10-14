# Task card coverage-36: F-2201 AC-6, 7 and 32 as unit rows

Issue: #709. Release 0.2, **gating** (slice-1 criteria). Ruled by athena (sweep ruling 1, 2026-10-14): F-2201 AC-6, AC-7
and AC-32 (`remote-oss/remote-ssh#28`) are ours, not core's, and get unit rows. Size: S. Builder: selene.

## 1. What each criterion needs

- **AC-6:** the picker's "Settings" row opens the Settings editor with a search that restricts it to the extension and
  its two companions and contains "config file". The row
  `F-2203 AC-14: the Settings row opens the settings of the extension and its pack, and creates nothing`
  (`packages/remote-ssh/test/unit/open-config-file.test.ts`) already proves the query. Which setting is shown first is
  the Settings editor's own ordering, which belongs to core.
- **AC-7:** the "Help" row writes no file, and the page it opens is the project's own. The row `F-2203 AC-15` in the same
  file proves the first half. The second half needs the address, which is a constant in `src/extension.ts` today, where
  no unit test can import it.
- **AC-32:** with an unparsable file, a host-picking command run from the remote indicator menu or a keybinding opens no
  host picker and writes nothing:
  - The menu entries and any keybinding run the same command ids as the palette. The row
    `F-2502 AC-13: menus: …` (`skeleton.test.ts`) proves that the indicator's two entries are
    `opensshremotes.openEmptyWindow` and `opensshremotes.openEmptyWindowInCurrentWindow`.
  - The handlers' behaviour is in `connect-commands.test.ts`. Its `F-2201 AC-19` rows cover only `openEmptyWindow` and
    `cleanLocalServer`.

## 2. Changes

1. **The address.** Move `CONFIG_HELP_ADDRESS` from `packages/remote-ssh/src/extension.ts` to
   `packages/remote-ssh/src/config/open-config-file.ts`, exported as `CONFIG_FILE_HELP_ADDRESS`, with the same value
   (`https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/ssh-config.md`) and a one-line JSDoc. `extension.ts`
   imports it. Nothing else changes.
2. **Re-cites:** rename two rows in `open-config-file.test.ts`, with nothing else changed:
   - `F-2203 AC-14, F-2201 AC-6: the Settings row opens the settings of the extension and its pack, and creates nothing`;
   - `F-2203 AC-15, F-2201 AC-7: the Help row opens the help once and creates nothing`.
3. **New rows** (below).

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `open-config-file.test.ts` | `F-2201 AC-7: the Help row's page is the project's own` | `CONFIG_FILE_HELP_ADDRESS` | it starts with `https://github.com/remote-oss/remote/blob/main/`, and the rest of it names a file that exists in the repository (the repository root is `path.join(import.meta.dirname, '..', '..', '..', '..')`, the way `docs.test.ts` finds its package) |
| `connect-commands.test.ts` | `F-2201 AC-32: Connect Current Window to Host with an unparsable file shows no pick, opens nothing and fails with the parser message` | `runWith(undefined, {listing: {parseError: {file: '/home/alex/.ssh/config', reason: 'Unexpected line break'}}})`; run `openEmptyWindowInCurrentWindow` | the rejection's message is `/home/alex/.ssh/config: Unexpected line break`; `fakes.asked` is `['listHosts']`; `fakes.opened` is `[]` |
| `connect-commands.test.ts` | `F-2201 AC-32: Connect to Host with an unparsable file opens nothing` | the same listing; run `openEmptyWindow` | `fakes.opened` is `[]` and `fakes.commandsRun` is `[]` |

The rows run the handler directly, as the AC-19 rows do: the menu and keybinding only pick the command id, and the
`F-2502 AC-13` row already proves those ids.

## 4. Catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, change `todo` to `unit` for:
- F-2201 AC-6 and AC-7.

F-2201 AC-32 is already `deferred` (catalogue sweep #706): athena ruled on #709 that its New Remote half needs the
Remotes view (explorer increment 2, 0.3). This card's AC-32 rows prove its connect half for when the tag is revisited.

`pnpm check-coverage` must pass.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title `tests: F-2201 AC-6, 7 and 32's unit rows (card coverage-36, #709)`.
themis or triton reviews; athena gives the tag check.

## 6. Open rows

None. athena answered the add-host half of AC-32 on #709: it isn't a 0.2 defect. Don't change `add-host-command.ts`.
