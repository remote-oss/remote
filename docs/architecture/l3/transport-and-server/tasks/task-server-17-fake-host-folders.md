# Task card server-17: the fake host's folders are removed after each test

Why: found while wiring E6c-3 (#140). lib-server's test fixture `fakeHost()` (`test/unit/fake-host.ts`) makes a folder
`fake-host-*` under the system's temporary folder for every test that uses it, with a server archive and, after an
install, an installed server tree, and **nothing ever removes it**. One run of the lib-server suite leaves about 350 such
folders; this room had 6,472 of them, enough to fill the file system's metadata (git then failed with "unable to write
new index file", a rename refused as `ENOSPC`). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/test/unit/fake-host.ts` | the fixture records its folders and removes them after each test (section 2) |
| `packages/lib-server/test/unit/fake-host.test.ts` | new: the rows of section 3 |

Nothing else. No test file that calls `fakeHost()` changes.

## 2. Contract

- `fakeHost()` adds the root folder it makes to a module-level list of folders made since the last cleanup.
- The module registers one **root-level** mocha hook, `afterEach(removeFakeHosts)`, at the top level of
  `fake-host.ts` (outside any `describe`). Mocha runs root hooks after the `afterEach` hooks of every suite, so a
  suite's own `afterEach` (which stops the host's servers with the `kill` script) runs first, while the folder still
  exists.
- `removeFakeHosts()` (exported for the test of section 3) removes each listed folder with
  `rmSync(folder, {recursive: true, force: true})` and empties the list. A folder that is already gone is not an error.
- Nothing else in the fixture changes.

## 3. Test table

One assertion per `it`; the cite starts the name. In `fake-host.test.ts`.

| Cite | Given | Expected |
|---|---|---|
| server-17 | `fakeHost()`, then `removeFakeHosts()` | the host's root folder (the parent of `host.home`) no longer exists |
| server-17 | two `fakeHost()` calls, then `removeFakeHosts()` | neither root folder exists |
| server-17 | `fakeHost()`, its root removed by the test, then `removeFakeHosts()` | no exception |
| server-17 | `removeFakeHosts()` twice after one `fakeHost()` | no exception (the list was emptied) |
| server-17 | the whole lib-server unit suite run once (checked by hand, not a row) | no `fake-host-*` folder left in the temporary folder |

The existing lib-server tests pass unchanged.

## 4. Rule for the worker

As card log-01; coverage at lib-server's ratchet (`test/` is not measured; the new rows keep the fixture honest).

## 5. Gates and review

PR title `lib-server: the fake host's folders are removed after each test (card server-17)`.

## 6. Open rows

None.
