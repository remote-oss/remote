# Task card containers-09: the containers acceptance launches and slice 1's gate rows 1, 8, 9 and 10

Issue: #775. Remote - Containers release 1, slice 1, items (10) and (11) of the slice plan (milestone 0.4). Why:
`brief-release-1.md` §5 makes release 1's gate a set of rows in the VSCodium run, "on a runner with a local Docker
engine". Slice 1 is the first four of them. This card builds the harness they need and writes them. Builder: not
assigned yet (`task:claude`). Size: M–L, about 3 agent-days. The build PR opens with the `needs-verification`
label (§7).

**Depends on:**
- **for rows 9 and 10:** containers-01 (#759) only, the package shell. Both rows open a window on a `dev-container`
  authority, and containers-01's one activation event activates the package. So these two rows, with the harness of §2
  and §3, can land as soon as containers-01 has merged, in a first PR;
- **for row 8:** also containers-03 (#758, the pre-flight dialog) and containers-07 (#766, the Reopen command);
- **for row 1:** also containers-02 (#757), -04 (#763), -05 (#765), -06 (#769) and containers-08 (C10, the
  connector). Row 1 asserts the title and the indicator, so it also needs the `dev-container` label formatter
  (F-0504, which `components.md` gives to C10). If C10's card leaves it out, stop (§8, row 1);
- **harness helpers built by other cards:**
  - tooling-30 (merged): the renderer helpers and the debugging port;
  - coverage-25a (#644): `notifications(name)`;
  - tooling-33 (#716): `dialogOf`, `waitForDialog`, `answerDialog`, and `--shared-data-dir=<run>/shared-data` for
    every launch.

  If one of them hasn't merged when you start, add exactly what that card specifies, in the file and with the name it
  gives, and say so in the PR. Whichever lands second merges onto the first.

## 1. What the rows prove

| Row | Brief §5 | Cites (tags in §6) |
|---|---|---|
| 8 | a bogus `dockerPath` shows F-0201's pre-flight dialog before any reload | F-0201 AC-2 |
| 1 | Reopen in Container on an `image` configuration connects, and the title and indicator show the container's name | F-0401 AC-3, F-0401 AC-15, F-0504 AC-1 |
| 9 | with a stand-in carrying the reference id, the extension stands down and registers nothing | F-0101 AC-18 (its first half) |
| 10 | without the proposals, nothing fails and the setup notice names the extension | F-0101 AC-15 (its first clause) |

The brief also names F-0408, F-0502 and F-0503 for row 1. Row 1 is their end-to-end proof, but it isn't a whole AC of
any of them: list them in the PR as halves, and tag nothing for them.

## 2. The launches (`tools/acceptance-launches.ts`, `tools/acceptance-plain.ts`)

**The extension.** `LAUNCH_EXTENSIONS` gains `['remote-oss.remote-containers', 'remote-containers']`, so the launches
that name it get remote-containers' packaged VSIX and its proposed API, as the explorer's launches do.
`packagedExtensions` finds `dist/remote-containers-<version>.vsix` once containers-01's package builds a VSIX.

**One shared constant**, beside `EXPLORER_LAUNCH`:

```ts
/** What the containers launches share: Dev Containers, its proposed API, the renderer and dialogs it can read, and the download host. */
const CONTAINERS_LAUNCH = {
  kind: 'plain',
  withExtensions: ['remote-oss.remote-containers'],
  debuggingPort: true,
  settings: {
    'window.title': '[${rootName}]',
    'window.dialogStyle': 'custom',
    'remote.serverDownloadBaseUrl': '${HARNESS_DOWNLOADS_LOCAL}/ok',
  },
} as const;
```

- **The title setting:** if tooling-33's `RENDERER_LAUNCH` is on main, spread it for `debuggingPort` and the title, and
  keep only the other two settings here. `pnpm dupes` must not see the title setting twice.
- **`window.dialogStyle: 'custom'`:** F-0201's dialog is a modal `showErrorMessage`. With the editor's default
  (`native` on Linux), it's a GTK dialog that the renderer can't read. With `custom`, core draws it as a
  `.monaco-dialog-box` in the window, where tooling-33's `dialogOf` reads it. The dialog's message, detail, buttons and
  outcome are the same in both styles ([oss] `src/vs/workbench/browser/parts/dialogs/dialogHandler.ts`, the custom
  handler).
- **`remote.serverDownloadBaseUrl`:** the client downloads the server (the remote-containers policy row is
  `clientOnly`, containers-05). lib-product's base-URL form makes
  `<base>/commit:<commit>/server-linux-alpine/<quality>` (`packages/lib-product/src/resolve.ts`, `expandBaseUrl`).
  Its first segment is `ok`, so the download host (tooling-27) answers with the VSCodium server for Alpine that it
  already serves. The run puts `${HARNESS_DOWNLOADS_LOCAL}` in with `withHarnessBases`, as for every launch's settings
  (`tools/acceptance.ts`), so the value the editor reads has no `${` and is a base URL. Nothing leaves the machine.

**Three launches**, after `explorer-no-proposals`, or after tooling-33's `trust-terminal` if that's on main:

| Label | Suite | Beyond `CONTAINERS_LAUNCH` |
|---|---|---|
| `containers` | `containers` | none |
| `containers-standdown` | `containers-standdown` | `standIns: ['ms-vscode-remote.remote-containers']` (§3.3) |
| `containers-no-proposals` | `containers-no-proposals` | `proposedApi: false` |

`PlainLaunch` gains `standIns?: readonly string[]`: the ids of the stand-ins (§3.3) the run puts into this launch's
own extensions folder before the launch starts. No other launch changes.

**Suites:**
- `tests/acceptance/containers/`, `containers-standdown/` and `containers-no-proposals/`, each with a `tsconfig.json`
  like `explorer/`'s.
- They're registered where the explorer's suites are: the root `tsconfig.json`'s `references`, `eslint.config.ts`'s
  `TYPESCRIPT_PROJECTS` and `knip.jsonc`'s entries (`containers/*.test.ts` and so on).
- The README gets the three labels in its launch list, and the section of §5.

## 3. The run's preparation (`tools/acceptance.ts`, `tools/acceptance-run.ts`)

### 3.1 The dev container image

When the run has a `containers` launch, `prepare` builds one image before the launches start:

- **The Dockerfile:** `tests/acceptance/devcontainer-image/Dockerfile`:

  ```dockerfile
  FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
  RUN apk add --no-cache libstdc++
  ```

  The digest is the one the harness host's image pins (`tests/acceptance/host/Dockerfile`, measured on 2026-10-14:
  `docker image inspect alpine:3.22` gives the same `RepoDigests`).
- **Why Alpine with libstdc++:** the download host serves the VSCodium server for Alpine, which needs only libstdc++
  beyond the base. The harness host is the same image plus OpenSSH, and runs that server today (coverage-17). lib-server's
  probe reports `alpine`, and the base-URL form then asks for `server-linux-alpine`, which matches. The server ships its
  own `node`, so C11's relay script needs nothing more. BusyBox `tar` serves C11's `copyToHost`.
- **The build:**
  `docker build --label remote-oss.acceptance.run=<runId> --label remote-oss.acceptance.devcontainer=1 --tag remote-oss-acceptance-devcontainer:<runId> tests/acceptance/devcontainer-image`,
  through the run's checked command runner.
- **The launches** get its tag as `HARNESS_DEVCONTAINER_IMAGE`, beside the other `HARNESS_*` variables.

### 3.2 Labels and clean-up

**Every dev container the rows create carries the run's labels.** The rows write them into the configuration's
`runArgs` (§4.1), so the CLI creates the container with `--label remote-oss.acceptance.run=<runId> --label
remote-oss.acceptance.devcontainer=1`.

**`cleanRun`** (`tools/acceptance-run.ts`):
- **Removing containers:** it already removes every container with the run's label, so the dev containers go with the
  harness host.
- **Images:** before removing the containers, it notes the image id of each container that has the label
  `remote-oss.acceptance.devcontainer=1` (`docker inspect --format '{{.Image}}'`). After the containers are gone, it
  removes those images and the tag `remote-oss-acceptance-devcontainer:<runId>`, ignoring the status as it does for
  the host image. Release 1's image configurations, run as root, make no `-uid` image, so the list is normally the run's
  own tag. The rule covers a build that makes one.
- **The `vscode` volume:** the run never removes it. Every dev container on the engine shares it (contracts §5.1), on a
  developer's machine too, so removing it could break another run or the user's own containers. The README says so.

**The sweep at the start of each run**, before the image is built (tooling-36's lesson: on a shared runner, a killed job
leaves its state for every later job):
- remove every container with the label `remote-oss.acceptance.devcontainer=1` whose
  `remote-oss.acceptance.run` label isn't this run's and whose `Created` time is more than `STALE_EDITOR_SECONDS`
  (7200) ago;
- then remove every image with the same two conditions.

Age is the key, not "another run id", because two jobs may share a runner's daemon and a younger container belongs to
a run that may still be going.

**Tools rows** (`tools/acceptance-run.test.ts`, `tools/acceptance.test.ts`, over the recording command runner):

| Cite | Given | Expected |
|---|---|---|
| containers-09 | `cleanRun` with one labelled dev container and the run's host container | the image id is noted before the `rm`; both containers removed; `docker image rm` of the noted id and of the run's tag, status ignored |
| containers-09 | the start sweep with three labelled dev containers: this run's, another run's created 3 h ago, another run's created 10 min ago | only the second is removed |
| containers-09 | a run with no containers launch | no `docker build` of the dev container image, and no sweep |
| containers-09 | a run with a containers launch | the image is built with the two labels and the run's tag before any launch |

### 3.3 The stand-in (gate row 9)

athena's ruling on #603 for F-2001 AC-29 holds here: a stand-in that carries the reference's id may be used, within
these limits:
- **Contents:** it's a `package.json` only, with:
  - `publisher` `ms-vscode-remote` and `name` `remote-containers`, the id that containers-01's stand-down table
    detects (`standDown.standsDownFor`);
  - `version` `0.0.0`;
  - `engines.vscode` from our package;
  - `displayName` `Acceptance stand-in (not the reference)`.

  There's no code and no contribution, and nothing in it comes from the reference.
- **Never shipped:** it's never committed as a package, packaged as a VSIX, published, or left outside the run folder.

**How the run puts it in:**
1. Before the `containers-standdown` launch starts, write the folder
   `<run>/extensions-containers-standdown/ms-vscode-remote.remote-containers-0.0.0/` with that `package.json`. The
   JSON is built in code from the id, with no file in the repository.
2. Add its entry to that folder's `extensions.json`, in the shape the editor's own install of our VSIX wrote there:
   read the file after the run's installs, and copy one entry's fields with this folder's identifier, version and
   location.
3. The run's clean-up removes the run folder, so the stand-in goes with it.

**Measure first:** before writing row 9, have the agent report `vscode.extensions.getExtension('ms-vscode-remote.remote-containers') !== undefined` in that launch (§4.3's `extensionPresent`). If the editor doesn't see the stand-in, stop (§8, row 2). Don't package it as a VSIX instead.

## 4. The window agent and the helpers

### 4.1 The test folder

Each row writes its own folder under the run folder, `<run>/<name>/.devcontainer/devcontainer.json`:

```json
{
  "name": "Gate One",
  "image": "<HARNESS_DEVCONTAINER_IMAGE>",
  "runArgs": ["--label", "remote-oss.acceptance.run=<runId>", "--label", "remote-oss.acceptance.devcontainer=1"]
}
```

- `<runId>` comes from a new harness variable, `HARNESS_RUN_ID`: the run's `acceptanceRunId`, added to
  `HarnessVariables` beside `HARNESS_RUN_FOLDER`, with a tools row.
- The window opens with `inWindow('local', 'acceptance.agent.openWindow', pathToFileURL(<folder>).href)` and is named
  `<name>` by its folder (the agent's rule).
- After Reopen, the remote folder is `/workspaces/<name>` (F-0411's default mount), so the agent in the reloaded window
  has the same name.

### 4.2 New harness helpers (`tests/acceptance/windows/harness.ts`)

- **`reopenInContainer(name)`:** sends `remote-containers.reopenInContainer` to window `name` without waiting for its
  `done`, because the reload ends the extension host before it answers, as `reloadWindow` doesn't wait either. It
  resolves on the window's next `activated` event, or fails after the harness's usual 60 s, naming the window.
- **`devContainersOf(folder)`:** the ids of the run's containers whose label `devcontainer.local_folder` equals
  `folder`: `docker ps --all --quiet --filter label=devcontainer.local_folder=<folder> --filter
  label=remote-oss.acceptance.run=<runId>`.
- **`dockerVolumes()`:** the sorted `docker volume ls --quiet`.
- **`commandsOf(name, prefix)`:** the agent's `acceptance.agent.commands` answer (§4.3), the registered command ids that
  start with `prefix`.

### 4.3 The agent (`tests/acceptance/window-agent/`)

- **`acceptance.agent.commands(prefix)`:** reports `{event: 'commands', prefix, ids}`, where `ids` is
  `(await vscode.commands.getCommands(true)).filter(id => id.startsWith(prefix)).sort()`.
- **`acceptance.agent.extensionPresent(id)`:** reports `{event: 'extension', id, present}`.
- The `AgentEvent` type gains the fields they report.

### 4.4 Renderer helpers (`tests/acceptance/windows/renderer.ts`)

**`statusItem(name, itemId)`:** the status bar item with the DOM id `itemId` (core's id for the remote indicator is
`status.host`), as `{text, ariaLabel, hover}`:
- `text` is the item's visible label text;
- `ariaLabel` is its `aria-label`;
- `hover` is its hover text.

Measure in the pinned build where each one lives:
- the item is `.statusbar-item` with `id="status.host"`, and its link is the inner `a`;
- if the hover isn't in the DOM until the pointer is over the item, dispatch `mouseenter` on the item and read
  `.monaco-hover` (or `.workbench-hover`) text, then dispatch `mouseleave`.

Write the selectors you measured into the PR. It fails naming the window and the item when there's no such item.

## 5. The rows

Each row's `it` name starts with its cites, then a colon. "Nothing fails in a window" means:
- `notifications(<window>)` holds no text containing `Error`, `error`, `not found` or `failed`, except where the row
  expects one;
- no `failed` agent event for a command the row ran, except where the row expects one.

### 5.1 `tests/acceptance/containers/gate.test.ts` (launch `containers`), rows 8 and then 1

| # | Steps | Assertions |
|---|---|---|
| 8 | Write folder `gate-docker` (§4.1). `inWindow('local', 'acceptance.agent.updateSetting', 'dev.containers.dockerPath', '<run>/no-such-docker')`, then read it back with `acceptance.agent.setting` until it's that value. Open the folder's window. Note `dockerVolumes()` and the window's `activated` count. Send `remote-containers.reopenInContainer` to `gate-docker` (not awaited), then `waitForDialog('gate-docker')`; `answerDialog('gate-docker', 'Cancel')`. Do the same a second time | each time the dialog's message is `Docker version 17.12.0 or later required.`, its detail is `Command not found: '<run>/no-such-docker'. Check the license for details.` (the run folder put in), and its buttons are `License`, `Cancel` and `Install` in the DOM order you measure (write it into the PR). After both: the window's `activated` count is unchanged, `windowState('gate-docker').remoteName` is `null`, `devContainersOf(<the folder>)` is `[]`, and `dockerVolumes()` is unchanged. Then set the setting back (`updateSetting` with `undefined`) and close the window |
| 1 | Write folder `gate-image` (§4.1). Open its window. `reopenInContainer('gate-image')` | **Window:** `windowState('gate-image').remoteName` is `dev-container`, and its one folder starts with `vscode-remote://dev-container+` and ends with `/workspaces/gate-image`.<br>**Title and indicator:** the window's page is found by `pageOf('gate-image')`. Its title is exactly `[gate-image [Dev Container: Gate One]]`: our label formatter's suffix in the title template the launch sets; core's template and application name are core's half, #475 (a). `statusItem('gate-image', 'status.host')` gives `text` `Dev Container: Gate One`, `ariaLabel` `remote  Dev Container: Gate One` (two spaces), and `hover` `Editing on Dev Container: Gate One`.<br>**Notifications:** none is open within 10 s of the activation (AC-3's progress gone, empty notification center).<br>**Container:** `inWindow('gate-image', 'acceptance.agent.writeFile', 'gate-probe', 'x')` works; `devContainersOf(<the folder>)` has exactly one id; `docker exec <it> cat /workspaces/gate-image/gate-probe` prints `x`; and `docker inspect` shows the labels `devcontainer.local_folder` = the folder and `devcontainer.config_file` = its `.devcontainer/devcontainer.json`.<br>Nothing fails in the window. Then close the window |

### 5.2 `tests/acceptance/containers-standdown/gate.test.ts`, row 9

| # | Steps | Assertions |
|---|---|---|
| 9 | In `local`: `extensionPresent('ms-vscode-remote.remote-containers')` is true (§3.3; otherwise stop). Open a window on `vscode-remote://dev-container+7b7d/workspaces/gate-standdown` (`7b7d` is the hex of `{}`: the payload doesn't matter, since the window only has to activate the package). The agent names it `gate-standdown`; wait for its `activated` | `notifications('gate-standdown')` holds exactly one coexistence warning, whose text is containers-01's `STAND_DOWN_WARNING` (or the text athena rules on #762, if it changed); `commandsOf('gate-standdown', 'remote-containers.')` is `[]`. The resolve of the authority fails in core's own way (core's half: no resolver is registered); assert nothing about core's message |

### 5.3 `tests/acceptance/containers-no-proposals/gate.test.ts`, row 10

| # | Steps | Assertions |
|---|---|---|
| 10 | Open a window on `vscode-remote://dev-container+7b7d/workspaces/gate-setup` as in row 9 | within 15 s, `notifications('gate-setup')` holds exactly one notice whose text starts with `Dev Containers needs proposed VS Code APIs that ` and contains `remote-oss.remote-containers`: containers-01's `SETUP_TEXT_TEMPLATES.setup` with the values its gate puts in, which you measure and write into the PR. No notification of ours holds `Error` or `failed`. `commandsOf('gate-setup', 'remote-containers.')` lists every command containers-01 and the later cards register: they stay registered (brief ruling 9) |

**If a row fails because the product does something else, don't change the row; report it on #775.** These are the
release gate's rows.

## 6. The catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

| AC | Tag | Why |
|---|---|---|
| F-0201 AC-2 | `acceptance` | row 8 asserts every clause |
| F-0401 AC-3 | `acceptance` | row 1: title, indicator, hover, no notification |
| F-0401 AC-15 | `acceptance` | row 1: exactly one container with the two labels. Its "random adjective_noun name" half is Docker's, and the base image's labels are the image's |
| F-0504 AC-1 | `acceptance` | row 1. The title's ` - <application>` tail is core's template (#475 (a)) |
| F-0101 AC-18 | stays `todo` | row 9 proves its first half. "After the reference is disabled and the window reloaded" and "the warning reappears at every later activation" aren't run. List them in the PR (§8, row 3) |
| F-0101 AC-15 | stays `todo` | row 10 proves its first clause. The `argv.json` flow and the next window's behaviour aren't run. List them in the PR (§8, row 3) |

If the containers coverage file isn't on main when this lands, tag nothing and list the tags in the PR.

## 7. Verification (proteus)

The build PR opens with `needs-verification`. proteus checks on the CI runners:
- **Bind mounts:** the Docker daemon the runner talks to can bind-mount the run folder into a container at the same
  path. The CLI mounts `<run>/gate-image` at `/workspaces/gate-image`. A daemon that only sees its own filesystem (a
  socket shared from another host or container) would mount an empty folder.
- **The image build** from `alpine:3.22` by digest works on the runner, as the harness host's image already does.
- **Leftovers:** after a dispatched run, no container or image with `remote-oss.acceptance.devcontainer=1` is left, and
  the `vscode` volume is the only thing a run leaves behind (README).

## 8. Open rows (stop and report on #775)

1. Row 1's title or indicator doesn't carry `Dev Container: Gate One` because no card registers the `dev-container`
   label formatter. Report which card should (C10 by `components.md`); don't add it here.
2. The editor doesn't see the stand-in written into the launch's extensions folder (§3.3), even with its
   `extensions.json` entry. Report what the folder and the file looked like. Don't package it.
3. For athena: rows 9 and 10 prove only the first part of F-0101 AC-18 and AC-15, so both stay `todo`. Ask on the PR
   whether the rest is to be run (a second launch with the stand-in disabled; the `argv.json` flow) or tagged
   otherwise.
4. Row 8's dialog is a native one even with `window.dialogStyle: 'custom'`. Report the build's behaviour. Don't switch
   the row to reading a log line.
