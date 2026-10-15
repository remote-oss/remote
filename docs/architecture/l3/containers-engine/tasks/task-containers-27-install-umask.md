# Task card containers-27: lib-server's `installUmask`, `022` for Dev Containers

Issue: #958. Milestone 0.4, containers release 1. Size: S. Builder: `task:local`.

Sources:
- transport contracts §5.0, the `installUmask` row (amended 2026-10-14 for containers-25, #924): `inherit` for
  remote-ssh and remote-wsl, `022` for remote-containers;
- F-0419 (remote-oss/remote-containers#92) AC-37: the server's commit folder on the `vscode` volume is 0755;
- containers-25's measurement on #924: `docker exec` runs with umask 0000, so today that folder is 0777.

## 1. The change

### 1.1 The policy record (`packages/lib-server/src/policy/`)

- `record.ts`: `export type InstallUmask = 'inherit' | '022';`, and `ServerPolicyRecord` gains
  `installUmask: InstallUmask` right after `extensionEntries`.
- `rows.ts`: `SSH_POLICY` and `wslPolicy(...)` take `'inherit'`, and `CONTAINERS_POLICY` takes `'022'`.
  `sshPolicyFor(mode)` keeps `SSH_POLICY`'s value, as it does for `extensionEntries`.
- `validate.ts`: add `'installUmask'` to `FIELD_NAMES` after `'extensionEntries'`, and
  `KNOWN_INSTALL_UMASKS = new Set(['inherit', '022'])`. A value outside the set is the problem
  `{path: 'installUmask', problem: 'invalid value'}`, written the way `extensionEntries` is checked.

### 1.2 The scripts (`packages/lib-server/src/scripts/bootstrap.ts`)

- `ScriptParameters` gains `installUmask: InstallUmask` (import the type from `../policy/record.ts`).
- `parameterBlock` adds `assignment('INSTALL_UMASK', parameters.installUmask)` after `ENVIRONMENT_SETUP`.
- `posixScript` puts one line right after `...parameterBlock(parameters)`, for every step:

```sh
[ "$INSTALL_UMASK" = inherit ] || umask "$INSTALL_UMASK"
```

The contract names the install and start scripts. The other steps (probe, kill, uninstall, cleanup, discard) create
no file a umask concerns, so one line for every step gives the same result with no branch on the step. The
`(umask 077; …)` subshells for the token and log files keep their own stricter umask.

### 1.3 The callers

- `packages/remote-ssh/src/pipeline/parameters.ts`: `installUmask: policy.installUmask`, beside
  `cleanup: policy.cleanup`.
- `packages/remote-containers/src/connect/server-steps.ts` `parametersOf`: `installUmask:
  CONTAINERS_POLICY.installUmask`, beside `cleanup: CONTAINERS_POLICY.cleanup`.
- `tsc --build` lists every other `ScriptParameters` literal (the test fixtures, such as lib-server's
  `fake-host.ts` `parametersFor`). Give each `installUmask: 'inherit'`.

## 2. Rows

### 2.1 Unit

| File | Name | Expected |
|---|---|---|
| lib-server `policy-rows.test.ts` | `transport contracts 5.0: the SSH and WSL policies keep the umask they are given, and the SSH policy of a mode too` | `[SSH_POLICY.installUmask, sshPolicyFor('off').installUmask, wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined}).installUmask]` is `['inherit', 'inherit', 'inherit']` |
| lib-server `policy-rows.test.ts` | the existing loop of containers cells | add the cell `['installUmask', '022']` |
| lib-server `policy-record.test.ts` | `installUmask: "077" -> problem path installUmask` | `validatePolicyRecord(recordWith({installUmask: '077'}))` gives the one problem `{path: 'installUmask', problem: 'invalid value'}` |
| lib-server `policy-record.test.ts` | `installUmask: 022 -> {record}` | valid, as the `extensionEntries: asWritten` row does |
| lib-server `bootstrap-script.test.ts`, `describe('install')` | `F-0419 AC-37: with installUmask 022, an install given umask 000 makes its folder 0755` | `runScript(host, single('install'), {...parametersFor(), installUmask: '022'}, {rewriteScript: text => `umask 000\n${text}`})`, then `statSync(installFolder(host)).mode & 0o777` is `0o755` |
| lib-server `bootstrap-script.test.ts`, `describe('install')` | `transport contracts 5.0: with installUmask inherit, the install keeps the umask it is given` | the same with `installUmask: 'inherit'`: `0o777` |
| lib-server `bootstrap-script.test.ts` | `transport contracts 5.0: the parameter block holds the umask` | `scriptFor(single('probe'), 'posixShell', {...parametersFor(), installUmask: '022'})` includes `INSTALL_UMASK='022'` and the line of §1.2 |
| remote-ssh `parameters.test.ts` | the existing row `put the policy and the start options where the scripts read them` | also takes `installUmask` from `scriptParametersFor(...)`, and expects `SSH_POLICY.installUmask` |
| remote-containers `server-steps.test.ts` | `transport contracts 5.0: every script of a connect sets umask 022 (F-0419 AC-37)` | `channelOf()`, `runSteps(channel)`: every one of `scriptsOf(channel)` includes `INSTALL_UMASK='022'` |

The two `0o7xx` rows fail on main, where nothing sets the umask: with `022` the folder is 0777 there.

### 2.2 Acceptance, after containers-25 part 2 (dike's PR on `feature/containers-25-part2`) is on main

In `tests/acceptance/containers-volume/volume.test.ts`, row v1 (`contracts §5.2 (v1): …`):
- next to `commitOwner`, add `commitMode: folders[3]?.split(' ')[1]`, expected `'755'`;
- add `F-0419 AC-37` to the row's cite, so the name starts `contracts §5.2, F-0419 AC-37 (v1): …`. If
  check-coverage refuses a cite that mixes the two forms, put AC-37 first: `F-0419 AC-37 (v1): …`;
- the catalogue: F-0419 AC-37 becomes `acceptance`.

If containers-25 part 2 isn't on main when §1 and §2.1 are done, open the PR without §2.2, leave AC-37 `todo`, and
say on #958 that §2.2 follows.

## 3. Gates and review

Run all gates with the changed files at 100 %. For §2.2, run the `containers-volume` launch. The PR title is
`lib-server, remote-containers: installUmask, 022 for Dev Containers (card containers-27, #958)`. Request athena only;
hermes assigns the peer.

**Open rows (stop and report on #958):**
1. The `0o755` row still gives `0o777` with the line in place.
2. A `ScriptParameters` literal outside tests that §1.3 doesn't name.
