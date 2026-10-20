# Task card containers-48: gate row 7, a Dockerfile that fails to build on Reopen shows F-0410's dialog

Issue: #1113. Milestone 0.4, containers release 1 (brief §5, gate row 7). Size: S. Builder: `task:local`. Every value
below was measured on main (2026-10-20) with the pinned CLI and Docker 29. If main differs, stop and report on the
issue.

**What this card is:** one acceptance row in `tests/acceptance/containers/gate.test.ts`, and nothing else. No product
change.

## 1. The row

Add after the gate-row-1 row, using the file's imports plus `reopenStarted` (from `../windows/harness.ts`) and
`primaryButtonOf`, `waitForDialog`, `waitForQuickPick`, `answerDialog`, `statusItem`, `windowTitle` (from
`../windows/renderer.ts`). Add the ones the file doesn't import yet.

Name: `F-0412 AC-11 (gate-row-7): a Dockerfile that fails to build on Reopen shows F-0410's dialog with Retry, Edit and More Actions..., and makes no container`

Setup:
```ts
const folder = devContainerFolder('gate-build', {
  name: 'Gate Seven',
  image: undefined,
  build: {dockerfile: 'Dockerfile'},
});
writeFileSync(
  path.join(folder, '.devcontainer', 'Dockerfile'),
  `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN false\n`,
);
```
Then `openFolderWindow(folder)`, `reopenStarted(name)`, `const dialog = await waitForDialog(name, 300_000)`. Then read,
in order:
- `await primaryButtonOf(name)`;
- `await windowTitle(name)`;
- `(await statusItem(name, 'status.host')).text`;
- `await devContainersOf(folder)`.

Then `answerDialog(name, 'More Actions...')` and `const pick = await waitForQuickPick(name, 30_000)`.
`closeWindow(name)` and `removeContainers(folder)` in `finally`.

Assertions (one `deepStrictEqual`), as measured:
- `[dialog.message, dialog.details, [...dialog.buttons].sort()]` is `['', 'An error occurred setting up the
  container.', ['Edit devcontainer.json Locally', 'More Actions...', 'Retry']]`;
- the primary button is `Retry`;
- the title is `[gate-build]` and the indicator `Opening Remote...` while the dialog shows;
- `devContainersOf(folder)` is `[]`;
- `pick` is `{placeholder: 'Pick an action to help resolve the problem.', items: ['Reload Window', 'Edit
  devcontainer.json Locally', 'Open Recent...', 'Open Documentation']}`. A failed build leaves no container, so
  containers-47's Rebuild Container item doesn't show.

## 2. The catalogue

F-0412 AC-11 stays `todo`: its log half ("the log shows BuildKit's error") waits for the log harness, containers-37
(#992). Note this in the PR in one line. The row is gate row 7's.

## 3. Gates

All gates and the `containers` launch locally. PR title: `tests: gate row 7, a failed build on Reopen (card
containers-48, #1113)`. Request athena only.
