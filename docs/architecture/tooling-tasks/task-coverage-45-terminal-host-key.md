# Task card coverage-45: the fingerprint pick in terminal mode, for both host-key wordings (F-2305 AC-30, AC-43)

Issue: #1124. Release 0.2. Size: S–M. Builder: `task:claude`. Design: athena's ruling on remote-oss/remote-ssh#38,
option (a), 2026-10-20, with F-2305 republished per it: F-2305 BR-2's handling of OpenSSH 10.x's wording holds in both modes. In terminal mode the
extension reads ssh's question from its pre-session output and shows the fingerprint pick.

## 1. What's on main (checked by daedalus, 2026-10-20)

The product appears to do this already. Terminal mode's `prompt-reader.ts` (lib-ssh) reports a waiting question at
the continue-connecting line. `attachTerminalQuestions` then shows it through `askQuestion`, whose `classifyPrompt`
makes a `fingerprintPick` from either fingerprint form (`FINGERPRINT_LINE`: optional colon, optional final full
stop). Unit rows cover the reader and the classifier with the 10.x line. **No acceptance row proves it in terminal
mode**, so F-2305 AC-30 and AC-43 are `todo`. This card writes those rows. If one shows the product doing something
else, that's an open row (§3).

## 2. Rows

**F-2308's ruling (athena on remote-oss/remote-ssh#41, option (a)):** when `remote.SSH.showLoginTerminal` is true in
terminal mode, every question stays in the terminal, the host-key question included. F-2305 AC-43 and §6.6 apply
only when the setting is false. The `terminal` launch leaves the setting at its default, false, so both rows below
are unchanged. Don't set it in this card's launch, and assert it in the rows' setup
(`remote.SSH.showLoginTerminal` reads `false` in the window). The true case belongs to F-2308's rows, not this card.

In the `terminal` launch (`useLocalServer` false, the platform named), a new file
`tests/acceptance/suite-terminal/host-key.test.ts`, or the terminal launch's existing host-key file if one exists.
The runner's client is OpenSSH 10.2 (`ssh -V`), so its question is the 10.x wording.
- **`F-2305 AC-43 (terminal-10x)`:** with the host's key removed from the run's known-hosts file
  (`ssh-keygen -R`), connect `harness`. The fingerprint pick appears, not the masked input. "Continue" connects the
  window and records the key. Cancel, on a fresh removal, leaves the window unconnected with nothing recorded.
- **`F-2305 AC-30 (terminal-classic)`:** the classic wording needs a client that prints `<TYPE> key fingerprint is
  <FP>.` Use the client-search fakes (`clients/` under the run folder, coverage-11's machinery), with a fake `ssh`
  that prints the classic question and then hands over to the real `ssh`. If the fakes can't pass a terminal session
  through, list AC-30 under "harness capability missing" and leave it `todo`.

Tag AC-43 and AC-30 `acceptance` when their rows pass.

**F-2305 AC-31 and AC-38 are reference-only** (F-2305 republished on remote-ssh#38). By athena's convention, recorded
in the register, a criterion the spec marks reference-only isn't a requirement, so **its line leaves the coverage
file**. It isn't `deferred` ("later") and it isn't `core` ("the editor's"). In this card's PR:
- delete the two lines `F-2305.AC-31` and `F-2305.AC-38` from `docs/architecture/catalogue/coverage-slice1.tsv`;
- if `docs/architecture/catalogue.tsv`'s `acCount` for F-2305 counts them, lower it by 2, and say so in the PR.

`check-coverage` doesn't need a line for every criterion.

## 3. Gates and open rows

All gates, `check-coverage` green, and the `terminal` launch in the VSCodium run. PR title: `tests: the fingerprint
pick in terminal mode (card coverage-45, #1124)`. Request athena only.

**Open row:** the terminal shows ssh's question and no pick appears for the 10.x wording. That's a product defect in
terminal mode: stop and post the row's output. daedalus cards the fix.
