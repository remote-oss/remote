# Task card connect-48: delete the superseded maintenance host picker

Issue: #744. Not gating. Size: S. Builder: selene. Ruled by athena (2026-10-14), from tooling-31's finding (#741):
`packages/remote-ssh/src/maintenance/host-picker.ts` is imported only by its test.

## 1. Why

**What the module was for:** card task-remote-ssh-05 wrote `maintenance/host-picker.ts`, the maintenance commands' own
pick: `MAINTENANCE_PICKER_OPTIONS` and `maintenanceStep`.

**What replaced it:** #532 Q1 replaced it with the shared host pick. Kill and Uninstall pick through `pickedTarget`
(`connect/connect-commands.ts`), over `HostPickPort` (`surfaces/host-pick.ts`) and `outcomeOfPick`
(`connect/picker-model.ts`). No production file imports `host-picker.ts`.

**The rule:** ADR-0003 (no dead code) deletes it. Every behaviour its rows prove must stay proven on the live path.

## 2. Changes

1. Delete `packages/remote-ssh/src/maintenance/host-picker.ts` and `packages/remote-ssh/test/unit/maintenance-host-picker.test.ts`.
2. Move each of the twelve rows of `maintenance-host-picker.test.ts` to the live path, by the table in §3:
   - If an existing row of `connect-commands.test.ts`, `connect-picker-model.test.ts` or `maintenance-commands.test.ts`
     already proves the same outcome, give it the deleted row's cite in addition to its own. Use the multi-feature cite
     form, for example `F-2411 6.3, F-2412 6.4: …`.
   - If none does, add a row in `maintenance-commands.test.ts` that runs the command through `setup(...)` with the
     picked item, and asserts the target the run gets (`scenario.runs`), or that nothing runs.

3. If tooling-31 (#741) has merged with an allowlist entry for this module (card `#744`), remove that entry in the
   same PR. A stale entry fails `check-consumed`.

## 3. The rows

**The recording:** `maintenance-commands.test.ts`'s `setup` records each run as `` `${action} ${target.host}` `` in
`scenario.runs`, and each handed-over command id in `scenario.commands`. To assert a whole target, add
`targets: SshTarget[]` to `Setup`: `perform` pushes the target it gets. Existing rows don't change.

**Cites that must move:** two catalogue tags rest on rows of the deleted file. `check-coverage` fails if their cite
disappears:
- `F-2412 AC-22` (tagged `unit` by #722) is cited only in the deleted `F-2412 AC-22: 6.4, a typed alias runs on its
  parsed target`;
- `F-2411 AC-11` is cited there as well, and by live rows.

Carry both to the live-path rows below (dike on #746).

| Deleted row (cite) | Outcome to keep | Where on the live path |
|---|---|---|
| `F-2411.5.0`: the fixed options of the quick pick | no title, one pick, no Back, the first row focused | the connect editor's `pickHost` adapter rows (`connect-editor.test.ts`), which set the same options for every host pick. Re-cite the row that asserts them |
| `F-2412.5.0`: a listed host runs on its alias as the text; the host label is the text, case kept | the run's target is the alias, with its case | `maintenance-commands.test.ts`: picking a host row named `Dev-Box` runs on `Dev-Box` |
| `F-2411 AC-11: 6.3`: a typed `user@host:port` runs on its parsed target | the parsed target | `maintenance-commands.test.ts`: `F-2411 AC-11, F-2411 6.3: …`. The typed item (`{kind: 'typed', label: '➤ lab@x.invalid:2222', text: 'lab@x.invalid:2222', keepVisible: true}`, the form the existing `F-2411.AC-11` row uses) gives `scenario.targets` `[{host: 'x.invalid', user: 'lab', port: 2222}]` for a kill |
| `F-2412 AC-22: 6.4`: a typed alias runs on its parsed target | the uninstall runs on the typed user and alias | `maintenance-commands.test.ts`: `F-2412 AC-22: a typed user@alias is uninstalled with the typed user`. The typed item `me@dev` gives `scenario.targets` `[{host: 'dev', user: 'me'}]` for `uninstall()` |
| `F-2411.6.3`: spaces kept, `-oProxyCommand=x`, `a b.invalid` and three spaces not refused | the run gets the text unchanged | `connect-picker-model.test.ts`'s `outcomeOfPick` rows, if they cover these four; otherwise add them there |
| `F-2411.6.4` / `F-2412.6.5`: the add-host and configure rows end the command | the row runs its command (F-2204's flow or F-2203's picker), and the kill or uninstall doesn't continue. F-2411 6.4 says so (`remote-oss/remote-ssh#56`). That's `pickedTarget`'s hand-over | `maintenance-commands.test.ts`: re-cite the existing hand-over rows, or add one per command. It asserts `scenario.commands` holds the row's command id, and `scenario.runs` is empty |

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage.
`pnpm check-consumed` (once #741 has merged) no longer reports the module. Use the PR title
`remote-ssh: delete the superseded maintenance host picker (card connect-48, #744)`. themis or triton reviews.

## 5. Open rows (stop and report on #744)

1. A deleted row has no live-path equivalent, and adding one needs a production change. Report it.
