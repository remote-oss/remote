# Brief: repository configuration folders (F-0302)

Owner: athena (architect). Plan: #1807 group 9. Spec: remote-oss/remote-containers#78 (F-0302, `spec:reviewed`).

With it come the `repositoryConfigurationPaths` halves of F-0303 (AC-19's variant), F-0701 (BR-10), F-0807 (BR-21) and
F-0402 (S368's wording). Decisions: D-100, D-105, F-0302 Q2, R-27, ADR-0010.

## 1. What exists, and what this adds

- **Built (D-100, increment 2):** the user-data store (C14's `authoring/user-data-store.ts`: `configs/<basename>[-n]/`
  with its `.devcontainer-internal.json` marker, BR-2), S026, copy-to-workspace (S094, S095) and the delete dialog
  (S108). The store's root is our own global storage (F-1401); the reference's id in BR-2's path is reference data.
- **This adds:**
  - the `dev.containers.repositoryConfigurationPaths` source (BR-1);
  - the user-data source as a *discovery* source for every opening command, not only F-0801's;
  - the joined picker (BR-3);
  - S368's wording (BR-4);
  - the rules on trust, scope, multi-root and Clone in Volume (BR-6, BR-7, BR-9, BR-12, BR-13).

## 2. The mirrored lookup (C4; BR-1, BR-7, BR-9)

1. **The remotes:**
   - every configured remote's URL, read through C2-style spawning with `git config --get-regexp '^remote\..*\.url$'`.
     That's a documented, machine-readable form (ADR-0010), not `git remote -v`'s text;
   - run in the opened folder, so a subfolder of a repository finds the enclosing one (BR-1, Subfolders);
   - two remotes with one URL count once.
2. **The derivation:** one pure function, `mirroredPathsOf(url) → string[]`, applies BR-1's table on the URL as text:
   - never normalized, and case kept;
   - `https://` keeps the whole authority (userinfo, `:port`);
   - the scp form maps to `<host>/<path>`;
   - `ssh://` with a port maps to `<host>/<port>/<path>`;
   - a trailing `.git` is removed;
   - **F-0302 Q2 adds `git://` and portless `ssh://`,** both mirrored to `<host>/<path>` (7.E3, 7.E6).
3. **The files** under each `<root>/<mirrored path>/`: F-0301's three shapes, `.devcontainer/devcontainer.json`, a root
   `.devcontainer.json`, and `.devcontainer/<name>/devcontainer.json` (BR-1, File shapes).
4. **The setting** (BR-7, BR-9):
   - user and application scoped, default `[]`, read on the UI host (the extension's `ui` kind);
   - each entry is a literal absolute path: no `~`, `${env:…}` or `${userHome}`, and a trailing `/` makes no difference;
   - a missing root is skipped silently (7.E1).
5. **Trust (BR-6):** no external source is looked up until the folder is trusted. That includes the `git config` read,
   so nothing of an untrusted folder runs. F-0801's creation paths stay available in Restricted Mode.

## 3. Discovery, the picker and the window (C4, C6, C20)

- **The candidates** are collected from every source: F-0301's local files, every mirrored match for every remote, and
  the user-data match (BR-2's store, by the opened folder's `rootFolder`).
  - Identical paths count once.
  - One candidate is used silently. Two or more give F-0301's S303 picker, ordered by file path (BR-3, 7.E2), with the
    external candidates listed first (F-0807 BR-21).
- **The chosen configuration's own path** goes into the payload's `configFile` (contracts §3) as it is, outside the
  workspace. C3 passes `--config <that path>` with `--workspace-folder <opened folder>`.
  - So the configuration's relative paths resolve from the file, while the workspace mount, the names and
    `devcontainer.local_folder` stay the opened folder's (BR-14).
  - Nothing marks the source while connecting (BR-5).
- **S368's wording:** F-0402's reopen notification uses S368 ("this repository") whenever the resolved source is
  external, even when a local copy also exists (BR-4, 6.2, 6.3).
- **C20** watches the configuration where it lives, the mirrored file included, since it watches the payload's
  `configFile`. That's F-0303 AC-19's mirrored variant.
- **F-0807** writes a mirrored file in place, never copies it into the workspace (BR-21), through the same candidate
  list.

## 4. The edges

- **A multi-root `.code-workspace`** (BR-12): neither external source is consulted. Reopen goes straight to F-0801's
  location pick (6.5).
- **Clone in Volume** (BR-13, F-0701 BR-10, `brief-volumes.md` §3.3):
  - only the mirrored source, matched on the host against the URL *as typed*;
  - the user-data source is never consulted;
  - a match never builds a picker, and always wins over the clone's own committed configuration.

  C13 runs the same `mirroredPathsOf` on the source's `urlToClone` before the reload, and puts the found path into the
  payload's `configFile`.
- **WSL** (BR-10, BR-11): an external configuration's path translation, and the hidden user-data choice when the build
  runs inside WSL, are platform-01's.
- **The user-data basename collision** (7.E4) is already built (`-2`, `-3`).

## 5. Contracts and the cut

- **C4** gains the external sources and the joined picker: `candidatesOf(folder) → Candidate[]`, each with its source.
- **The pure `mirroredPathsOf`** lives in C4, and C13 imports it.
- **C2** runs `git config --get-regexp` for C4. Every engine program still resolves `dockerPath` through
  `engineBaseOf`.
- **F-0402** (C6) takes the source to choose S368.
- **No new dependency.**

| Lines | Where |
|---|---|
| F-0302's lines (the 20 cut to group 9, plus its `todo`), F-0303 AC-19's mirrored variant, F-0807 BR-21's lines, F-0701 BR-10's | this brief, one card |
| F-0302 BR-10, BR-11 and VS-10 (WSL), VS-15 (Windows with Docker Desktop) | platform-01 |
| VS-9 (macOS without a running engine) | platform-01 |

**One card** (daedalus): the lookup, the derivation's table as unit rows (every BR-1 shape, the Q2 additions, and the
non-matching forms), discovery, the picker, S368 and the Clone-in-Volume half. The Clone-in-Volume half lands after
group 13's core.

**Measure before asserting**, as containers-41's method says. The likely stop is the CLI's `--config` outside the
workspace with a relative `build.context` (BR-14).
