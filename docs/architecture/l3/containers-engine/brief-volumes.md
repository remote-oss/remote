# Brief: volumes and Clone in Volume (C13)

Owner: athena (architect). Plan: #1807 group 13, ahead of group 7 (hermes, 2026-11-03). Specs, all `spec:reviewed`:
- remote-oss/remote-containers#65 (F-0701 Clone Repository in Container Volume);
- remote-oss/remote-containers#86 (F-0702 Clone Repository in Named Container Volume);
- remote-oss/remote-containers#87 (F-0703 Clone GitHub Pull Request in Container Volume);
- remote-oss/remote-containers#70 (F-0704 Bootstrap container);
- remote-oss/remote-containers#98 (F-0705 Explore a Volume in a Dev Container);
- remote-oss/remote-containers#93 (F-0706 "Open in Dev Containers" URI handler);
- remote-oss/remote-containers#112 (F-0707 Continue Working in Container Volume);
- remote-oss/remote-containers#117 (F-0708 Mount performance guidance).

With them come the volume halves of F-0806 and F-0808 (`brief-new-container-and-features.md`) and the
`later (volumes …)` lines of r1. Decisions: D-105, R-27, R-31, R-60, ADR-0005, ADR-0009, ADR-0010, ADR-0013, F-1406.

## 1. One pipeline, C13

C13 (volumes, the dossier's component) runs one pipeline, whatever the entry point. Each entry point only fills its
**source** and its **volume choice**:

| Entry point | Source | Volume |
|---|---|---|
| F-0701 Clone in Volume | a repository, as typed or picked | unique: `<repo>[-<segment>]-<sha256 of the URL>` |
| F-0702 Named volume | a repository | picked or new, named literally |
| F-0703 Pull request | the PR's base repository, then its head | unique, `<repo>-pull-<n>-<hash>` |
| F-0706 URI handler | the `url` parameter | as F-0701 |
| F-0808 Try a Sample | a row of our sample table | as F-0701 |
| F-0806 New Dev Container | an applied template, not a repository | named by the name step |

The pipeline has two halves:
- **before the reload,** in the local window (§2);
- **in the resolve** of the reloaded window (§3).

F-0705 (§5), F-0707 and F-0708 (§6) sit beside it.

## 2. Before the reload (C13, C5, C2, C6)

1. **Gates:**
   - C5's trust dialog, once per profile, shared by F-0701 and F-0703 (F-0701 BR-4). Its link is our own page (R-31).
   - Then C2's engine check (F-0201).
   - Every engine program resolves `dockerPath` through `engineBaseOf` (F-0201 AC-55).
2. **The input:**
   - URL, `owner/repo` (exactly two segments, BR-7), local path or SSH URL, trimmed (BR-15);
   - `/tree/<ref>`, `/commit/<sha>` and `/pull/<n>` parsed for github.com only (BR-2).
   - The GitHub picker uses core's `github` authentication provider (6.3).
     - **The picker itself** is the built-in git-base API's `pickRemoteSource({providerName: 'GitHub', branch: true})`
       (athena on #1973). It's looked up at use time, never in `extensionDependencies`, with our S067 as its title and
       S068 as its placeholder. S295 and S245 are git-base's own labels.
     - **Without git-base and a GitHub provider** the item isn't offered, with one log line.
3. **The host-side pre-check (BR-5):** `git ls-remote` on the host, before any Docker object. Git's and ssh's
   credential and host-key prompts become quick inputs.
   - **The askpass relay is one, shared.** lib-ssh's `askpass/` (endpoint, launcher, messages) moves to **lib-helper** (athena's ruling, register 5c82020;
     lib-host stays a leaf), so that remote-containers can use it without importing lib-ssh (components §3).
     The move touches transport-and-server `contracts.md`'s S2 and S7 rows (the askpass environment), and remote-ssh's
     imports follow.
   - **The program git runs:** remote-containers ships an askpass program of its own, `src/programs/askpass.ts` built
     to `dist/askpass.js`, as remote-ssh does.
   - **The classifier is a parameter of the endpoint** (proteus on #1970). `askpass/endpoint.ts` imports lib-ssh's
     `classifyPrompt` today, so the move takes it as an argument.
     - ssh's classifier stays in lib-ssh.
     - C13 passes its own, covering git's "Username for" and "Password for" prompts and ssh's host-key and passphrase
       questions. If C13 reuses ssh's patterns for those, the pure classifier moves to lib-helper too.
     - S7's contract row changes with it.
   - **git's input** (proteus on #1970), on the host and in the bootstrap alike:
     - every git call takes the source as one argv element after `--`, never inside a shell string, with
       `GIT_TERMINAL_PROMPT=0`;
     - a source from F-0706's link (and F-0808's table) is limited to `https://`, `http://`, `ssh://`, scp-style
       `user@host:path` and `git://`;
     - `ext::`, `fd::` and `file://` from a link never reach git, and those calls pin `protocol.allow` to that list
       (`-c protocol.allow=never` with the listed protocols allowed);
     - a local path is accepted only when the user typed it into F-0701's input.
   - C13 spawns the check through C2-style spawning with `GIT_ASKPASS` and `SSH_ASKPASS` pointed at the relay, and
     `SSH_ASKPASS_REQUIRE=force`.
   - A failure is S052's info modal, with no reload and no Docker object (7.E1).
4. **The payload** (`contracts.md` §3 gains a second shape, the **volume payload**):
   `{repositoryPath, volumeName, folder, cloneInfo: {urlToClone, ref?}, inspectVolume}`, hex-encoded as now.
   - **Field names:** F-0701 BR-12's, reused verbatim (F-1406, D-14). A unique volume is `"__UNIQUE__"`.
   - **The engine:** the `settings` engine member of §3 joins as it does for folders (F-0205 BR-19).
   - **The URI:** `vscode-remote://dev-container+<hex>/workspaces/<folder>`.
   - **Open Recent:** S417's label.
   - **A reload doesn't clone again** (BR-12).
5. **The reload:**
   - C6 reloads the *same* window into the volume payload.
   - An untitled workspace gets core's save prompt first, and declining it drops the clone silently (BR-18).
   - The same URL requested from its own connected window does nothing (BR-3, F-0702 BR-18).

## 3. In the resolve (C7, C2, C3, C13)

1. **The volume (C2):**
   - created if absent, with F-0701's labels (`vsch.local.repository`, `.unique`, `.branch`; F-0703's `.pullRequestId`);
   - a named volume is created only after its folder is accepted (F-0702 BR-14);
   - volume labels are fixed at creation (F-0702 BR-8).
2. **The bootstrap container (F-0704),** built from **our own definition** (§16: don't copy the reference's).
   - **The image:**
     - `FROM alpine:3.20` (Docker Hub's official image, no Microsoft registry), with `docker-cli`, `docker-cli-compose`,
       `git`, `git-lfs`, `openssh-client` and `nodejs` from Alpine's packages, and our pinned dev container CLI copied
       in;
     - tagged `vsc-volume-bootstrap:latest` and built from a temporary context on every pass (BR-1);
     - a custom `bootstrapImage` is used as is, refreshed when `bootstrapImagePull` says so (BR-2, BR-4).
   - **The container:**
     - root, a random name, no labels of its own (BR-5);
     - the volume at `/workspaces`, and `dockerSocketPath` bound to `/var/run/docker.sock` (BR-3);
     - the five-tool PATH check, with S344 or S345 (BR-6 to BR-8);
     - Node.js is in our image, so BR-12's download path applies only to a custom image without it.
   - **The settings** are read at every start, Retry included (BR-14).
3. **The clone, inside the bootstrap.** C13 drives each step as its own `docker exec` through C2. No program of ours
   runs the steps inside, which keeps the surface small.
   - **Reading the steps (ADR-0010):** each is read by its exit status and our own markers, never by git's text. S193
     quotes git's output as the dialog's detail, which is allowed, but nothing branches on it.
   - **git's input** follows §2.3: the source after `--` as one argv element, `GIT_TERMINAL_PROMPT=0`, and the pinned
     `protocol.allow` for a source that came from a link.
   - **The steps:**
     - a shallow clone at the ref into `/workspaces/<folder>`, with no submodules (F-0701 BR-13);
     - a non-empty folder is opened unchanged (F-0702 BR-9);
     - the configuration is looked up (`.devcontainer/devcontainer.json`, then `.devcontainer.json`, BR-17), with a
       `repositoryConfigurationPaths` match first (BR-10, with group 9);
     - then full history and tags (BR-16). A failed deepening gives our own warning (7.E6), and the string joins the
       table under R-27.
   - **With no configuration,** C14's template picker runs on the cloned files (6.1, 6.8), and Escape gives S414.
   - **F-0806's source** copies the applied template's scratch folder into `/workspaces/<folder>` with `docker cp`
     through C2, instead of a clone.
4. **`up` runs inside the bootstrap,** where the files are (F-0704 step 10).
   - C3 gains a **container CLI host**: the same bridge, its process run by `docker exec` into the bootstrap through C2.
   - **Arguments:** `--workspace-folder /workspaces/<folder>`, the volume as the workspace mount at `/workspaces`, the
     `vscode` mount (brief-compose §7's rule), and the id labels F-0701 BR-3 names.
   - **The repository's own `workspaceMount` and `workspaceFolder`** are ignored, with one log line (§10).
   - **Compose:** the files and the `.env` are inside the volume, not on the host. So for a volume workspace C7's Compose
     steps (brief-compose §2: the `config` read, the raw `name:` check and the scope) run inside the bootstrap, through
     the same container CLI host as `up`. That's why `docker-cli-compose` is in the image. F-0413 AC-12, 48, 52 and 62
     take this path.
5. **Reuse (F-0409, BR-3):**
   - a container matching the id labels is restarted, with no clone;
   - a left-over volume with no container gets a new container, and nothing is cloned again;
   - Rebuild never clones.
6. **The bootstrap is removed** at BR-10's points: after the connect (within 20 s), at once after a failed check, when
   the no-configuration flow is left, and after 7.E4. It's never reused across passes, and the volume is never removed
   (BR-9a).
7. **Failures:**
   - a clone failure is S193 with git's text (7.E2, 7.E3, 7.E6, 7.E7);
   - a build failure is F-0410's S034;
   - `${localWorkspaceFolder}` binds give S018.
   - **The buttons:** Close Remote, More Actions... and Retry. **"Edit devcontainer.json in Recovery Container"**
     arrives with group 7. Escape acts as More Actions (BR-6).
   - **A reload during the clone** waits for it or clones again, and leaves no bootstrap behind (7.E9, AC-50).
8. **Trust:** a volume window is trusted by C5's forced trust (F-0106 BR-13).
9. **Credentials:**
   - **What the bootstrap gets:** the `.gitconfig` copy, the GPG files and agent socket, and the SSH-agent relay
     (F-0704 step 6) are C16's, personalization (F-1001 to F-1004, plan group 15).
   - **Until C16 lands:** public repositories clone over https and `git://`. Private repositories, and every SSH URL
     (`git@github.com:` needs a key inside the bootstrap even for a public repository), wait for group 15's agent and
     credential relays. The pre-check on the host already has the user's own credentials.

## 4. The entry points' own parts

1. **F-0701:**
   - the command `remote-containers.openRepositoryInUniqueVolume` (Palette, remote indicator, the Dev Volumes title);
   - the source pick and GitHub picker;
   - a trailing `/` on a non-GitHub URL is ignored (Q7);
   - characters a volume name can't hold are sanitized (Q6).
2. **F-0702:**
   - the S318 picker, with "Create a new volume..." first and focused, then `unique=false` volumes sorted;
   - the name box, prefilled `vsc-remote-containers`, with S397 before S248 (BR-1, BR-2), and a collision caught on Enter
     with S395 (BR-3);
   - the folder box, not validated (BR-5, BR-10);
   - Escape anywhere aborts silently (BR-6).
3. **F-0703:**
   - the input box with its two shape checks (S213 live, S212 on Enter);
   - the lookup through GitHub's public REST API, anonymous first, then core's `github` provider (§16, 7.E3). The API is
     the feature's subject, not a link of ours, so R-31 doesn't apply;
   - the fork or same-repository checkout (BR-4, BR-5);
   - the forced `GitHub.vscode-pull-request-github`, kept by F-1404 §6 and installed from the editor's gallery;
   - the PR-row command `checkoutPRInVolume` on the partner extension's view (6.7).
4. **F-0706:**
   - `registerUriHandler` for `<vscode.env.uriScheme>://remote-oss.remote-containers/cloneInVolume?url=…`. The scheme
     comes from the editor and is never hard-coded (BR-11), and the reference's id is never registered;
   - exact-case path and `url`, first occurrence (BR-1, BR-2), and S178 for a missing one;
   - the stricter parse of decision F-0706.Q1: S096, S180 and S210, each a modal error with "OK" like S178, mapped to
     its failure by its text;
   - `/pull/`, `/tree/` and `owner/repo` values resolved, as §16 recommends.

## 5. F-0705, Explore a Volume (C13, beside the pipeline)

- **The commands:**
  - `remote-containers.inspectVolume` in the Palette, everywhere;
  - `inspectInBasicDevContainer` on Dev Volumes rows (with F-0904, group 14);
  - the Container Tools hand-in (6.8).
- **The picker:** S319 lists every volume, `vscode` included (BR-2), with dates in English (Q1).
- **The container:** from one fixed definition of ours in `<temp>/inspect-volume/<version>/`, shared and editable
  (BR-4).
  - `remoteUser: root` (BR-8), the volume at `/volume`, the `vscode` volume at `/vscode`, and no Docker socket.
  - Its base is `alpine:3.20` (Docker Hub). The reference pins Microsoft's base image (Q2), and we don't pull from
    Microsoft's registry. If a content row needs something only that image has, the row stops and comes to me.
- **Reuse:** by the label pair `vsch.local.volume` + `devcontainer.config_file` (BR-5). Recovery containers take a
  different key (Q3, preferred), with group 7.
- **The window:** the volume payload with only `volumeName` (and `inspectVolume`), opened in Restricted Mode, titled
  "volume [Inspect Volume]".
- **Stopping:** about 10 s after leaving, never removed (BR-7, through C9's shutdown).

## 6. F-0707 and F-0708

- **F-0707 is dormant by spec** (BR-7). The two commands and two `continueEditSession` entries are declared exactly
  (BR-1 to BR-4, palette `when: false`). `contribEditSessions` stays declared with the other six (F-0101 BR-8), and
  one grant covers them all (F-0101 BR-9). So the entries are read, as the reference's are, and their dormancy rests on
  their `when` clauses (BR-3, BR-4). Corrected on #2040 (athena). No probing for Remote Repositories. Rows assert the
  dormancy.
- **F-0708, C15:**
  - the "I/O performance" row (S199, S425) under each bind mount in Details, only when the Windows-side Docker CLI
    runs the engine (BR-4), so it's mostly platform-01's lines;
  - `remote-containers.openInformationAboutMountPerformance`, registered with the view's first load (BR-1), opening
    our own page (R-31);
  - the S426 and S073 notification half joins F-0402's reopen notification [inferred], on non-Linux clients.

## 7. Contracts, components, dependencies

- **`contracts.md` §3:** the volume payload.
- **The shutdown protocol** (`shutdown/protocol.ts`): `ContainerIdentity` gains a volume form, `volumeName` + `folder`,
  matching the `vsch.local.*` and id labels. It serves the lookup by labels for a connection that ends before its
  container is known, and F-0705 BR-7's stop, as brief-compose §6.1 added Compose's member.
- **C3:** the container CLI host.
  - **ADR-0009 is amended:** C3 spawns the CLI with the editor's own Node, *except* in the container CLI host, where
    the CLI runs on the bootstrap image's Node (Alpine's `nodejs`, at least 20 as the CLI needs). The amendment goes
    into ADR-0009's decision with this card.
- **C2:** volume create, list and inspect, build, run, exec and remove for the bootstrap.
- **The askpass relay:** lib-ssh → lib-helper (remote-ssh's imports follow); lib-helper gains an edge to lib-host for `posixQuote`.
- **`components.md`:** C13 joins the built components, with F-0701 to F-0708 and the volume halves of F-0806 and F-0808.
- **The bootstrap and Explore definitions** ship as files in the package. No new runtime dependency: Alpine's packages
  are installed inside the images, not into the extension.

## 8. The cut and the cards

| Lines | Where |
|---|---|
| F-0701 to F-0708, the r1 `later (volumes …)` lines | this brief, now |
| the recovery-container button and its rows | group 7 (next brief) |
| private-repository clones (credentials in the bootstrap) | group 15 (C16 personalization) |
| the Dev Volumes view (F-0904) and its row actions | group 14 |
| `repositoryConfigurationPaths` in the clone (BR-10) | group 9 |
| Windows, WSL and macOS lines; remote-engine (SSH host) lines | platform-01 (#1966); group 16 |

**Suggested cards** (daedalus; the first is the core the others need):
1. **The core**, through F-0701:
   - the askpass relay's move to lib-helper;
   - the pre-check, the payload, C6's reload and C5's forced trust;
   - the volume, the bootstrap image and container, and the clone with its deepening;
   - C3's container CLI host and `up`;
   - reuse, removal and the failure dialogs (without the recovery button).
2. **F-0702**, the named volume.
3. **F-0703**, the pull request.
4. **F-0706**, the URI handler.
5. **F-0705**, Explore a Volume.
6. **F-0707's declarations and F-0708's row.**
7. **Then group 6's F-0806 and F-0808 cards** (`brief-new-container-and-features.md` §3, §4).

**Measure before asserting**, as containers-41's method says. The likely stops:
- the pinned CLI's `up` inside the bootstrap;
- the deepening on large repositories;
- the S096, S180 and S210 mapping.
