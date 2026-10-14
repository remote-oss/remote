# Task card containers-26: F-0411's workspace mount and folder rows (Linux image configurations)

Issue: #954. Milestone 0.4, containers release 1. Size: M. Builder: `task:local`.

**What this card is:** acceptance rows only, in the `containers` launch. The product already does all of this
through the dev container CLI (ADR-0009: C3 hands the CLI the folder, and the CLI makes the mount). No product code
changes. If a row fails on product behaviour, stop and report it on #954 (§5). Don't change the product or the
expected values.

**Builds after:**
- the harness PR on branch `tools/page-by-name` (`reopenStarted`, the read-only connect probe in
  `reopenInContainer`, `pageOf` by name, and `tests/acceptance/containers/folder-windows.ts`);
- part B only: containers-11 (#947, F-0410's dialog).

Sources: F-0411 (remote-oss/remote-containers#33), 5.0, 6.1–6.5, 6.9, 6.10, 7.E2, 7.E4, 7.E6, 7.E7, 9, BR-2–BR-6,
BR-8. The other in-cut ACs of F-0411 (AC-8, 9, 10, 14, 19, 28, 35–38) need two settings the package doesn't have yet,
and another card takes them.

## 1. The file and its helpers

New file `tests/acceptance/containers/workspace-mount.test.ts`, `describe('F-0411 workspace mount and folder (card
containers-26)')`, `this.timeout(900_000)`.

Use these, and write nothing that duplicates them:
- `windows/harness.ts`: `devContainerFolder`, `devContainersOf`, `reopenInContainer`, `reopenStarted`,
  `closeWindow`, `inWindow`, `windowState`, `variable`, `waitFor`;
- `windows/renderer.ts`: `waitForDialog`, `answerDialog`, `dialogOf`, `windowTitle`;
- `containers/folder-windows.ts`: `openFolderWindow`, `removeContainers`, `activations`.

Add these private helpers in the new file:

```ts
/** One mount of a container, as `docker inspect -f '{{json .Mounts}}'` gives it. */
interface Mount { Type: string; Name?: string; Source: string; Destination: string }
/** The mounts of container `containerId`. */
async function mountsOf(containerId: string): Promise<Mount[]>;
/** A label of container `containerId`, from `docker inspect -f '{{index .Config.Labels "<label>"}}'`, trimmed. */
async function labelOf(containerId: string, label: string): Promise<string>;
/** The names in `directory` inside container `containerId`, from `docker exec <id> ls -A <directory>`, sorted. */
async function namesIn(containerId: string, directory: string): Promise<string[]>;
/** Makes `folder` a Git repository root: `git init -q <folder>`. */
async function gitRoot(folder: string): Promise<void>;
```

- **The path of a window's folder** is `new URL(state.folders[0] ?? '').pathname`, decoded with
  `decodeURIComponent`.
- **`${localWorkspaceFolder}`** goes to the CLI as written: put it in a single-quoted string, never a template
  literal, so TypeScript doesn't substitute it.
- **Each row** uses its own folder name, starting `c26-`. It removes its containers in `finally` with
  `removeContainers`, and its volume with `docker volume rm -f <name>` if it made one. It closes its window if it
  opened one, also in `finally`.
- **The core dialog** of AC-6, 7 and 16 has the message `Workspace does not exist`, the detail `Please select another
  workspace to open.` and the buttons `Cancel` and `Open Workspace...` (compare sorted, as gate row 8 does). Answer
  it with `Cancel`.
- **A row whose window never reaches its folder** (AC-6, 7, 16) starts with `reopenStarted(name)`, then
  `waitForDialog(name, 180_000)`. Every other row uses `reopenInContainer(name)`.

## 2. The rows, part A

`<f>` is the row's folder path (`devContainerFolder` returns it), `<b>` its basename, and `<id>` the one id
`devContainersOf(<f>)` gives after the Reopen.

| # | Name (each starts with its `F-0411 AC-…` cite and a case label) | Setup | Assertions |
|---|---|---|---|
| W1 | `F-0411 AC-1, AC-12 (w1): a repository root is mounted at /workspaces/<name> and the window opens there, with the folder labels` | `c26-root`: `devContainerFolder`, then `gitRoot(<f>)`. Open, `reopenInContainer` | `mountsOf(<id>)` has exactly one mount whose `Destination` starts with `/workspaces/`: `Type` `bind`, `Source` `<f>`, `Destination` `/workspaces/<b>`. The window's folder path is `/workspaces/<b>`. `windowTitle(name)` starts with `[<b> [`. `labelOf(<id>, 'devcontainer.local_folder')` is `<f>` and `labelOf(<id>, 'devcontainer.config_file')` is `<f>/.devcontainer/devcontainer.json` (AC-12) |
| W2 | `F-0411 AC-2 (w2): a subfolder of a repository mounts the repository root and opens at the subfolder` | `c26-repo`: `devContainerFolder('c26-repo/sub/inner')`, then `gitRoot(<run>/c26-repo)`. Open `<run>/c26-repo/sub/inner`, `reopenInContainer` | one `/workspaces/` mount: `bind`, `Source` `<run>/c26-repo`, `Destination` `/workspaces/c26-repo`. The window's folder path is `/workspaces/c26-repo/sub/inner`. The label `devcontainer.local_folder` is `<run>/c26-repo/sub/inner` |
| W3 | `F-0411 AC-3 (w3): a folder outside any repository is mounted itself` | `c26-plain` (no `gitRoot`; the run folder is under `/tmp`, outside any repository). Open, `reopenInContainer` | one `/workspaces/` mount: `bind`, `Source` `<f>`, `Destination` `/workspaces/<b>` |
| W4 | `F-0411 AC-4 (w4): a workspaceMount of a sub-folder with a matching workspaceFolder mounts only that sub-folder` | `c26-sub` with `{workspaceMount: 'source=${localWorkspaceFolder}/app,target=/workspaces/app,type=bind', workspaceFolder: '/workspaces/app'}`; write `<f>/app/inside.txt` and `<f>/other.txt`. Open, `reopenInContainer` | one `/workspaces/` mount: `bind`, `Source` `<f>/app`, `Destination` `/workspaces/app`. `namesIn(<id>, '/workspaces/app')` is `['inside.txt']`, and `namesIn(<id>, '/workspaces')` is `['app']`. The window's folder path is `/workspaces/app`, and `windowTitle(name)` starts with `[app [` |
| W5 | `F-0411 AC-5 (w5): a workspaceMount of a new volume mounts a local volume of that name, empty, and no host folder` | the volume name `c26-new-<HARNESS_RUN_ID>` (lower-cased; `docker volume ls` must not have it before). `c26-volume` with `{workspaceMount: 'source=<volume>,target=/workspaces/vol,type=volume', workspaceFolder: '/workspaces/vol'}`. Open, `reopenInContainer` | one `/workspaces/` mount: `Type` `volume`, `Name` `<volume>`, `Destination` `/workspaces/vol`. No mount has `Type` `bind` and `Source` `<f>`. `docker volume inspect -f '{{.Driver}}' <volume>` is `local`. `namesIn(<id>, '/workspaces/vol')` is `[]` |
| W6 | `F-0411 AC-30 (w6): a workspaceMount of an existing volume shows its files and leaves the volume as it was` | the volume `c26-old-<HARNESS_RUN_ID>`: `docker volume create`, then `docker run --rm -v <volume>:/data <HARNESS_DEVCONTAINER_IMAGE> sh -c 'echo kept > /data/kept.txt'`. Record `docker volume inspect -f '{{.CreatedAt}}|{{json .Labels}}' <volume>`, and the sorted names in `<f>` on the host. `c26-volume-old` with W5's settings for this volume. Open, `reopenInContainer` | `namesIn(<id>, '/workspaces/vol')` is `['kept.txt']`. The volume's `CreatedAt` and labels are as recorded. The host folder's names are as recorded. Then close the window and `removeContainers(<f>)`: the volume still exists, and the same `docker run` with `cat /data/kept.txt` prints `kept` |
| W7 | `F-0411 AC-6 (w7): an empty workspaceMount gives no workspace mount, and core says the workspace does not exist` | `c26-nomount` with `{workspaceMount: '', workspaceFolder: '/workspaces/none'}`. Open, `reopenStarted`, `waitForDialog(name, 180_000)` | the core dialog (§1). `mountsOf(<id>)` has no mount whose `Destination` starts with `/workspaces`. `windowState(name).remoteName` is `dev-container` |
| W8 | `F-0411 AC-7 (w8): a workspaceFolder alone keeps the default mount, and core says the workspace does not exist` | `c26-folder-only` with `{workspaceFolder: '/workspaces/custom'}`. Open, `reopenStarted`, `waitForDialog(name, 180_000)` | the core dialog. One `/workspaces/` mount: `bind`, `Source` `<f>`, `Destination` `/workspaces/<b>` |
| W9 | `F-0411 AC-16 (w9): a workspaceMount alone keeps it, and the window tries the default path` | `c26-mount-only` with `{workspaceMount: 'source=${localWorkspaceFolder}/app,target=/workspaces/app,type=bind'}`; write `<f>/app/inside.txt`. Open, `reopenStarted`, `waitForDialog(name, 180_000)` | the core dialog. One `/workspaces/` mount: `bind`, `Source` `<f>/app`, `Destination` `/workspaces/app`. The window's folder path is `/workspaces/<b>`, and `windowTitle(name)` starts with `[<b> [` |
| W10 | `F-0411 AC-41 (w10): an empty workspaceFolder makes no container and leaves the folder to reopen locally` | `c26-empty-folder` with `{workspaceFolder: ''}`. Open, record `activations(name)`, then `const running = inWindow(name, 'remote-containers.reopenInContainer')`, not awaited. Within 60 s, poll every 250 ms for whichever comes first: `dialogOf(name)` gives a dialog (**preferred**), or `activations(name)` grows (**reference**) | **Preferred:** the message `Workspace folder in devcontainer.json must be an absolute path.`, the detail `''`, and the buttons `Cancel`, `Show Log` (sorted). Answer `Cancel`, then `await running`. `activations(name)` is as recorded, `remoteName` is `null`, and `devContainersOf(<f>)` is `[]`. **Reference:** after the reload, `devContainersOf(<f>)` is `[]`, there's no dialog, and `windowState(name).remoteName` is `dev-container`. Log which one came (`console.log`). Either passes. Anything else fails |
| W11 | `F-0411 AC-42 (w11): a folder named a,b=c is mounted with that name` | `devContainerFolder('a,b=c')`, then `gitRoot(<f>)`. Open, `reopenStarted`. Then `waitFor` up to 180 s until `devContainersOf(<f>)` has one id | one `/workspaces/` mount: `bind`, `Source` `<f>`, `Destination` `/workspaces/a,b=c`. The label `devcontainer.local_folder` is `<f>`. Whether the window connects isn't asserted (AC-42) |

## 3. The rows, part B (after #947 is on main)

| # | Name | Setup | Assertions |
|---|---|---|---|
| W12 | `F-0411 AC-18 (w12): a bind workspaceMount whose source does not exist makes no container and shows F-0410's dialog` | `c26-missing-source` with `{workspaceMount: 'source=${localWorkspaceFolder}/nowhere,target=/workspaces/x,type=bind', workspaceFolder: '/workspaces/x'}`. Open, `reopenStarted`, `waitForDialog(name, 180_000)` | containers-11's F-0410 dialog for S018: the buttons `Edit devcontainer.json Locally`, `More Actions...`, `Retry` (sorted). Take the message text from containers-11's S018 row. `devContainersOf(<f>)` is `[]` |
| W13 | `F-0411 AC-40 (w13): a bind without source and a volume name Docker refuses make no container and no volume` | two folders: `c26-no-source` with `workspaceMount: 'target=/workspaces/x,type=bind'`, and `c26-bad-volume` with `workspaceMount: 'source=bad/name,target=/workspaces/x,type=volume'`, each with `workspaceFolder: '/workspaces/x'`. Each: open, `reopenStarted`, `waitForDialog(name, 180_000)` | the first: S018's F-0410 dialog; the second: S034's (`An error occurred setting up the container.`). Each has the three buttons. No container for either folder, and `docker volume ls` has no new volume |

## 4. The catalogue (`coverage-containers-r1.tsv`)

- Part A: F-0411 AC-1, 2, 3, 4, 5, 6, 7, 12, 16, 30, 41 and 42 become `acceptance`.
- Part B: AC-18 and 40.
- A row that hits §5 leaves its ACs `todo`.

## 5. Gates, review and open rows

Run all gates, then the `containers` launch locally (`docker ps` first, and remove your own leftovers after). The PR
title is `tests: F-0411's workspace mount and folder rows (card containers-26, #954)`. Request athena only; hermes
assigns the peer.

**Open rows (stop and report on #954, with the row's output):**
1. A row's mount, label or folder path differs from §2. That's a product question, not a test fix.
2. W10 shows neither outcome.
3. W2's window opens at `/workspaces/c26-repo` and not at the subfolder, or its label names the repository root.
4. A core dialog's text differs from §1.
