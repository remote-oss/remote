# Task card ssh-36: one check for `remote.SSH.configFile`, which rejects a value that is not absolute

Why: #449; metis on `remote-oss/remote-ssh#30` Q1 (option (a), reject), in F-2203 7.E3 and F-2201 BR-3 and 7.E8; contracts
S2 (4cc4c03). A value of `remote.SSH.configFile` that is still not absolute after `~` expansion (a relative path, or one
starting with `$`) is an invalid setting. All three places that read it judge it by **one** lib-ssh check. Today they
differ:
- `-F` passes the value to `ssh` as written, so `ssh` reads a file relative to its working directory;
- the host list skips a non-absolute root (`readTree`);
- "Open SSH Configuration File" resolves the value under the home folder (`pathOf` in `open-config-file.ts`, #407),
  which F-2203 7.E3 now forbids.

Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/config/files.ts` | `configFilePath` (section 2.1); `filesInEffect` uses it |
| `packages/lib-ssh/src/arguments/invocation.ts` | `configFileArguments` uses it (section 2.2) |
| `packages/lib-ssh/src/index.ts` | export `configFilePath`, `type ConfigFileSetting` |
| `packages/remote-ssh/src/pipeline/locate-step.ts` | the connect's check (section 2.3) |
| `packages/remote-ssh/src/config/open-config-file.ts` | the command's check (section 2.4) |
| `packages/remote-ssh/src/surfaces/own-strings.ts` | `configFileNotAbsolute` (section 2.4) |
| `packages/remote-ssh/l10n/bundle.l10n*.json` | the new text, English in every bundle (as the others are until translated) |
| tests: `packages/lib-ssh/test/unit/config-files.test.ts`, `invocation.test.ts`, `hosts.test.ts`; `packages/remote-ssh/test/unit/locate-step.test.ts`, `open-config-file.test.ts` | rows (section 3) |

## 2. Contract

### 2.1 `configFilePath`, the one check

```ts
export type ConfigFileSetting =
  | {kind: 'unset'}                    // '' or only white space
  | {kind: 'file'; path: string}       // absolute after `~` expansion
  | {kind: 'invalid'; value: string};  // anything else, `value` as written

/** What `remote.SSH.configFile` names: no file, an absolute file, or an invalid value. */
export function configFilePath(value: string, homeFolder: string, platform: ClientPlatform): ConfigFileSetting;
```

- `value.trim() === ''` is `unset` (F-2201 BR-2: the default files apply).
- Otherwise `expanded = expandHome(value, homeFolder, platform)` (unchanged: `~` alone and a leading `~/`, plus `~\` on
  Windows). `pathsFor(platform).isAbsolute(expanded)` gives `file` with `path: expanded`, and anything else gives
  `invalid` with `value`.
- So `relcfg/rel_config`, `./x`, `$HOME/x`, `${env:HOME}/x` and `~user/x` are `invalid`. `~` alone is `file` (the home
  folder; reading it fails later, as F-2201 7.E8 records for a folder). On Windows, `C:\x` and `\\server\share\x` are
  `file`, and `C:x` is `invalid`.

### 2.2 lib-ssh's two readers

- `configFileArguments`: `unset` gives no arguments. `file` gives `['-F', path]`. `invalid` **throws**
  `Error('remote.SSH.configFile is not absolute')`, because a caller must have refused before (section 2.3), and `ssh`
  never gets a relative `-F` (S2).
- `filesInEffect`: `unset` gives the default files, as today. `file` gives the configured file, as today. `invalid`
  gives `[]`, so the host list offers no hosts from it, silently (F-2201 BR-7). `readTree`'s own `isAbsolute` guard
  stays as a second line.

### 2.3 The connect

At the start of `locateClientStep`'s step, before any candidate is tried (so before any `ssh` starts):
`configFilePath(dependencies.configFile(), dependencies.homeFolder, dependencies.platform)`. On `invalid`:
- `dependencies.logger.error(\`remote.SSH.configFile is not an absolute path: "${value}"\`)`;
- return `{kind: 'failed', failure: {kind: 'unknown'}}`, which the presenter shows as F-2601's reasonless dialog
  (`Could not establish connection to "<alias>".`, F-2201 7.E8, AC-35).

### 2.4 The command

`pathOf` loses its `path.resolve(homeFolder, …)`. For a `configured` row the handler calls `configFilePath(label, …)`:
- `file`: go on with `path`, as today;
- `invalid`: throw `new Error(ownText({id: 'configFileNotAbsolute', values: [value]}, translate))` from `execute`, before
  `exists`, `missingFolders` or any create. The editor's command service shows its command-error dialog with the
  command's title and this text as the detail (F-2203 7.E3, AC-32). Nothing is created or opened.

`OWN_TEMPLATES` gains `configFileNotAbsolute: 'remote.SSH.configFile must be an absolute path or start with ~/: "{0}"'`.
F-2203 3.4 gives this text, marked [adaptation].

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2201 BR-3 | `configFilePath` of `''`, `'  '` (one `it` each) | `unset` |
| F-2201 BR-3 | of `/etc/x`, `~/x`, `~` on Linux with home `/h` (one each) | `file` with `/etc/x`, `/h/x`, `/h` |
| F-2203 7.E3 | of `relcfg/rel_config`, `./x`, `$HOME/x`, `${env:HOME}/x`, `~user/x` on Linux (one each) | `invalid` with the value as written |
| F-2201 BR-3 | of `C:\x`, `\\s\sh\x`, `~\x` on Windows with home `C:\h` (one each) | `file` with `C:\x`, `\\s\sh\x`, `C:\h\x` |
| F-2203 7.E3 | of `C:x` and `x\y` on Windows (one each) | `invalid` |
| S2 | `buildInvocation` with `configFile: 'relcfg/x'` | it throws `remote.SSH.configFile is not absolute` |
| S2 | `buildOptionsQuery` with `configFile: 'relcfg/x'` | it throws the same |
| F-2201 BR-7 | `listHosts('relcfg/x', …)` with a reader that has `relcfg/x` and `/h/.ssh/config`, both with hosts | `{hosts: []}` |
| F-2201 7.E8 | the locate step with `configFile: 'relcfg/x'` | `{kind: 'failed', failure: {kind: 'unknown'}}` |
| F-2201 7.E8 | the same | no process was run (the recording runner has no call) |
| F-2201 7.E8 | the same | the logger got one error `remote.SSH.configFile is not an absolute path: "relcfg/x"` |
| F-2203 AC-32 | the command with `configFile: 'relcfg/rel_config'`, the configured row picked | it rejects with the error text `remote.SSH.configFile must be an absolute path or start with ~/: "relcfg/rel_config"` |
| F-2203 AC-23 | the same | `files` got no `exists`, `missingFolders`, `makeFolder` or `createFile` call, and `editor.open` was not called |
| F-2203 7.E3 | the command with `configFile: '~/cfg'`, home `/h`, the file missing | it opens `/h/cfg` (unchanged) |

The existing row of #407 that expects a relative value to resolve under the home folder is **replaced** by the AC-32
row. Say so in the PR.

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: one check for remote.SSH.configFile, which rejects a relative value (card ssh-36,
remote-ssh#30)`.

## 6. Open rows

None.
