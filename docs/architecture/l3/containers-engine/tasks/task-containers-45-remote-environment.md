# Task card containers-45: the remote environment, `userEnvProbe` and `remoteEnv`, per connection (F-0416)

Issue: #1059. Milestone 0.4, containers release 1 (the user brought it in, 2026-10-19). Size: M. Builder: `task:claude`.
Design: athena's ruling on #1049, in `brief-release-1.md` (#1055). Card containers-42 (#1051) writes F-0416's group B
rows after this card merges; this card brings the unit rows and two acceptance rows of its own.

Sources: F-0416 (remote-oss/remote-containers#63) 5.0 steps 7–8, BR-9, BR-10, BR-11, BR-11a, BR-11b, BR-13, 6.10,
7.E1a, 7.E5–7.E7; the resolver host's `Connected.extensionHostEnv` (`packages/lib-authority/src/connector/results.ts`);
C3's `readConfiguration` with a container id (`cli-arguments.ts`: `--container-id … --include-merged-configuration`);
C11's `execChannelOf(containerId, user)`.

## 1. The rule

Once per connection, after C7 has the container and C3 has read the merged configuration with the container id
(`connector.ts`, the `bridge.readConfiguration(…, prepared.containerId, …)` call that exists):

1. **`remoteEnv` and `userEnvProbe` come from the merged configuration** (`mergedConfiguration.remoteEnv`,
   `mergedConfiguration.userEnvProbe`), so image metadata and the CLI's interpolation (BR-9) are the CLI's. A
   `remoteEnv` value that is a string is kept, `null` is kept (it removes the variable), anything else is dropped
   with one log line naming the variable (never its value).
2. **The probe**, unless `userEnvProbe` is `none`: run over `execChannelOf(containerId, remoteUser)` (the channel the
   server steps use), as one POSIX script that finds the remote user's shell: the seventh field of
   `getent passwd "$(id -un)"` when `getent` exists, else of the `/etc/passwd` line whose first field is `$(id -un)`;
   `/bin/sh` when neither gives one and runs it in the mode's flags:
   `loginInteractiveShell` (the default, and the value for anything unknown) `-l -i -c`, `loginShell` `-l -c`,
   `interactiveShell` `-i -c`. The shell's command prints the whole line `remote-oss-env-probe-begin`, then
   `cat /proc/self/environ` (the shell's exported environment, NUL-separated, the same on every Linux libc), then a
   newline and the whole line `remote-oss-env-probe-end`. Anything the start-up files print outside the two lines is
   ignored.
3. **A probe that fails is dropped as a whole** (BR-11b, 7.E5–7.E7): a channel failure, an exit status other than 0,
   no end marker, or longer than 10 s (`AbortSignal.timeout(10_000)` with the connect's cancellation, through
   `AbortSignal.any`). The connect goes on, with one log line `the environment probe was dropped: <reason>`, and no
   dialog or notification.
4. **The merge** (BR-11a): probe result, then `remoteEnv` over it; a `remoteEnv` `null` stays `null` in the result,
   which core reads as "remove". The container's own environment is the server's already, so it isn't part of the
   merge. The result is `Connected.extensionHostEnv` (`connector.ts` builds `extensionHostEnv: {}` today).
5. **Not `environmentSetup`.** That is sourced once at the server's start, so a reused server would keep the old
   environment. Built per connection, an edit of `remoteEnv` or `userEnvProbe` takes effect on the next reload
   without a rebuild (6.9, 6.10).
6. **The log** names the probe's mode, its duration and how many variables it gave, and never a variable's value.

7. **Core's own resolution is off** (proteus and athena on #737, 2026-10-19, option 1): every Containers server
   start passes `--force-disable-user-env`, `userEnvProbe: none` included, so the probe above is the only source of
   the user's environment. Without it, core's server sources the user's login files for the extension host and
   terminals whatever `userEnvProbe` says. With it, a dropped probe (BR-11b) leaves the container's own environment
   plus `remoteEnv`, as F-0416 says.

**The editor's side** is core's. Cite both halves in the PR's R1, from `[oss]`:
- where `extensionHostEnv` reaches the extension host and terminals:
  `src/vs/workbench/services/extensions/common/remoteExtensionHost.ts` (the extension host's environment) and
  `src/vs/workbench/contrib/terminal/browser/remoteTerminalBackend.ts` (the terminal's `resolverEnv`), then
  `src/vs/server/node/extensionHostConnection.ts` and `remoteTerminalChannel.ts`, `buildUserEnvironment`;
- the path the flag turns off: `buildUserEnvironment`'s `getResolvedShellEnv`
  (`src/vs/platform/shell/node/shellEnv.ts`, skipped under `--force-disable-user-env`).

Acceptance rows E1 and E2, and containers-42's rows for F-0416 AC-27, AC-28, AC-29 and AC-31, are the behavioural
proof. The bootstrap row (§3) proves only that the flag is on the server's command line.

## 2. The change

`packages/remote-containers/src/connect/remote-environment.ts` (new, pure):

```ts
/** How `userEnvProbe` starts the remote user's shell. */
export type ProbeMode = 'none' | 'loginShell' | 'interactiveShell' | 'loginInteractiveShell';

/** The mode the merged configuration names; `loginInteractiveShell` when it names none or an unknown one. */
export function probeModeOf(merged: Readonly<Record<string, unknown>> | undefined): ProbeMode;

/** The `remoteEnv` entries that are strings or null; the names of the others, for the log. */
export function remoteEnvironmentOf(merged: Readonly<Record<string, unknown>> | undefined): {
  entries: Readonly<Record<string, string | null>>;
  dropped: readonly string[];
};

/** The probe script for a mode that starts a shell (§1 step 2). */
export function probeScriptOf(mode: Exclude<ProbeMode, 'none'>): string;

/** The environment between the probe's whole-line markers, or undefined when the end marker is missing. */
export function probedEnvironmentOf(stdout: string): Readonly<Record<string, string>> | undefined;

/** The extension host's environment: the probe's, with `remoteEnv` over it (BR-11a). */
export function extensionHostEnvironmentOf(
  probed: Readonly<Record<string, string>> | undefined,
  remoteEnv: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string | null>>;
```

`probedEnvironmentOf` splits the text between the markers on NUL, drops a trailing empty entry, and splits each entry
at its first `=`; an entry without `=` is dropped.

`packages/remote-containers/src/connect/connector.ts`: after the configuration read, run the probe with the server
steps' channel (when the mode isn't `none`), and put `extensionHostEnvironmentOf(…)` into `Connected`. A
configuration read that failed gives `remoteEnv` `{}` and the default mode. No other file changes, except the
fakes the tests need.

**The start option (lib-server).** The contracts edit is #1071 (transport contracts §5.0) and the brief's is #1055
item 5; this card changes neither document.
- `policy/record.ts`: `ExtraStartOption` gains `'forceDisableUserEnv'`; `policy/validate.ts`'s list too.
- `policy/rows.ts`: `CONTAINERS_POLICY.allowedExtraStartOptions` is `['useHostProxy', 'forceDisableUserEnv']`. The SSH
  rows don't change.
- `lifecycle/runtime.ts`: `forceDisableUserEnv: startPolicy.allowedExtraStartOptions.includes('forceDisableUserEnv')`,
  beside `useHostProxy`.
- `scripts/bootstrap.ts`: `StartParameters` gains `forceDisableUserEnv: boolean`, and `startOptions` adds
  `--force-disable-user-env` to `optional` after `--use-host-proxy` when it's true. Fixtures that build start
  parameters gain the field.

## 3. Rows

**Unit** (`test/unit/remote-environment.test.ts`, new; `test/unit/connector.test.ts` for the wiring):

| Cite | Given | Expected |
|---|---|---|
| F-0416 BR-11, BR-12 | `probeModeOf` of absent, each of the four values, `42`, `'other'` | default, the value, default, default |
| F-0416 BR-11a | `remoteEnvironmentOf` with a string, `null`, a number and an object | the first two kept; the others in `dropped` |
| F-0416 BR-11 | `probeScriptOf` for each shell mode: its text; then the `loginShell` script run in a real `sh` with stubs of `id` (prints `c45`) and `getent` (prints a passwd line whose shell is `/bin/sh`) first on `PATH`, and `C45_STUB=1` exported | the mode's flags and both markers in the text; the run's output has both markers and `C45_STUB=1` between them; with the `getent` stub removed from `PATH` and no `c45` line in `/etc/passwd`, `/bin/sh` is used |
| F-0416 BR-11 | `probedEnvironmentOf`: noise before and after the markers; a value with `=` and a newline in it; no end marker | the map; the value kept whole; `undefined` |
| F-0416 BR-11a | `extensionHostEnvironmentOf`: probe `A=p, B=p`, remoteEnv `A=r, C=null` | `A=r, B=p, C=null` |
| F-0416 BR-11b | connector: the probe channel fails, exits 1, prints no end marker, never answers (fake timers, 10 s) | the connect succeeds with `remoteEnv` alone, one `dropped` log line each |
| F-0416 6.10 | connector: two connects of one reused server, the second with another `remoteEnv` | each `Connected` has its own environment |
| F-0416 BR-11 | connector with `userEnvProbe: none` | no probe run; `extensionHostEnv` is `remoteEnv` |
| #737 option 1 | lib-server's start options for the containers row and for the SSH row (`bootstrap.test.ts` or the start-options rows beside `--use-host-proxy`'s) | containers: `--force-disable-user-env` after `--use-host-proxy`; SSH: absent; the policy validation accepts the new option and still rejects an unknown one |

**Acceptance** (`tests/acceptance/containers/remote-environment.test.ts`, new, `this.timeout(900_000)`; folders
`c45-`):

| # | Name | Setup | Assertions |
|---|---|---|---|
| E1 | `containers-45 (e1): by F-0416 BR-11 and BR-11a, a terminal gets the probe's and remoteEnv's variables, remoteEnv winning` | a Dockerfile from the run's image that writes `export C45_PROFILE=profile` and `export C45_BOTH=profile` to `/etc/profile`; `remoteEnv: {C45_REMOTE: 'remote', C45_BOTH: 'remote'}` | after the connect, open a terminal and run `printf '%s|%s|%s\n' "$C45_PROFILE" "$C45_REMOTE" "$C45_BOTH"` with the harness's terminal helpers (`typeInTerminal`, `terminalBuffer`): the buffer has `profile|remote|remote` |
| E2 | `containers-45 (e2): by F-0416 6.10, editing userEnvProbe to none takes effect on reload, without a rebuild` | E1's folder, then set `userEnvProbe: 'none'` in its configuration and reload the window | the same container id; the terminal's line is `|remote|remote` |

Measure both against the branch first; if core gives the terminal another environment than the extension host's,
that's an open row.

## 4. Gates and review

All gates; the changed files at 100 %; the `containers` launch locally. PR title: `remote-containers: the remote
environment, userEnvProbe and remoteEnv, per connection (card containers-45, #1059)`. Request athena only; hermes
assigns the peer. Then tell dike (containers-42, #1051): group B's rows can start.

## 5. Open rows (stop and report on the issue)

1. The merged configuration lacks `remoteEnv` or `userEnvProbe` when the configuration sets them, or the CLI leaves
   a `${containerEnv:…}` unresolved there.
2. E1's terminal doesn't see `extensionHostEnv`, or sees it only partly.
3. `/proc/self/environ` isn't readable in the run's image.
