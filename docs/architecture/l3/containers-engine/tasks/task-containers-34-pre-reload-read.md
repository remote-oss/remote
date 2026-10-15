# Task card containers-34: Reopen's pre-reload read asks for no merged configuration; a CLI read failure isn't silent

Issue: #971. Milestone 0.4. Size: S. Builder: `task:claude`.

**Design:** athena's ruling (1) on #881 (comment 6181477796). It carries triton's R1 from containers-11 part 2.

Sources: F-0410 (remote-oss/remote-containers#28) AC-13, 7.E3; F-0301 (#20) 7.E1; containers-13 (C4) and
containers-24 (the pre-reload wait); ADR-0009.

## 1. The defect

`readConfigurationArguments` always passes `--include-merged-configuration`, also on Reopen's pre-reload read, which
has no container id.
- With no container, merging means reading the image's metadata, so the CLI pulls the image before the reload.
- On a missing image the read fails. `reopen.ts` logs a warning and returns, and the user sees nothing.
- The pre-reload choice needs only `workspaceFolder`. The merged configuration is read only after `prepare`, with a
  container id (F-0505's extension list, `connector.ts`).

## 2. The change

- **`src/cli/cli-arguments.ts`:** `readConfigurationArguments(target, containerId?)` passes
  `--include-merged-configuration` only together with `--container-id`.
  - A missing image then reaches the reload, and `up` fails in the dev container window into C8's dialog with S034
    (AC-13, 7.E3), as the reference does.
  - No pull hides in the pre-reload wait (containers-24) any more.
- **`src/cli/cli-lines.ts`:** a read-configuration result without `mergedConfiguration` parses, with
  `mergedConfiguration: undefined` (check the parser's row; add one if there's none).
- **`src/config/choose-configuration.ts` (C4):** a CLI read failure of a configuration that parsed is no longer
  `readFailed` for the caller to drop.
  - It takes F-0301 7.E1's path, the nearest F-0301 case ("the configuration file cannot be read"): the dialog
    `refuse('', S181 with the candidate's relative path)` (Show Log), the file opened as a preview, as for a file that
    doesn't parse. Log the CLI failure at warn with `failureText`, then return `rejected`.
  - Remove the `readFailed` kind from `ConfigurationChoice`, and its branch from `src/open/reopen.ts`. `tsc` lists any
    other user.

## 3. Rows

### 3.1 Unit

- `cli-arguments.test.ts`:
  - `F-0410 AC-13: the pre-reload read asks for no merged configuration`: no container id gives no
    `--include-merged-configuration`;
  - with a container id, both flags, in the existing order.
- `cli-lines.test.ts`: a result with no `mergedConfiguration` gives `undefined`.
- `choose-configuration.test.ts`: `F-0301 7.E1: a configuration the CLI can't read shows S181 and opens the file`.
  A `setupFailed` read gives one `refuse` with S181 for the relative path, one `openPreview`, a warn line naming the
  failure, and `rejected`.
- `reopen.test.ts`: a rejected choice opens no window. This replaces the `readFailed` row, if there is one.

### 3.2 Acceptance (the `containers` launch)

| # | Rows |
|---|---|
| R1 (triton's, F-0410 AC-13) | `devContainerFolder('c34-missing-image', {image: 'remote-oss-acceptance-missing:none'})`. Open, `reopenStarted` (it has to be exported by then; containers-26 exports it, otherwise export it here), `waitForDialog(name, 180_000)` in the reloaded window: S034 (`An error occurred setting up the container.`) with `Edit devcontainer.json Locally`, `More Actions...` and `Retry` (compare the set). `devContainersOf` is `[]` |

If containers-11 part 2 has already merged R1, this card only makes it pass. Otherwise, add R1 to containers-11's
`tests/acceptance/containers/recovery.test.ts`, or wherever its rows are, in this PR.

## 4. Gates and review

Run all gates and the containers launch. PR title: `remote-containers: Reopen's pre-reload read asks for no merged
configuration, and a CLI read failure shows S181 (card containers-34, #971)`. Request athena only.

**Open row (stop and report on #881):** a read failure that isn't about the configuration's content (an engine that
can't be reached during the read, for example). Paste the CLI's result. 7.E1 may not be the right dialog for it.
