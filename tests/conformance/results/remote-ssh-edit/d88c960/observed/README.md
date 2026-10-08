# Observed side of the code failures (addendum to the d88c960 results)

There is one file per case for the 31 code cases and the 2 restore cases (F-4001-AC3-3, F-4102-AC28-4). The triage on remote-oss/remote#72 decided these, and #73 fixes them.

Each file holds:

- `steps` and `expect`: as in the public suite (remote-oss/remote-ssh-edit `e8a14f3`).
- `mismatches_expected_vs_observed`: the runner's comparison, expected side first.
- `observed.normalized`: what this build showed at each `observe` step, normalized like the comparison.
- `observed.per_step`: every step's result, duration and `at` (seconds since the window was ready), with the cursor (`selection`) and the editor state after the step. The editor state covers editors and tabs, the suggest widget (rows, focused row), hovers, quick input, dialogs, notifications, side bar sections and the panel. A `wait` step records no state.

The runner does not record when the extension activated, so timings are relative to the window being ready. Run paths are replaced by their placeholders (`${HOME}`, `${WORKSPACE}`, `${SLOT_DIR}`, …).

## The completion cases (question 1)

In 15 of the 17, the suggest list was open with items after the trigger key: Space, a letter, or Ctrl+Space. In most of them the focused item was the one the case accepts. The step that should accept the item (Enter or Tab) then leaves the cursor on the next line, so Enter inserted a newline. The list was no longer open when the key arrived; it closed during the case's quiet wait (2 s), which records no state.

The exceptions:

- F-4201-AC41-2: Space opened nothing; Ctrl+Space did.
- F-4202-AC32-1: the list closed after the second letter.

## F-4002-AC6-1 and AC7-1 (question 2)

The steps record no hover. `observed.normalized` → `unsupported-sections` holds the rows of the extensions view sections. For AC7-1, "Disabled in Virtual Workspaces" lists the two built-in task extensions, and this build is not among them; the recording has three rows. For AC6-1, "Limited in Restricted Mode" has four rows where the recording has five.
