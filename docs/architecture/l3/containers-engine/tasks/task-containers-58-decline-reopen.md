# Task card containers-58: after a trust decline the folder reopens locally on OK or after 5 s (F-0301 AC-68)

Issue: #1155. Milestone 0.4, containers release 1. Size: S. Builder: `task:claude` (hestia or iris). Design: athena's ruling on
#737 (2026-10-20, iris's finding on #1116): a product change, not a deviation. Spec: remote-oss/remote-containers#20
(F-0301) 6.9 step 5 and AC-68. The reload to the local target "does not wait for OK", and the criterion holds
"whether or not its OK is pressed". F-0403 5.0 step 4 and AC-17 (OK reopens the folder locally) still hold.

## 1. On main

`trustedFolder` (`packages/remote-containers/src/connect/connector.ts`) awaits `dependencies.showDeclined(S360,
S377)`, which is `showInformationMessage(…, {modal: true, detail})` in `extension.ts`, and only then calls
`reopenLocally`. So the window waits for OK indefinitely.

## 2. The change (connector.ts only)

- Next to `CANONICAL_READ_MILLISECONDS`, add
  `/** How long the decline's modal waits for its OK before the folder reopens locally, in milliseconds (F-0301 6.9 step 5). */ const DECLINED_MODAL_MILLISECONDS = 5000;`
- In `trustedFolder`, replace `await dependencies.showDeclined(…);` with a wait that ends at the first of the
  modal's end (OK, Escape or a rejection) and the timer. Use `dependencies.preflight.setTimer`, the way
  `readWithinCap` does, and stop the timer when the modal ends first. Then `reopenLocally` runs as today. Don't
  await the modal after the timer has fired.
- Extend the function's comment: "…with the modal that says why when the user declined, for as long as its OK or
  five seconds take."
- Nothing in `extension.ts` changes. One path serves every flow that reaches `trustedFolder` (Reopen, Open Folder in
  Container, a reload).

## 3. Rows

**Unit** (`packages/remote-containers/test/unit/connector.test.ts` and its fixture):
- Fixture: `Scene` gains `/** Whether the decline's modal stays open until the test ends it. */ declinedHeld: boolean`
  (default false). When it's true, `showDeclined` records its call as now and returns a promise that never resolves.
- The existing row `F-0106 6.4a, AC-42: a decline shows S360 with S377, reopens the folder locally…` stays.
  Add to it that no timer is left pending after the connect (the 5 s timer was stopped because OK came first).
- `F-0301 AC-68: with the decline's modal left open, the folder reopens locally when its 5 s are up, not before`.
  Set `declinedHeld`, start the connect without awaiting it, and let the microtasks run (`await new Promise(resolve => setImmediate(resolve))`).
  `scene.trustCalls` then has `showDeclined …` and no `reopenLocally`, and the last entry of `scene.timerDelays` is
  5000. Call the one pending timer. Then the connect ends `trustDeclined` (silent), and `scene.trustCalls` ends with
  `reopenLocally /work/proj`.
- `F-0301 AC-68: a modal that fails still reopens the folder locally`. `showDeclined` rejects, and `reopenLocally`
  runs with no timer left pending. Add a fixture option `declinedFails: boolean` if you need it, beside `declinedHeld`.

**Acceptance**, a new row in `tests/acceptance/containers-trust/gate.test.ts`, after o6, copying o6's setup with its
own folder names (`open-wait`, `open-wait-from`):
- **`F-0301 AC-68 (o7): declining shows S360, and with no OK pressed the window is the local folder within 10 s, restricted, with no container`**.
  Cancel core's trust dialog as o6 does, and wait for the S360 dialog. **Don't answer it.** From the moment it shows,
  `waitFor` the window's `remoteName` to be `null` within **10 s** (the criterion's "about 10 s"). Expect
  `{declined: [S360, true, ['OK']], trusted: false, containers: []}` as o6 does, and `dialogOf('open-wait')` to be
  `undefined` afterwards.
- o6 stays as it is. Athena: it may keep citing F-0403 AC-17, as the OK half.
- If `vscode.openFolder` doesn't reload the window while the modal is open (o7 times out with the dialog still
  showing), stop and report it on this issue with the log. Don't close the modal from the code.

**Coverage.** `docs/architecture/catalogue/coverage-containers-r1.tsv`: `F-0301.AC-68` goes from `todo` to
`acceptance`.

## 4. Done when

- The unit tests pass, with connector.ts at 100 % in the remote-containers gate.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-trust` passes (paste the summary
  line), with o6 still green.
- The whole diff is linted, `jscpd`, `knip` and `check-coverage` are clean.
- PR title: `remote-containers: after a trust decline the folder reopens locally on OK or after 5 s (card containers-58, #1155)`.
  Request athena only.
