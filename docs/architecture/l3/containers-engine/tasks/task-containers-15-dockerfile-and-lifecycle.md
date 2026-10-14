# Task card containers-15: the Dockerfile path and F-0415's lifecycle in release 1

Issue: #893. Milestone 0.4, increment 1b. Gate rows 2 and 6 (brief-release-1 §5). Size: S–M. Builder: `task:claude`.

Sources:
- F-0412 (remote-oss/remote-containers#29): 5.1, 7.E3, 7.E8, BR-3, BR-16, decision Q-1;
- F-0415 (#32): 5.0, 6.3, 6.4, 7.E1 to 7.E3;
- ADR-0009, the CLI bridge's policy;
- containers-04 (C3, its `override-pre-pass.ts` and its result classification);
- containers-06 (C7, its §3.6 background stage);
- containers-11 (#892, C8's dialogs);
- containers-13 (#890, C4's `chooseConfiguration`).

**Build after** containers-06, 08, 11 and 13 are on main.

## 1. What release 1 builds, and what it leaves

**Already done by slice 1, with nothing to add:** the pinned CLI builds a Dockerfile configuration inside `up`, which
C7 already calls:
- `build.dockerfile` and the top-level `dockerFile`;
- `context`, `args`, `target`, `options` and `cacheFrom`;
- the `vsc-<name>-<hash>` tag;
- the `-uid` image for a non-root user.

C3 already classifies a failed build as `buildFailed`, and C8 shows S034 for it. Likewise, the CLI keeps the
lifecycle markers: `postCreateCommand` runs once per container and `postStartCommand` on each start (§2). C7 already
runs `run-user-commands` in the background after every `up` (containers-06 §3.6). So gate rows 2 and 6 need rows,
not new runtime code, apart from the two changes below.

**This card adds:**
1. **F-0412 7.E8 and Q-1, the preferred outcome (B):** with `image` and a `build` (or `dockerFile`) both set, the
   build wins and is tagged `vsc-<name>-<hash>`. A local image under the `image` name stays untouched (§3.1).
2. **F-0412 7.E3:** a `build.dockerfile` or `dockerFile` that names a missing file is rejected before any reload,
   with S004's dialog (§3.2).
3. **The rows for gate rows 2 and 6** (§4.3).

**Left for later cards:**
- the "Configuring..." terminal and S153 (F-0415 5.0 step 10, BR-8, the terminal halves of 7.E1 to 7.E3, and 7.E6 and
  7.E7). It's the next F-0415 card, carded after this one. Until then, the lifecycle output reaches the Dev
  Containers log through `onCliEvent`, as slice 1 does;
- S343, the Debian 8 `jessie-updates` dialog (F-0412 7.E5, AC-20 to AC-30's S343 rows): §5 row 3 asks athena whether
  it's release 1;
- `waitFor`'s edge values (F-0415 6.1, VS-6) beyond the CLI's own handling: they're covered by the CLI, and the rows
  stay `todo` until the terminal card measures them.

## 2. What was measured (the pinned CLI 0.89.0, Docker 29, on this card's draft)

Each folder was brought `up` with `--skip-non-blocking-commands`, then `run-user-commands`, as C7 does:
1. **The tag (BR-3).** The folder `<scratch>/Gate Df` with a Dockerfile configuration gave the image
   `vsc-gatedf-2459d6c74e8155772fee1490c23e54977dbdc8a3f707b4709831a460ad966116`. The hash is `sha256` of the folder
   path's text, and the name is the basename lower-cased with its space removed. A root base image (`alpine:3.22`)
   gets no `-uid` image.
2. **The markers (F-0415).** After the first `up` and `run-user-commands`, `postCreateCommand` and
   `postStartCommand` had each run once. Then came `docker stop`, a second `up` (the same container id) and
   `run-user-commands`: `postCreateCommand` still once, `postStartCommand` twice. A third `run-user-commands`
   without a restart (a window reload) ran neither again.
3. **`image` and `build` both set (7.E8).** With no override, the build succeeded, the container ran the
   Dockerfile's content (`/which` = `fromdf`), and **the build was tagged `alpine:3.22`, taking that tag away from
   the real Alpine image on the machine**. That's the reference behaviour (A). With `--override-config` naming the
   same configuration without `image`, the build was tagged `vsc-<name>-<hash>`, and `alpine:3.22` kept its image
   id. That's the preferred (B).
4. **A missing Dockerfile (7.E3).** The result was `{"outcome":"error","message":"ENOENT: no such file or directory,
   open '<folder>/.devcontainer/Missing'","description":"An error occurred setting up the container."}`, and no
   container. The CLI's own outcome would be S034 after a reload; F-0412 wants S004 before it.
5. **Failures of the hooks:**
   - `initializeCommand` exiting 4 gave `"description":"The initializeCommand in the devcontainer.json failed."` and
     no container;
   - `onCreateCommand` exiting 5 gave `"description":"onCreateCommand from devcontainer.json failed."` and a
     container id;
   - a Dockerfile `RUN exit 7` gave `"message":"Command failed: docker buildx build …"` and no container.

   C3's classification (containers-04) already maps these to `lifecycleFailed` (`initializeCommand`),
   `lifecycleFailed` (`onCreateCommand`) and `buildFailed`, and C8 shows S034. That's F-0415 7.E2 and 7.E3, and
   F-0412 7.E2.

The builder re-runs items 3 and 4 in the PR, in a scratch folder, and restores any tag the run changed.

## 3. The design

### 3.1 The override pre-pass drops `image` beside a build (C3, `override-pre-pass.ts`; F-0412 7.E8, Q-1 (B))

`overrideText(configText, editorEnvironment)` (containers-04 §3.2) gains one rule, applied with its others:
- **when** the parsed top-level object has an `image` member **and** either a `build` member that's an object or a
  `dockerFile` member that's a string,
- **then** the override text is the configuration with the top-level `image` member removed, using `jsonc-parser`'s
  `modify(text, ['image'], undefined, …)` and `applyEdits`, like the module's other edits.

Details:
- Comments and the other members stay. When another rule also changed the text, both edits apply to the same text.
- `image` inside `build`, or in a Compose file, isn't touched: only the top-level member.
- Nothing else changes: the CLI reads `--config <the real file>` with `--override-config <the override>`, so the
  Dockerfile path still resolves from the real folder (containers-04 §3.2, measured in §2 item 3).
- The log line the pre-pass writes when it changes something names the rule:
  `the configuration's image is ignored, because it also builds from a Dockerfile (F-0412 Q-1)`.

### 3.2 A missing Dockerfile is rejected before the reload (C4, `choose-configuration.ts`; F-0412 7.E3)

In `chooseConfiguration` (containers-13 §3.6), after the container-source check passes and before `readConfiguration`:
1. The Dockerfile path is `build.dockerfile` when `build` is an object with a string `dockerfile`, otherwise the
   top-level `dockerFile` when it's a string, otherwise none. A Compose configuration has none.
2. It's resolved against the folder that holds the configuration file: `path.resolve(dirname(configFile), value)`.
3. When `ports.files.exists(<that path>)` is false:
   - show `dialogs.showError('', <S004 with {0} = the absolute path>, [<Open {0}>])`. The message line is empty.
     `{0}` in the button is the configuration file's base name (`devcontainer.json` or `.devcontainer.json`). Core
     adds Cancel, and Escape is Cancel;
   - on the button, `openPreview(configFile)`;
   - answer `rejected`.
   - Nothing reloads, so no container and no image are made (7.E3's final state).
4. `ConfigFiles.exists` is contracts §4's port. If containers-13 built `ConfigFiles` without `exists`, add it, with
   `vscode.workspace.fs.stat` in the adapter.

**The strings:**

| Id | Text | Source |
|---|---|---|
| S004 | `"{0}" does not exist.` | F-0301 3.4 (owner), F-0412 7.E3 |
| `openConfiguration` (ours, no S-id) | `Open {0}` | F-0412 7.E3 and F-0301 7.E6 show the button as "Open devcontainer.json", but no string table lists it. §5 row 1 asks athena about it |

Both go in containers-13's `CONFIG_TEMPLATES` and the l10n bundle, every locale, as containers-13 does.

## 4. Rows

### 4.1 `override-pre-pass.test.ts` (pure)

| Name | Given | Expected |
|---|---|---|
| `F-0412 7.E8, Q-1: image beside a build object is dropped` | `{"image":"alpine:3.22","build":{"dockerfile":"Dockerfile"}}` | the override parses to `{"build":{"dockerfile":"Dockerfile"}}` |
| `F-0412 7.E8: image beside the legacy dockerFile is dropped` | `{"image":"a","dockerFile":"Dockerfile"}` | no `image` |
| `F-0412 BR-16: image alone is untouched` | `{"image":"a"}` | `undefined` (no override) |
| `F-0412: a build without image is untouched` | `{"build":{"dockerfile":"D"}}` | `undefined` |
| `F-0412: an image inside build isn't the top-level one` | `{"build":{"dockerfile":"D","image":"x"}}` | `undefined` |
| `F-0412: a non-object build doesn't count` | `{"image":"a","build":"D"}` | `undefined` |
| `ADR-0009: comments and other members stay` | a JSONC text with a comment and `name` | the comment and `name` are in the override |
| `ADR-0009: this rule and an env rule apply together` | `image`, `build` and a `${localEnv:X}` with `X` empty | both edits are in one override |

### 4.2 `choose-configuration.test.ts` (over containers-13's fakes)

| Name | Given | Expected |
|---|---|---|
| `F-0412 7.E3: a missing build.dockerfile shows S004 and goes no further` | `build.dockerfile` `Missing`, `exists` false | the dialog with the absolute path, the button `Open devcontainer.json`; `rejected`; no `readConfiguration` |
| `F-0412 7.E3: the button opens the configuration` | the same; the button | `openPreview(configFile)` |
| `F-0412 7.E3: Cancel opens nothing` | the same; `undefined` | no `openPreview`; `rejected` |
| `F-0412 7.E3: the legacy dockerFile is checked too` | top-level `dockerFile` `Missing` | the S004 dialog |
| `F-0412 7.E3: the path resolves from the configuration's folder` | `.devcontainer/sub/devcontainer.json` with `dockerfile` `../Dockerfile` | `exists` is asked for `.devcontainer/Dockerfile` |
| `F-0412 5.1: an existing Dockerfile goes on` | `exists` true | `readConfiguration` runs |
| `F-0412 BR-16: an image configuration isn't checked` | `image` only | no `exists` call |

### 4.3 Gate rows 2 and 6 (`tests/acceptance/containers/gate.test.ts`, containers-09's launch)

| # | Steps | Assertions |
|---|---|---|
| 2 | Before the row, build a local base image: `docker build -t gate-base:2 -` from the text `FROM <the run's pinned alpine reference>` and `LABEL gate.base=one` (the pinned Alpine has no labels of its own, so this gives AC-6's base label). Write folder `gate-dockerfile` (containers-09 §4.1's shape) with `.devcontainer/Dockerfile` = `FROM gate-base:2` and `RUN echo built > /built`, and `devcontainer.json` = `{"name": "Gate Two", "build": {"dockerfile": "Dockerfile", "options": ["--label=gate.option=two"]}}`. Open its window and `reopenInContainer('gate-dockerfile')` until connected, as row 1 does | `devContainersOf(<folder>)` has one id; its `docker inspect -f '{{.Config.Image}}'` is `vsc-gate-dockerfile-<sha256 of the folder path>` (compute the hash in the test with `node:crypto`, from the folder path the harness wrote); `docker image inspect` of that tag has `Config.Labels` with `gate.option` = `two` and `gate.base` = `one` (F-0412 AC-6); `docker exec <id> cat /built` prints `built`; the title shows `Dev Container: Gate Two` as row 1's check does. The `afterEach` also removes `gate-base:2` |
| 2b | Write folder `gate-both` like `gate-dockerfile`, with `"image": "alpine:3.22"` added beside `build`. Note `docker image inspect alpine:3.22 -f '{{.Id}}'` (it may not exist: then note that). Reopen until connected | the container runs `vsc-gate-both-<hash>`; `alpine:3.22`'s id is what was noted (or it still doesn't exist): F-0412 AC-43's preferred outcome |
| 2c | Write folder `gate-nodf` with `{"name": "x", "build": {"dockerfile": "Missing"}}` and no Dockerfile. Send `remote-containers.reopenInContainer` (not awaited), then `waitForDialog('gate-nodf')`; read it; `answerDialog('gate-nodf', 'Cancel')` | the dialog's detail is `"<folder>/.devcontainer/Missing" does not exist.`, its buttons are `Cancel` and `Open devcontainer.json`; after Cancel, `windowState('gate-nodf').remoteName` is `null` and `devContainersOf(<folder>)` is `[]` |
| 6 | Write folder `gate-lifecycle`, an image configuration whose six hooks each append one line: `"initializeCommand": "date +%s%N >> .gate-init.log"` (on the host, in the folder), and `onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand` and `postAttachCommand` appending to `/tmp/oncreate.log`, `/tmp/update.log`, `/tmp/create.log`, `/tmp/start.log` and `/tmp/attach.log`. Reopen until connected; wait until `/tmp/attach.log` has 1 line (the background stage, up to 30 s). Close the window. `docker stop <id>`. Open the folder's window again and reopen until connected; wait until `/tmp/attach.log` has 2 lines. Then reload the window (`workbench.action.reloadWindow`), wait until connected and `/tmp/attach.log` has 3 lines | Count each file's lines (`docker exec <id> cat <file>`, piped to a line count; the host file read directly). **After the first open:** every count is 1. **After the restart**, the container id is the same (F-0409): `.gate-init.log` 2, `oncreate` 1, `update` 1, `create` 1, `start` 2, `attach` 2 (F-0415 AC-7, AC-8). **After the reload:** `.gate-init.log` 3, `start` 2, `attach` 3, and the create hooks still 1 (AC-9). Measured with the pinned CLI on this card's draft, run the way C7 runs it: exactly these counts |

Each row's `afterEach` removes the folder's containers and the `vsc-gate-*` images it made. **Row 2b also restores
`alpine:3.22` to the noted id** if the run changed it: `docker tag <noted id> alpine:3.22`. A run must never leave a
user's tag moved (§2 item 3 happened during this card's measurements and was restored).

## 5. Open rows (stop and report on #893)

1. **athena:** the `Open {0}` button has no S-id in any string table. Use it as ours (ADR-0008), or does F-0301's
   table need an id first?
2. **A re-measurement differs from §2**, for example the override doesn't stop the `image` tag from moving: report
   the CLI's output, and don't build §3.1 on a guess.
3. **athena:** is S343's dialog (F-0412 7.E5) release 1? This card leaves it `todo` for a later card.
4. **Row 6's background stage takes more than 30 s on the runner:** report the time, and don't raise the bound past
   60 s without saying so.

## 6. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`acceptance`, through §4.3:**
  - F-0412 AC-6 (the tag, the `build.options` label and the base image's label; row 2), AC-18 and AC-32 (S004 and its
    Cancel; row 2c) and AC-43 (preferred; row 2b);
  - F-0415 AC-7 (the three create hooks once), AC-8 (`postStartCommand`, `postAttachCommand` and
    `initializeCommand` again on a restart) and AC-9 (a reload runs `postAttachCommand` and `initializeCommand`, not
    `postStartCommand`), all through row 6;
  - brief §5 gate rows 2 and 6.
- **`unit`, through §4.1 and §4.2:** F-0412 AC-18 (also), and the 7.E8 override rule. 7.E8 has no AC beyond AC-43.
- **`todo`, with the card that brings it:**
  - F-0412 AC-20 to AC-30: S343 (§5 row 3);
  - F-0415 AC-11's terminal half, and the S153 and terminal ACs: the next F-0415 card;
  - F-0412 AC-41 (folder-name sanitizing): a row of containers-19, since it's the CLI's rule and needs three folders;
  - F-0412 AC-44: core's JSON validation, which release 1 contributes no schema for. Brief ruling 8, `deferred`,
    with its reason.

The remaining F-0412 and F-0415 ACs keep their seed tags.

## 7. Gates and review

Run all gates and the VSCodium run. The PR title is `remote-containers: the Dockerfile path's image rule, its missing
Dockerfile check, and gate rows 2 and 6 (card containers-15, #893)`. Request athena only; hermes assigns the peer.
