# Task card coverage-05: unit rows for the platform entries, the application-scope settings and the plain authority (#142)

Issue: #482. Why: coverage-03a's list (#473, draft PR #481, "Needs a unit row") names ACs whose behaviour our code already has but
no row cites. This card writes those rows, one assertion each, named by the AC. Every row below was written and run on
main f6b82ed (2026-10-12): all nine pass, and lint, typecheck and dupes are clean. Builder: selene.

## 1. Files

| File | Change |
|---|---|
| `packages/remote-ssh/test/unit/platform.test.ts` | rows 1–4 (section 2) |
| `packages/remote-ssh/test/unit/connect-ports.test.ts` | rows 5–7 (section 3) |
| `packages/lib-authority/test/unit/codec-ssh-remote.test.ts` | row 8 (section 4) |

Test files only. Don't change any source file, any existing row, or `docs/architecture/catalogue/coverage-slice1.tsv`.
hestia tags these ACs in #481 once your rows are on main.

## 2. platform.test.ts

Add a new `describe('the platform rows of F-2206', () => { … })` at the end of the file. The file already imports
`platformEntry` and `decidePlatform`, and its helper `settings(changes)` gives `{useLocalServer: true, remotePlatform:
undefined, windowsRemotes: [], ...changes}`. Use them.

| # | `it` name | Assertion |
|---|---|---|
| 1 | `F-2206 AC-18: an exact key wins over a wildcard, in either order` | `deepStrictEqual([platformEntry({'*': 'windows', devbox: 'linux'}, 'devbox'), platformEntry({devbox: 'linux', '*': 'windows'}, 'devbox')], ['linux', 'linux'])` |
| 2 | `F-2206 AC-19: of two matching wildcards the first wins, so the swapped order connects` | `deepStrictEqual([decidePlatform(settings({remotePlatform: {'lab-*': 'windows', 'lab-one*': 'linux'}}), 'lab-one-x'), decidePlatform(settings({remotePlatform: {'lab-one*': 'linux', 'lab-*': 'windows'}}), 'lab-one-x')], [{kind: 'decided', platform: 'windows'}, {kind: 'probe'}])` |
| 3 | `F-2206 AC-20: an upper-case key, an address key and a key with ? never match; a *<suffix> key does` | `deepStrictEqual(['DEVBOX', '192.0.2.10', 'devb?x', '*box'].map(key => decidePlatform(settings({remotePlatform: {[key]: 'windows'}}), 'devbox')), [{kind: 'probe'}, {kind: 'probe'}, {kind: 'probe'}, {kind: 'decided', platform: 'windows'}])` |
| 4 | `F-2206 AC-22: a wildcard in remote.SSH.windowsRemotes has no effect in default mode` | `deepStrictEqual(decidePlatform(settings({windowsRemotes: ['lab-*']}), 'lab-one'), {kind: 'probe'})` |

## 3. connect-ports.test.ts

Add a new `describe('application-scope settings ignore workspace values', () => { … })` at the end of the file, with
this helper as its first statement:

```ts
  /** A setting host whose remote.SSH.path, configFile and remotePlatform are set only in the workspace and the folder. */
  const WORKSPACE_ONLY: SettingHost = {
    inspectSetting: settingId =>
      ({
        'remote.SSH.path': {defaultValue: '', workspaceValue: '/w/ssh', workspaceFolderValue: '/f/ssh'},
        'remote.SSH.configFile': {defaultValue: '', workspaceValue: '/w/config', workspaceFolderValue: '/f/config'},
        'remote.SSH.remotePlatform': {defaultValue: undefined, workspaceValue: {devbox: 'windows'}, workspaceFolderValue: {devbox: 'windows'}},
      })[settingId] ?? {defaultValue: undefined},
  };
```

Imports, exactly as tried on main: change `import type {SettingInspection} from 'lib-identifiers';` to
`import type {SettingHost, SettingInspection} from 'lib-identifiers';`, and add, just before the import of
`../../src/surfaces/prompt-surface.ts`:

```ts
import {
  connectionSettingsOf,
  termsSettingsOf,
  textOf as settingTextOf,
} from '../../src/pipeline/connect-settings.ts';
import {decidePlatform} from '../../src/pipeline/platform.ts';
```

(`settingTextOf`, because the file already imports a different `textOf` from `prompt-strings.ts`.)

| # | `it` name | Assertion |
|---|---|---|
| 5 | `F-2101 AC-13: a remote.SSH.path set only in workspace settings is never used` | `deepStrictEqual(settingTextOf(WORKSPACE_ONLY, 'path'), '')` |
| 6 | `F-2201 AC-14: a remote.SSH.configFile set only in workspace settings is ignored` | `deepStrictEqual(connectionSettingsOf(WORKSPACE_ONLY).configFile, '')` |
| 7 | `F-2206 AC-23: a workspace remotePlatform entry is ignored, so non-local mode asks` | `deepStrictEqual(decidePlatform({...termsSettingsOf(WORKSPACE_ONLY), useLocalServer: false}, 'devbox'), {kind: 'ask'})` |

## 4. codec-ssh-remote.test.ts

Add one row at the end of the existing `describe('ssh-remote codec (card authority-01 table)', …)`:

| # | `it` name | Assertion |
|---|---|---|
| 8 | `F-2301 AC-12: a host with no upper-case letter, user, port or separator stays plain, as written` | `deepStrictEqual(['ü.invalid', 'a=b.invalid', 'a*b.invalid', "a'b.invalid", 'fe80::1'].map(text => sshRemoteCodec.encode({kind: 'host', hostName: text})), ['ü.invalid', 'a=b.invalid', 'a*b.invalid', "a'b.invalid", 'fe80::1'])` |

The encoded half of AC-12 (upper case, `/`, `+`, `\`, a user, a port) is proven by the rows already in that `describe`.
Rename the row `'encode of Mixed.invalid, Ü.invalid, a/b, a+b and a\\b -> the hex JSON form each'` to
`'F-2301 AC-12: encode of Mixed.invalid, Ü.invalid, a/b, a+b and a\\b -> the hex JSON form each'`. Change nothing else
in it.

## 5. Done when

- the eight new rows and the one rename are in, and every one passes;
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm dupes` and `pnpm coverage` pass;
- once #467 has merged, `pnpm check-coverage` passes too and its report is unchanged apart from your new cites.

If an assertion fails as written, don't change the expected value. Stop and report the actual value on the issue:
it means the code changed after this card was written.

## 6. Review

PR title `tests: unit rows for the platform entries, workspace-only settings and the plain authority (card coverage-05,
#142)`. themis or triton reviews.
