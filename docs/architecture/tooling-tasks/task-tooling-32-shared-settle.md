# Task card tooling-32: every runner launch settles 2 s after its last row

Issue: #698. Release 0.2, tooling (R-99): it isn't a product row, but a red VSCodium job blocks the D-65 gate's
evidence. Size: S. Builder: assigned by hermes. Verification: proteus.

## 1. Why

The VSCodium acceptance job is red on most runs although every row passes (proteus, #698). The signature is always the
same:
- the launch's extension host exits 0;
- the editor's main process then dies with SIGSEGV, as the window closes right after the tests end (#632's teardown
  race);
- test-cli reports the launch failed.

It hits about 4% of launches, and a full run has about 65.

suite-client already avoids it with a 2 s hold in an `after` hook (`SETTLE_MILLISECONDS`, "an editor closed within
moments of its connect crashes on exit"). The other suites have no hold.

## 2. The change

1. **`tests/acceptance/suite/settle.ts`** (new). It holds one root-level hook, outside any `describe`:

   ```ts
   /** How long a window stays open after its last row: an editor closed within moments of its connect crashes on exit. */
   export const SETTLE_MILLISECONDS = 2000;

   after(async () => {
     await new Promise<void>(resolve => {
       setTimeout(resolve, SETTLE_MILLISECONDS);
     });
   });
   ```

   A root-level `after` in a loaded file runs once, after every suite of the mocha run.
2. **`tools/acceptance.ts` `bundleFolder`:** every suite bundle also gets `settle.ts`, as the extra entry point
   `<output>/settle.test.cjs`, so each runner configuration's `files` glob (`dist-*/**/*.test.cjs`) loads it.
   - Only the runner launches' suites get it: `suitesOfRun` and the test-cli configurations. The plain launches stop
     the editor themselves (`runPlainLaunch`) and aren't in the evidence, so they're unchanged.
   - The bundle for the shared `suite` folder (`dist`) gets it the same way.
3. **`tests/acceptance/suite-client/client.test.ts`:** its own `after` hold and `SETTLE_MILLISECONDS` go. The shared
   one replaces them.
4. **`tests/acceptance/README.md`:** one sentence under "Launches": every runner launch's window stays open 2 s after
   its last row, because the editor crashes on exit when it closes within moments of a connect.

The mocha timeout is unaffected: 60 s per hook, and the hold is 2 s.

## 3. Rows

| Cite | Given | Expected |
|---|---|---|
| tooling-32 | `bundleSuite` over a temporary workspace with two suites (`tools/acceptance.test.ts`, as its bundle rows do) | each output folder holds `settle.test.cjs` beside the suites' own bundles |
| tooling-32 | the bundled `settle.test.cjs` run by a plain mocha over one passing test file (a tools row that runs mocha as a child, as `acceptance-plain.test.ts` does) | the run takes at least 2000 ms after the last test, and exits 0 |
| tooling-32 | the suite-client bundle | it no longer defines its own hold (its source has no `SETTLE_MILLISECONDS`) |

**Verification (the done-when):** proteus runs 3 VSCodium dispatches on the PR and reports the SIGSEGV count per
launch. The goal is no SIGSEGV in the three runs. Fewer than before but still some is reported on #698, and the PR
stays open: a longer hold isn't added by guess.

## 4. Gates and review

All gates, and one full VSCodium run green locally. PR title `tools, tests: every runner launch settles 2 s after its
last row (card tooling-32, #698)`. themis or triton reviews; proteus verifies.

## 5. Open rows (stop and report on #698)

1. A root-level `after` in a separate bundle doesn't run in test-cli's runner (for example, if each file gets a fresh
   root). Report how test-cli loads the files. The fallback is a `mocha.require` entry in the configurations: name it,
   don't build it.
2. A plain launch crashes the same way in the verification runs. Report it; plain launches need their own card.
