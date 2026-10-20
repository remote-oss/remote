# Task card server-25: split bootstrap-script.test.ts so `--parallel` spreads it, and shorten its waits

Issue: #1127. CI throughput (proteus, 2026-10-20). Size: S–M. Builder: `task:claude`. **No product change.**

## 1. Why

`packages/lib-server/test/unit/bootstrap-script.test.ts` (2,752 lines) takes about 88 s of lib-server's 98 s unit
run. Its rows run the real POSIX scripts, and many wait about 2.2 s each: the kill and uninstall group, the "a server
that is already there, and the lock" group, and socket mode (#299) at 3.2 s. Since #1126, unit tests run with
`mocha --parallel` and coverage runs in four shards. `--parallel` works per file, though, so this one file bounds
both the unit job and the coverage shard that holds lib-server: about 7.6 min of a run's 7.9 on GitHub's runner.
Proteus tried `--parallel` inside c8, and it's no faster and changes c8's branch totals, so that route is out.

## 2. The change

1. **Measure first:** `npx mocha --no-config --extension ts --reporter json --spec
   packages/lib-server/test/unit/bootstrap-script.test.ts > durations.json`, and list the rows over 1 s with their
   groups. Put the table in the PR.
2. **Split by `describe` group** into four files, keeping every row as it is, its name included:
   - `bootstrap-script-probe-install.test.ts`: the `probe`, `install` and `stepwise install` groups;
   - `bootstrap-script-start.test.ts`: `start`;
   - `bootstrap-script-maintenance.test.ts`: `kill, uninstall and cleanup`, and `delivery and the other interpreter`;
   - `bootstrap-script-lock.test.ts`: `a server that is already there, and the lock`.

   Each file keeps the outer `describe('the POSIX bootstrap script', …)` with its own `beforeEach` and `afterEach`.
   The helpers above the first `describe` (`statusAndFacts`, `statusOf`, `serverFactsOf`, `stopServers`,
   `downloadersCalled`, `unpackPercents`, `smallestStep`, `lockInTemporaryFolder`, `holdLinkLock`, `stubLink`, and
   whatever the hooks share) move once to `test/unit/bootstrap-script.fixture.ts`. No duplicated code: jscpd must stay
   at 0 clones.
3. **Shorten the waits that are parameters.** Where a slow row waits on a timing the script takes as a parameter
   (`READY_SECONDS` through `start.readySeconds`, the lock loop's interval and attempts, `DOWNLOAD_SECONDS`), pass
   the smallest value that still proves the row's point, the way `start.test.ts`'s acceptance rows pass
   `readySeconds: 2`. A row whose point *is* the wait (it asserts that the script waited so long) keeps its value. A
   wait that's a constant in the script stays as it is: no product change for test speed. List each changed value in
   the PR, with the row's point.
4. **Polls for fixed sleeps (amended on #1135, proteus).** A fixed sleep in the rows may become a poll, under three
   conditions agreed through hermes and checked at the design check:
   1. A row whose point is that something does *not* happen within a time (a server left alone, a lock not taken,
      nothing printed) keeps its wait. A poll can only prove that something happened.
   2. Every poll has a bound at least as long as the sleep it replaces, and fails with a message naming what it
      waited for.
   3. The four files pass five runs in a row with the c8 totals unchanged.

   A sleep that can't meet 1 or 2 stays a sleep.

## 3. Rows and gates

Every row still passes and keeps its name. The per-file coverage gate (`packages/lib-server/coverage.json`, 100 %)
and `pnpm coverage` must give the same totals as before. Compare the summary lines in the PR, since a split must not
change what is covered.

Report the lib-server unit job's time and the coverage shard's time on GitHub before and after, from the PR's own CI
run and a recent run on main. The aim is a run of about 4 to 5 min. PR title: `tests: split the POSIX bootstrap
script rows into four files, and shorten their parameter waits (card server-25, #1127)`. Request athena only.
