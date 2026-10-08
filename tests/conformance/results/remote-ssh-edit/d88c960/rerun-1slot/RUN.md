# remote-ssh-edit d88c960: rerun at one slot (release 0.1 gate)

This is the rerun the revised triage on #73 asked for. It used the same build and suite as `../RUN.md`, ran on **one runner slot**, and had no other editor window on the display.

| | |
|---|---|
| Build under test | `remote-oss/remote` `d88c960`, `remote-ssh-edit-0.0.0.vsix` (sha256 `d6ceacdd…`, as in `../RUN.md`) |
| Suite | `remote-oss/remote-ssh-edit` `tests/conformance` at `e8a14f3` |
| Runner | this repository's `tests/conformance/runner` (cleanroom-kit `69f3743`), with `packages/remote-ssh-edit` identity and rules; `wait_scale` 2 |
| Slots | **1** (the #72 run used 2 in parallel on one display) |
| Editor | VS Code 1.139.1, [linux-arm64] |
| Duration | 49 min for 57 cases (2026-10-08 06:22–07:11) |
| Model use | none |

## What ran

These are the 54 gate cases from the revised triage:

- the 18 completion and snippet cases, plus F-4001-AC13-1;
- F-4002-AC7-1 and AC22-1;
- the three cases on the normalized home: F-4101-AC1-4, AC1-5, F-4202-AC17-2;
- the two token cases: F-4101-AC19-1, F-4102-AC7-2;
- F-4102-AC1-8;
- every environment case of #72 that isn't a suite defect: the 22 that passed at 2x wait, the folder pickers, F-4003-AC14-1 and F-4203-AC17-1.

Three cases already classed as environment were also run, for information only: F-4002-AC6-1, F-4001-AC3-3 and F-4102-AC28-4. The documentation cases (F-4002-AC3-1, AC5-1, AC5-2) were not run; they are suite defects under R-53.

## Result

| | pass | fail |
|---|---|---|
| Gate cases (54) | **51** | 3 |
| Informational (3) | 0 | 3 |

**Every case that the #73 investigation linked to parallel slots passes at one slot.** That's the 18 completion and snippet cases, F-4001-AC13-1, both token cases and F-4102-AC1-8.

The 3 gate failures are environment, not this build (`failures.json`):

- **F-4002-AC7-1 and AC22-1:** they now provision. The "Disabled in Virtual Workspaces" section lacks the built-in "Jake support" row that the recording's editor listed. Our extension appears in neither list. The lab's editor fixture (`fresh-public`, built from the suite's definition: `e6f7360c09fc`) is not the recording's (`b2e7c5cf3228`). F-4002-AC6-1 misses the built-in "Microsoft Account" row the same way.
- **F-4203-AC17-1:** the lab driver cannot undo the typed text. The fix is cleanroom-kit #161, which merges after the parity replay; this run did not include it.

## Token cases

At two slots, F-4101-AC19-1 and F-4102-AC7-2 showed one extra token. It sat one column past the end of the line and repeated the previous token's text. At one slot both cases pass. So the extra token came from tokenizing under contention, not from the grammar. The token dump showing the previous token's text for it is a runner quirk, noted for the kit.

## Recommendation

Run UI-timing suites (completion, pickers, language mode) on **one slot per display**. Two parallel windows on one display take focus from each other during waits; this cost 19 false failures in the #72 run. More slots need more displays (one Xvfb per slot), not more windows on one display.
