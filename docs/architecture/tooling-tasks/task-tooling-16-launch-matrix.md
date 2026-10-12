# Task card tooling-16: per-launch settings and environment, and the terminal-mode launch (D-85)

Issue: #488. Why: D-85 (the user, on #142): 0.2's harness builds the capabilities coverage-03's lists name. This card is the base
the others use, plus one capability, **terminal mode**. Today every VSCodium launch shares one `settings.json` and one
environment. A launch that needs `remote.SSH.useLocalServer: false` (terminal mode), a slow remote extension host
(tooling-18) or a CLI source (cli-05) has no place to say so. Builder: iris. Size: M.

## 1. Files

| File | Change |
|---|---|
| `tools/acceptance-launches.ts` | new: the table of launches (section 2) |
| `tools/acceptance.ts` | `vscodiumConfigurations`, `labelsOf`, `SUITES` and the label loop read the table; settings written per launch (section 3) |
| `tools/acceptance.test.ts`, `tools/acceptance-launches.test.ts` | rows (section 5) |
| `tests/acceptance/suite-terminal/terminal-mode.test.ts` | new: the capability's row (section 4) |
| `tests/acceptance/README.md` | "Launches": the table's columns, and how to add a launch |

## 2. The table

```ts
/** One launch of the VSCodium run, in the order the run makes them. */
export interface Launch {
  /** The test-cli label: lower-case letters, digits and hyphens. */
  label: string;
  /** The development extension the tests run in: `runner` (a local window) or `runner-remote` (a remote one). */
  runner: 'runner' | 'runner-remote';
  /** The suite folder under tests/acceptance, bundled into `dist-<suite without "suite-">`. */
  suite: string;
  /** The window's folder; none for a local window. */
  folderUri?: string;
  /** Settings merged over the run's base settings for this launch only. */
  settings?: Readonly<Record<string, unknown>>;
  /** Variables added to the extension host's environment for this launch only. */
  environment?: Readonly<Record<string, string>>;
  /** Whether the launch answers from its own script and record files (`<label>-script.json`, `<label>-record.jsonl`). */
  ownScript?: boolean;
  /** Further development extensions, folders under tests/acceptance, loaded after the runner. */
  extraExtensions?: readonly string[];
}
```

`LAUNCHES(root)` returns today's launches unchanged, in today's order: `local`, `remote`, `reconnect`, then one
`failure-<alias>` per `cases.json` entry. `terminal` follows them (section 4). `SUITES` becomes the distinct `suite`
values of the table, plus `suite` (the shared helpers), so a new launch's suite is bundled with no second list to
edit. The VS Code run (one configuration, no label) is unchanged.

## 3. Settings and environment per launch

- `writeUserSettings(runFolder, configFile, extra = {})` writes `{'remote.SSH.configFile': configFile, ...extra}`.
- Before each launch, the label loop writes the user settings with that launch's `settings`. The base settings are
  written again before a launch without any, so no launch inherits another's.
- `vscodiumConfiguration` gives `extensionDevelopmentPath` as a list, the runner then the launch's
  `extraExtensions`, when there are any (test-cli takes a string or a list).
- `vscodiumConfiguration` adds the launch's `environment` to the `env` it already builds. A key of the launch overrides
  the harness variable of the same name.
- The variables of section 4 of the README are unchanged.

## 4. The terminal-mode launch

| Field | Value |
|---|---|
| `label` | `terminal` |
| `runner` | `runner-remote` |
| `suite` | `suite-terminal` |
| `folderUri` | `vscode-remote://ssh-remote+harness/home/harness` |
| `settings` | `{'remote.SSH.useLocalServer': false}` |

`suite-terminal/terminal-mode.test.ts` holds one row proving the capability:

| Name | Assertion |
|---|---|
| `D-85: a launch with remote.SSH.useLocalServer false connects in terminal mode` | `deepStrictEqual([vscode.env.remoteName, vscode.workspace.getConfiguration('remote.SSH').get('useLocalServer')], ['ssh-remote', false])` |

The F-2304 and F-2102 rows that need terminal mode are written later, from #481's and #474's lists, in this suite.

## 5. Rows (`tools/`)

One assertion per `it`.

| Cite | Given | Expected |
|---|---|---|
| D-85 | `LAUNCHES(root)` with the repository's `cases.json` | the labels are `local`, `remote`, `reconnect`, the `failure-…` labels in the file's order, then `terminal` |
| D-85 | the same | every label matches the alias form `^[a-z][a-z0-9-]*$` |
| D-85 | `vscodiumConfigurations` | the configurations equal, field for field, what they were before this card for today's labels (compare with the configurations built from the old code's values) |
| D-85 | the `terminal` launch | its configuration's `launchArgs` hold `--folder-uri vscode-remote://ssh-remote+harness/home/harness` |
| D-85 | a launch with `environment: {X: '1'}` | its configuration's `env.X` is `'1'` |
| D-85 | a launch with `extraExtensions: ['slow-remote']` | `extensionDevelopmentPath` is `[<runner path>, <tests/acceptance/slow-remote>]` |
| D-85 | a launch whose `environment` sets `REMOTE_OSS_ACCEPTANCE_RECORD` | the launch's value wins |
| D-85 | the label loop over `terminal` then `remote` | `settings.json` holds `useLocalServer: false` during `terminal`, and only `remote.SSH.configFile` during `remote` |
| D-85 | `SUITES` | holds `suite-terminal` once, with no second list in the code |

Plus: the VSCodium run (`pnpm test:acceptance:vscodium`) passes with the new launch. Paste its summary in the PR body.

## 6. Gates and review

The repository's gates, `tools/` at its ratchet. PR title `tests: per-launch settings, and the terminal-mode launch
(card tooling-16, D-85)`. proteus reviews.
