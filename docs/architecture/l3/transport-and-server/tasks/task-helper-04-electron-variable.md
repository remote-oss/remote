# Task card helper-04: the shared connection's ssh doesn't inherit ELECTRON_RUN_AS_NODE

Issue: #734. Not gating, low priority: no criterion fails on it. Size: S. Builder: selene. Found by coverage-26's card
writer (#724).

## 1. The defect

1. `lib-helper`'s `spawnSpecification` (`src/client/spawn.ts`) starts a helper with the editor's executable and
   `ELECTRON_RUN_AS_NODE=1`, so that it runs as Node.js. That is right for the helper itself.
2. The connection helper (`packages/remote-ssh/src/programs/connection-helper.ts`) hands
   `inheritedEnvironment(process.env)` to `runConnectionHelper` as `editorEnvironment`, which becomes the environment of
   the `ssh` it spawns. `inheritedEnvironment` (`lib-helper/src/runtime/helper-main.ts`) drops only
   `REMOTE_OSS_HELPER_PARAMETERS`.
3. So `ssh`, and everything ssh starts locally (a `ProxyCommand`, a `ProxyJump` hop's ssh, a `LocalCommand`), has
   `ELECTRON_RUN_AS_NODE=1`. An Electron program among them, such as the editor's own `code` command, then runs as
   plain Node.js instead of starting.

Core strips Electron's variables from the environments it hands on ([oss] `src/vs/base/common/processes.ts`,
`sanitizeProcessEnvironment`).

Our askpass doesn't depend on the inherited variable: its launcher sets `ELECTRON_RUN_AS_NODE=1` itself
(`lib-ssh/src/askpass/launcher.ts`).

## 2. The fix

In `inheritedEnvironment`, also leave out `ELECTRON_RUN_AS_NODE`. Update the function's JSDoc: it now drops "the helper's
parameters, and the variable that made the editor's executable run the helper as Node.js". Nothing else changes.

## 3. Rows (`packages/lib-helper/test/unit/helper-process.test.ts`, "the environment a helper passes on")

| Name | Given | Expected |
|---|---|---|
| `helper-04: leaves out the variable that runs the editor as Node.js` | `{ELECTRON_RUN_AS_NODE: '1', REMOTE_OSS_HELPER_PARAMETERS: '{}', PATH: '/bin'}` | `{PATH: '/bin'}` |
| the existing `keeps every other variable, including one without a value` | unchanged | unchanged |

**Defect rule:** the new row must fail on main and pass with the fix. Paste both runs.

The askpass rows (`lib-ssh`'s launcher and shared-mode askpass tests) must pass unchanged. That shows the askpass keeps
its own variable.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers and coverage, with the changed
files at 100 %. Use the PR title
`lib-helper: the shared connection's ssh doesn't inherit ELECTRON_RUN_AS_NODE (card helper-04, #734)`. themis or
triton reviews.

## 5. Open rows (stop and report on #734)

1. A test on main asserts that ssh's environment holds `ELECTRON_RUN_AS_NODE`. Name it, and don't change it.
