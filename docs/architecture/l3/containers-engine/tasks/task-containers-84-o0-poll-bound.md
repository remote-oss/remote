# Task card containers-84: o0 polls forever when the window doesn't connect, and hides why (F-0403 AC-17)

Containers release 1. Size: S. Builder: `task:claude`. `F-0403 AC-17 (o0)` (`tests/acceptance/containers-trust/gate.test.ts`,
`containers-trust` launch) hit mocha's 600 s timeout on CI (dispatch 39408493001, X64). The editor's failure to quit
after it is fixed in #1254.

## 1. The row's own bug (daedalus, reading main)

The row polls `dialogOf('open-trusted')` in `while (!progress.connected)`. `progress.connected` is set only when
`connectedToContainer('open-trusted')` resolves. When it rejects (after its 300 s), the loop never ends, and the
rejection that names the cause is never seen. So any failure to connect becomes a 600 s hang.

## 2. The change

1. **The loop ends on either outcome:**
   - keep the outcome, `progress = {settled: false, failure: undefined as unknown}`;
   - set `settled` on resolve, and `failure` plus `settled` on rejection;
   - loop `while (!progress.settled)`;
   - after the loop, a failure fails the row with its message plus the dialogs seen (`shown`).
2. **Then find why the window didn't connect.** Run the `containers-trust` launch three times. For a failure, read
   the dialogs `shown` collected and the Dev Containers log (`containersLogSince`):
   - a product cause gets a fix with a unit row;
   - a harness cause (the window name `open-trusted` reused after `trustedContainerWindow` closed the first window on
     the same folder, or the trust not kept) gets a row fix;
   - if it never fails in three runs, say so in the PR. The loop fix is then the change.

## 3. Done when

The row passes, or fails in seconds with its cause, in three local runs of `node tools/acceptance.ts --editor vscodium
--launches containers-trust` (paste the summary lines). All gates pass. PR title: `tests: o0 ends when the window
fails to connect, and says why (card containers-84, #1257)`. Request athena only.
