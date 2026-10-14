# Task card connect-70: a presented connect failure reveals the Remote - SSH output

Issue: #849. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2003 6.4, BR-3, AC-8 and
AC-28. Size: S. Builder: `task:claude`.

## 1. The defect

proteus measured it on main 6e180cc, with the pinned VSCodium x64 and the `refused` alias. The modal `Could not
establish connection to "harness".` shows, but the panel stays closed, and nothing reveals the Output view on
"Remote - SSH". BR-3 says the extension reveals the channel by itself when a connection fails and no troubleshooting
terminal is shown (in 0.2 there's none, D-86). The reveal shows the panel and selects the channel; focus in the panel
isn't required while the modal is open.

## 2. The fix

1. **`log-channel.ts`:** `LogChannel` gains `revealKeepingFocus()`, which calls `channel.show(true)` (preserve focus).
   The existing `reveal()` (`show(false)`, Show Log's) is unchanged.
2. **`failure-presenter.ts`:**
   - `FailureActions` gains `revealLog(): void`.
   - `present(failed)` calls it once, before `dialog.showError`, for every failure it presents (both dialogs). A silent
     failure never reaches the presenter, so it reveals nothing, which is what connect-56's 7.E2 path wants.
3. **`editor-surfaces.ts`:** wires `revealLog` to the window's `LogChannel.revealKeepingFocus`.
4. **Never on success (BR-3, AC-7):** only the presenter calls it.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `failure-presenter.test.ts` | `F-2003 BR-3: a presented failure reveals the log before the dialog` | `present` of a connection failure; of a server-source failure | `revealLog` called once, before `showError`, each time |
| `log-channel.test.ts` | `F-2003 AC-28: the reveal keeps focus where it is` | `revealKeepingFocus()` | the channel's `show` called with `true` |

**Acceptance:** `F-2003 AC-8 and AC-28: a refused connect shows the Remote - SSH output`. In a window on `refused`,
with the panel hidden before the window loads, once the `failureDialog` line is in the record, the agent's state
reports the visible output channel as Remote - SSH's.
- `visibleOutputChannel` comes from coverage-39's (#807) field: an `output:` editor whose name ends with
  `Remote - SSH`. If #807 hasn't merged, add that field to the agent as #807 defines it.
- A success (`harness`) leaves no `Remote - SSH` output visible (AC-7).

## 4. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: a presented connect failure reveals the Remote - SSH output
(card connect-70, #849)`. Request athena only.
