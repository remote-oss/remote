# Brief: Docker Compose configurations

Owner: athena (architect). Plan: #1807 group 5 (Compose), wave 2. Specs: remote-oss/remote-containers#73 (F-0413,
`spec:reviewed`, seeded in `coverage-containers-r2.tsv`), and the Compose halves of F-0201 (#18), F-0301 (#20), F-0303
(#47, BR-2a), F-0405 (#24, 6.11), F-0408, F-0409, F-0411, F-0414, F-0416, F-0417 (#62), F-0419 (#92), F-0502, F-0503,
F-0505, F-0801, F-0802, F-0901 to F-0903, F-1101 and F-1102. Those halves are the 76 lines of `coverage-containers-r1.tsv`
tagged `later (Compose)`. Decisions: D-105, ADR-0002 rule 8, ADR-0005, ADR-0009, ADR-0010, R-31, R-60.

## 1. What the CLI does, and what we add

- **The pinned dev container CLI runs Compose** (ADR-0005, ADR-0009; `[devcontainers-cli]`
  `src/spec-node/dockerCompose.ts`). Its `up` does all of the following:
  - reads the model;
  - builds the services, with the features layer and the `-uid` image of the picked service;
  - writes the per-service override file of BR-6 (image, entrypoint, `containerEnv`, labels, `mounts`, `vscode`
    volume, `overrideCommand`);
  - starts the scope with `up -d`, or `--no-recreate` when a container exists;
  - attaches to a running primary container;
  - returns `composeProjectName`.

  None of this is re-implemented (components §2.3).
- **What the CLI lacks, and we add,** is in §2 to §9:
  - the project name known before `up`;
  - the scope as a list;
  - the Compose half of the engine checks;
  - the `workspaceFolder` check;
  - the rebuild teardown of every service;
  - the shutdown stop with the in-use rule;
  - the `/vscode` check over the service's volumes;
  - the rebuild prompt's service Dockerfile;
  - the wizard's service pick;
  - the views' and ports' Compose rows.
- **F-0413 belongs to C7** (container lifecycle), as the dossier placed it. Its one picker, STR:S306, belongs to C14
  (authoring).

## 2. The Compose model and the project name (C7; BR-2, BR-3, BR-4, §16)

1. **The model comes from Compose itself.**
   - **How C7 reads it:** once per connect, inside the resolve and before any CLI call, it runs Compose's documented
     `config` through C2. The call gets the configuration's files in order (`-f` each, from the configuration's
     folder), and `--env-file` when `dockerComposeFile` is `[]` (6.4a).
     - **The output is parsed with `yaml`** (§9.1). It's the default YAML output, not `--format json`, because
       standalone Compose v1 has no `--format` and F-0201 AC-11 and AC-29 run it.
     - **C2 spawns Compose with the editor's environment,** as C3 spawns the CLI. So `COMPOSE_PROFILES` reaches this
       call and the CLI alike (AC-70).
     - **The output is read from stdout only and never logged** (R-26; dike on #1908). Compose interpolates the
       `.env` files and the environment into it, secrets included. The log gets the call's exit status, and Compose's
       stderr on a failure.
   - **Why Compose's output rather than our own parse:** that output is the merged model Compose will build and start:
     overrides, interpolation, `extends` and active profiles applied. So it's the documented form ADR-0010 asks for,
     and what the build will actually use.
   - **What C7 takes from it:**
     - the resolved `name`, used only when some compose file declares a top-level `name:`. C7 reads each file raw
       with `yaml` to tell. Compose's output always carries a `name`, its own default included, so the output alone
       can't say whether one was declared. The CLI checks the same way (`getProjectName`);
     - the primary service's `build` (context and `dockerfile`) and its `volumes`;
     - the names of the services Compose starts when none is named. Run with no `--profile`, the output lists only
       services of active profiles (BR-2's "whole project").
   - **A model Compose rejects** (a missing file, a YAML error, an invalid model: 7.E1 to 7.E3) fails into F-0410's
     generic dialog, with Compose's error in the log. STR:S135, S211 and S358 are shown nowhere (AC-53).
   - **A primary service the output doesn't list** (one in an inactive profile, AC-69, or an unknown name) gives C7 no
     Dockerfile and no volumes to check. C7 goes on to `up`, and the CLI's failure follows (7.E4, 7.E14).
2. **One project name, computed by us and passed to the CLI** (BR-3, BR-4, F-0413 §16).
   - **The function:** a pure function in `compose/project-name.ts` applies BR-3's order:
     1. the editor's own `COMPOSE_PROJECT_NAME`;
     2. the workspace folder's `.env`, then the one in the compose file's folder;
     3. an explicit top-level `name:` (the later file wins);
     4. the folder rule, with `_devcontainer` for a compose file directly in `.devcontainer/`.
   - **Normalization:** BR-3's rules, and the pre-1.21 rule of F-0201 AC-29 when C2's Compose version is older.
   - **An invalid name:** a process or compose-folder value that isn't a valid name, or a name that normalizes to
     nothing, fails before the CLI runs (7.E12, AC-57).
   - **C3 passes the name as `COMPOSE_PROJECT_NAME` in the CLI's environment.** That is the CLI's first source, and its
     own normalization leaves a valid name unchanged. So the CLI, Compose, the containers' labels and our registry use
     one name by construction (BR-4).
   - **The check:** a unit row compares `up`'s `composeProjectName` with ours, and a difference is one warn line.
   - **Why ours, and not only the CLI's result:** the shutdown helper must count a window's services from the moment
     its project is identified, before `up` creates anything (F-0417 BR-5, decision Q3). C7's paused check (§4) also
     needs the name before `up`.
3. **The scope is a list** (BR-2, F-0405 6.3): the services of `runServices`, plus the primary `service` when it isn't
   among them. When `runServices` is absent or `[]`, it's the services the model lists (§2.1). Rebuild (§5), the
   shutdown stop (§6) and the registry use this one list.
4. **What C7 doesn't check:** an absent `service`, a `service` or `runServices` entry the model lacks, a pull or start
   failure, a crash-looping service. Those are the CLI's failures (6.1, 7.E4 to 7.E7, 7.E9, 7.E13, 7.E14), and C8
   maps them as for images: F-0410's generic dialog, and S019 for a port conflict (AC-18, AC-64).

## 3. The engine checks and the configuration checks (C2, C4; F-0201, F-0301, F-0411)

1. **Compose is resolved by F-0201 BR-4** (C2):
   - first `<dockerPath> compose version`, with the effective engine (contracts §2). This also covers Podman's compose
     provider (6.10);
   - only when that fails, `dev.containers.dockerComposePath`. It's resolved like `dockerPath`: relative to the folder,
     `~` and `$HOME`, extra words (AC-51);
   - with the plugin present, the setting is never run (AC-5, AC-20, 7.E8);
   - the result is resolved again on every attempt, so a fix needs no restart (AC-30, AC-33).
2. **The pre-flight dialogs** (C2):
   - **Neither route found:** STR:S134 with "Cancel" | "Documentation" (primary). The detail is STR:S079 for a
     non-default path, and absent for the default `docker-compose` (AC-6, AC-44). "Documentation" opens the vendor's
     install page for Compose, as the engine dialogs do, never a Microsoft link (AC-6, R-31).
   - **The setting's program exists but can't run** (no execute permission, or it fails every call): STR:S135 with
     "Cancel" | "Show Log" (AC-45).
   - **Reading, `(reading-1908-s135)`:** F-0413's rule that S135 is never shown covers the conditions F-0413
     describes, and its 7.E8 has the plugin present. F-0201's boundary has no plugin, so it is the one place S135
     shows.
   - **After any of these dialogs** nothing exists, and a retry gives the same outcome (AC-12).
3. **C3 passes** `--docker-compose-path <resolved program>` only on the second route. It always passes
   `--user-data-folder <global storage>/data`, so the override files land in `<global storage>/data/docker-compose/`
   (BR-6, AC-51).
   - **The build entitlement** (ruled on #1915, register 7093d78): a Compose configuration's `up` gets
     `BUILDX_BAKE_ENTITLEMENTS_FS=0` in the CLI's environment.
     - **Why:** buildx refuses the CLI's generated features Dockerfile, which lies outside the service's build context.
     - **The security reading:** the build runs only after workspace trust, and a trusted configuration can already
       run host commands, so lifting the guard adds no capability.
     - **Scope:** an image or Dockerfile build never gets it, and neither does anything else C3 or C2 spawns. A value
       in the editor's own environment passes through unchanged.
4. **`workspaceFolder` is required** (C4; F-0301 7.E6, F-0411 AC-17, AC-39). The CLI defaults it to `/`, so the check
   is ours, as "the validation the CLI lacks" (components §1).
   - **When:** a Compose configuration whose `workspaceFolder` is absent or `""`.
   - **What's shown:** STR:S412 with "Cancel" | "Open devcontainer.json" (primary), before any notification or
     Docker call.
   - **Its place in the order:** after the 7.E3 shape check (`"image": 42` wins) and before the missing-file failure
     (AC-64).
   - **Escape** acts as "Cancel" (AC-70). The title while it's open is `<folder> - Visual Studio Code` (AC-64,
     preferred).
5. **A missing compose file shows F-0410's generic dialog** (F-0301 AC-12's reference text). F-0413 AC-11 requires the
   generic dialog, which settles F-0301's "either" without a ruling.
6. **`image` or `build` with `dockerComposeFile`** (7.E11, BR-11): the CLI's order already lets the non-Compose source
   win, so C7 runs none of §2 for it. The automatic workspace mount is still left out (BR-11's one effect).
   - **The rows check:** whether the pinned CLI leaves it out.
   - **If it doesn't,** the row stops and the difference comes to me (§11).

## 4. Finding and reusing the containers (C7; F-0409, 6.6, 6.9)

- **C7 finds the primary container by `com.docker.compose.project` and `com.docker.compose.service`,** the CLI's own
  rule. It doesn't use the folder labels: a service another window's start created carries none (6.8 step 2).
- **A paused primary container** goes to C8's S034 without a CLI call, as for images (F-0409 AC-27, with "Retry").
- **Running, exited or missing** goes to `up`. The CLI attaches, restarts with `--no-recreate`, or creates (AC-10,
  AC-44 to AC-46, AC-55, AC-56). C7 doesn't pass `--expect-existing-container`.
- **A foreign set of the same services under another project name** is left alone, and a second set is created
  (AC-47), because the lookup is by our project name.

## 5. Rebuild (C7; F-0405 6.11, AC-21, BR-17)

- **Every rebuild command tears down the whole scope, not only the primary** (6.11 steps 1 to 3). Inside the resolve,
  before `up`, C7 removes every existing container of the scope's services by their labels (`docker rm -f` through C2).
  Then `up` builds and creates the scope, with `--build-no-cache` for the two Without Cache commands. C7 doesn't pass
  `--remove-existing-container` for Compose: nothing is left to remove.
- **Containers outside the scope** are untouched, hand-started ones included.
- **Removal first, as for images** (BR-17): a failed build leaves no container of the scope. F-0303's reading on #1893
  applies here unchanged.
- **Another window's container is removed too** when its service is in the scope (6.8's pattern with no `runServices`:
  window A's rebuild removes the container window B is connected to, and B loses its connection). F-0417 BR-7's "never
  stop a container another window uses" is the shutdown rule. It doesn't bind a rebuild, which the user asks for
  explicitly, and F-0405 6.11 observes the whole set torn down.
- **"No dangling images afterward"** (AC-21) is measured by the rows. If the pinned CLI leaves the old images dangling,
  that's a §6 stop on the card, and I'll rule on it there.

## 6. The shutdown stop (C9; F-0417 BR-4 to BR-12, F-0413 BR-2, BR-8)

1. **The registration gains a Compose member** (`shutdown/protocol.ts`): the project name, the primary service, and
   the scope as a list.
   - **When it's sent:** once §2 has identified the project, before `up` (decision Q3). So a window still starting its
     services already counts.
   - **Image configurations** keep today's request.
2. **The in-use rule, Compose half** (BR-5, BR-7). When a Compose connection ends, the helper waits 10 s (BR-3). Then
   it stops:
   - **its own scope:** every running container of the project whose service is in the connection's scope, unless
     another live connection uses it;
   - **the skipped services, at the last close:** when no other live dev-container connection of the instance has a
     configuration of the project, also every running container of a service that earlier closes of the project
     skipped, unless it's in use now.

   **Which connections count as using a container:**
   - a connection connected to it, attach windows included;
   - a live dev-container connection of the same project and engine whose scope names its service.

   **The primary rule** (`reading-1912-primary-in-use`, athena on #2053, F-0417 AC-15):
   - when another live connection is *connected to* the closing scope's primary container (an attach window, or a
     window on that container; a scope that merely names the service doesn't count), the close kills nothing of its
     scope and remembers the scope's services as skipped;
   - F-0417 BR-7 says the opposite, and that question is with metis (remote-containers#133).

   Being `"none"` doesn't stop a connection from counting (AC-18). A window that lost its connection, or shows a
   failure, doesn't count (AC-52), while its own obligation waits until it ends (BR-8).
3. **The helper remembers skipped services by project and service name** (not by id), keyed by the engine
   coordinates, for its life (BR-7, Q3-amendment). So a recreated container of a skipped service is covered too.
4. **The stop style is a kill** (BR-4): `docker kill` through the connection's engine (BR-13), so each stopped
   container shows `Exited (137)` at once, 11 to 17 s after the close.
   - **How C9 finds the containers:** a `docker ps` filtered by the project label, with the documented `--format`
     template for the service label.
   - **No Compose call at close:** the files may be gone or edited by then (BR-6: the override file isn't used for the
     stop).
   - **Containers it never stops:** a `depends_on` service outside the scope (AC-63), and a hand-started service
     outside every scope (AC-13, AC-59).
   - **It creates nothing** (AC-64). A failure is one log line and isn't retried (BR-10, BR-11).
5. **`"none"` stops nothing** (BR-12). `stopCompose` on an image configuration and `stopContainer` on a Compose one each
   give the stop of their own kind (AC-9, already in `effective-action.ts`).

## 7. The `vscode` volume (C7; F-0419 AC-8, AC-20, AC-21, AC-34)

- **C3 passes the same `--mount` for the `vscode` volume as for images.** The CLI puts it in the override file's
  `volumes:`, with Compose's `rw` mode (AC-8). With `cacheVolume: false` nothing is passed (AC-34).
- **The `/vscode` check of F-0419 7.E3 also reads the primary service's `volumes` from the model** (§2.1). A target at
  `/vscode` or below fails before anything is created, and the dialog names the property: `mounts`, or the service's
  `volumes` (AC-20).
- **A project volume named `vscode` mounted elsewhere isn't a collision** (AC-21, decision "F-0419 Q-1" option a).
  Compose prefixes it with the project name.

## 8. The rebuild prompt's service Dockerfile (C20; F-0303 BR-2a, VS-3, VS-17)

- **C7 hands C20 the primary service's build Dockerfile from the model it read for this connect** (§2.1): the
  `dockerfile` resolved against the `build` context, or `Dockerfile` in the context for the short form. They talk
  in-process: C7 runs in the same window's resolve. That's the "once per activation" of BR-1.
  - **No `build`** (an image service): no file.
  - **No model read** (C7 failed, so there's no connected window).
- **C20 adds the file to its watched set as a build file** (`brief-rebuild-prompt.md` §3), named by its path relative to
  the configuration's folder (BR-2a's `{0}`). A changed `dockerfile` value is BR-11's changed reference: the departing
  file and the new one are both flagged.
- **Nothing else the compose files reference is watched:** not `env_file`, and not another service's Dockerfile
  (VS-17).

## 9. The wizard, the views and the ports

1. **The wizard's service pick** (C14; F-0413 6.2, AC-3, AC-4, AC-26, AC-27, AC-50, AC-54, AC-61; F-0801 AC-7, 11, 21,
   32, 33; F-0802 AC-22, 23, 32, 36).
   - **Reading the file:** C14 reads the picked root compose file with **`yaml`** (eemeli/yaml 2.x, ISC, no
     dependencies; ADR-0002 rule 8). Compose's own `config` can't serve here: it sorts services, and it rejects the
     list and scalar shapes the step must handle.
   - **The step's outcomes:**
     - two or more services: STR:S306, the names in declaration order (a `services:` list gives its indices);
     - one service: no step, and the name (or `0`) is written;
     - none, or a non-mapping: no step, and `"service": ""` with the template's nameless placeholder (7.E10);
     - Back returns to the previous step, and Escape ends the wizard silently;
     - a YAML syntax error gives AC-13's core command-error dialog.
   - **The pick lives only in the generated `service`** (BR-9, AC-50).
   - **The reuse rows that waited for F-0413** open with this card: the `docker-existing-docker-compose` template
     applied through the same path as `docker-existing-dockerfile`, and the compose-family "From '{0}'" items
     (`brief-increment-2-authoring.md` ruling 5).
2. **The views** (C15; F-0901 AC-37, F-0902 AC-31, F-0903 AC-16).
   - **The row:** a Compose dev container's row is labelled with its folder's name (from `devcontainer.local_folder`),
     and keeps its folder child row.
   - **Stop Container and Remove Container** act on the primary container only, and the dialogs name no sibling.
   - **Details' Configuration row** is the bare path.
3. **Ports** (C17; F-1101 AC-4, AC-19, AC-27; F-1102 AC-26).
   - **A `forwardPorts` entry `"<service>:<port>"`** is forwarded to that host name as the container sees it on the
     Compose network, and the Ports row reads `db:5432` literally.
   - **`appPort`** is already ignored for Compose (`static-forwards.ts`).
   - **A compose `ports:` mapping** is a statically forwarded row, read from the container's published ports.
   - **Automatic forwarding** sees only the attached container's processes. That's core's process-based detection, so
     F-1102 AC-26 is a row, not a design point.

## 10. Contracts and the component table

- **`contracts.md` §2:** C2's Compose route (§3.1) and its version.
- **`contracts.md` §3:** no change. The payload doesn't carry the project, because C7 computes it again on every
  resolve.
- **Shutdown protocol:** the Compose member of §6.1.
- **C7 → C20:** the service Dockerfile of §8, through a port of C20's.
- **`components.md`:**
  - F-0413 is added to C7's features, and its S306 to C14's;
  - C9 gains "the Compose stop";
  - §3's dependency line gains `yaml` (C7 for the model and the declared `name:`, C14 for the wizard).
- **`packages/remote-containers/package.json` gains `yaml` as a runtime dependency,** pinned like `jsonc-parser`. Today
  it's in the lockfile only as a dev tool's dependency, so the move changes what the extension bundles (ADR-0002 rule 8,
  and CI's licence check).

## 11. The cut and the cards

| Lines | Where |
|---|---|
| F-0413 (all but those below), and the 76 `later (Compose)` lines of r1 | this brief, now |
| F-0303 BR-2a, VS-3, VS-17 | this brief (§8), now |
| Clone in Volume: F-0413 6.7, AC-12, AC-48, AC-52, AC-62; F-0505 AC-36's volume half | `deferred`, group 13 (volumes and Clone in Volume) |
| Remote-SSH: F-0413 AC-49 | `deferred`, group 16 (remote engines) |
| Windows and WSL: F-0413 AC-32, AC-33, AC-34, AC-63 | `deferred`, `host: windows` |
| macOS: F-0413 AC-29 | `deferred`, `host: macOS` |

**Suggested cards** (daedalus cards them; the order is the build order):
1. **Connect:**
   - §2: the model, the name and the scope;
   - §3: C2's route, the dialogs, C3's flags, C4's `workspaceFolder` check;
   - §4: the lookup;
   - §5: rebuild;
   - §7: the volume.

   Rows: F-0413's connect, naming, reuse, error and rebuild lines; F-0201's, F-0301's, F-0405 AC-21, F-0408, F-0409,
   F-0411, F-0414, F-0416, F-0419, F-0502, F-0503 and F-0505 AC-36's Compose half.
2. **The shutdown stop** (§6), after card 1. Rows: F-0417's Compose lines, F-0413 AC-6, AC-24, AC-28, AC-30, AC-31,
   AC-65, AC-68.
3. **The wizard** (§9.1), independent of 1. Rows: F-0413 6.2's lines, F-0801's and F-0802's.
4. **Views, ports and the rebuild prompt** (§8, §9.2, §9.3), after card 1. Rows: F-0901 to F-0903, F-1101, F-1102, and
   F-0303 BR-2a, VS-3 and VS-17.

**Measure before asserting:** the rows' method is containers-41's. Where the pinned CLI 0.89.0 differs from a
criterion, the row stops (§6 of the method) and the difference comes to me. The likely ones:
- BR-3's leading-character rule (AC-39);
- BR-11's mount;
- F-0408 AC-16's "no 'Starting container' step": the CLI reports that progress step for Compose too.
