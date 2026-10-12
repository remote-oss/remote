# Task card tooling-21: a 10 s default timeout for every unit suite

Issue: #494. Why: triton on #475, then selene's run (hermes, 2026-10-12). Many unit suites run real processes under
Mocha's 2 s default, and a busy runner times them out at random:
- lib-ssh: `shell-runs.test.ts` and `askpass-launcher.test.ts`;
- lib-server: every suite over the fake host's real shell (`test/unit/fake-host.ts`, `shell-channel.ts`), which are
  `bootstrap-script`, `cli-script`, `cli-lifecycle`, `lifecycle`, `extensions`, `runtime`, `transfer` and `fake-host`;
- `bootstrap-script.test.ts` failed on selene's run and passed on a re-run.

Setting the timeout suite by suite (this card's first version) would leave every new suite to remember it. So this
card sets **one default for the whole unit run**, 10 000 ms. Tried on main 4dd35ae: the new row fails without the
argument and passes with it. The suites that set their own keep it: `this.timeout` in
a suite wins over the default. Builder: selene.

## 1. Files

| File | Change |
|---|---|
| `.mocharc.json` | `"timeout": 10000` |
| `tools/coverage.ts` | the Mocha arguments it builds (line 191 on main, after `'--extension=ts'`) gain `'--timeout=10000'`: it runs Mocha with `--no-config`, so it doesn't read `.mocharc.json` |
| `tools/coverage.test.ts` | one row (section 3) |

Nothing else: no test file changes, and the existing `this.timeout(20000)` and `this.timeout(60_000)` stay.

## 2. Exact edits

`.mocharc.json` becomes:

```json
{
  "spec": ["tools/**/*.test.ts", "packages/*/test/unit/**/*.test.ts"],
  "extension": ["ts"],
  "timeout": 10000
}
```

In `tools/coverage.ts`, the array that holds `'--no-config'` and `'--extension=ts'` gets `'--timeout=10000'` right after
`'--extension=ts'`.

## 3. Row (`tools/coverage.test.ts`)

`measureUnit` runs real c8 and Mocha in the file's temporary workspace, as the rows of `describe('measurement')` do.
Add one row at the end of that `describe`, in the same form as `'returns nothing when the tests fail'`:

```ts
    it('tooling-21: a unit test of 2.5 s passes under the 10 s default', function () {
      this.timeout(30_000);
      workspace.write(
        'packages/remote-a/test/unit/slow.test.ts',
        "it('waits', async () => {\n  await new Promise(resolve => setTimeout(resolve, 2500));\n});\n",
      );
      notStrictEqual(measureUnit(workspace.root, packageUnit(), []), undefined);
    });
```

Without `--timeout=10000` the slow test fails at Mocha's 2 s default and `measureUnit` returns `undefined`, so the row
proves the argument. Import `notStrictEqual` from `node:assert` beside the file's other assertions.

## 4. Done when

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit` and `pnpm coverage` pass, with the same number of
  passing rows as before plus the one new row;
- `tools/` stays at its ratchet.

## 5. Review

PR title `tests: a 10 s default timeout for the unit run and the coverage run (card tooling-21)`. proteus reviews (it
changes how CI runs the unit tests); themis or triton too.
