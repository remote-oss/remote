# Conformance runner

Replays the conformance suite (`../suite/`) against a build of the extension and compares every observation with the
`expect` block recorded against the reference. The runner contains:
- the lab driver (`lab/lab.mjs`, the only code that talks to the VS Code window);
- the provisioner and fixture plugins (`encode/provision.py`, `encode/fixture.py`, `dind.py`);
- the recorder in replay mode (`encode/record.py --replay`, `encode/suite.py`);
- the case schema (`encode/schema.py`).

## What a run does

For each case, once:
- start a private Docker daemon on a copy of the engine fixture's data root;
- restore the editor fixture into a fresh VS Code profile and install the build under test;
- write the case folder, apply the profile's state scripts, start VS Code;
- drive the steps through the lab driver;
- normalize the observations and compare them with `expect`;
- tear everything down.

Results: `$CONFORMANCE_WORK/results/<suite-run>/<case>.json` (`pass`, `fail` with the differences, `not-applicable`, `not-comparable`)
and `summary.json`.

## Requirements (one Linux machine or CI runner)

| Requirement | Detail |
|---|---|
| Docker Engine | privileged containers allowed (the private daemons are `docker:dind`); the docker bridge at 172.17.0.1, where the fixture mirror listens on port 5055 |
| tools | bubblewrap (`bwrap`; shows each run's private daemon to VS Code as `/run/docker.sock`), `socat`, `python3` with PyYAML, Node.js 20+ |
| VS Code | the version the suite was recorded on (`recorded.vscode_version` in the cases; 1.139.1); `ENCODE_VSCODE` (the executable) and `ENCODE_CODE_CLI` (`bin/code`) if not under `/usr/share/code`. `bin/lab-code` starts it with `--enable-proposed-api=<reimplementation.extension_id>` from the package's identity file, so the build under test keeps its proposed API as the reference keeps its own through the editor's product.json (athena, 0.2 gate, remote#737) |
| display | an X display (for example Xvfb with `DISPLAY` set) |
| Git fixtures | `git` on the machine; port 9418 on 172.17.0.1 free: cases clone from `git://172.17.0.1/<repo>.git`, served there by the fixture Git server (container `encode-git`); the image the Git fixture definitions pin (`image:`), pulled by digest |
| architecture | linux/arm64 or linux/x86_64. `bin/conformance build mirror` builds the mirror definition of your machine's image platform (`../fixtures/mirror/*.yaml`: one per platform, each source pinned by its single-platform manifest digest; the x86_64 one also names the multi-platform index it comes from and checks it); engine fixtures are then built from the same definitions for your platform. A case runs only where it is valid: its `recorded.platform` or a platform `recorded.confirmed` lists; elsewhere it is `not-applicable` (see `../suite/README.md`, "Platforms") |

## Set up once

```sh
cd tests/conformance/runner/lab && npm install          # the lab driver's one dependency (playwright-core)
export CONFORMANCE_WORK=$HOME/conformance-work          # scratch space (default); NOT under /tmp (see below)
export LAB_SLOT=31 DISPLAY=:99                           # the editor fixture is captured in this slot
```

Fixtures are never shipped as tarballs: you build them from their definitions (`../fixtures/`), with pinned inputs.

### Environment

| Variable | What |
|---|---|
| `DISPLAY`, `XAUTHORITY` | the X display; under Xwayland also its authority file (GNOME: `/run/user/<uid>/.mutter-Xwaylandauth.*`) |
| `ENCODE_SLOTS` | the runner slots, for example `31-32`; each slot's window listens on port 9222 + slot |
| `CONFORMANCE_SUITE` | a suite's `tests/conformance` folder, when this runner is not the suite's own copy (the monorepo's shared runner) |
| `ENCODE_IDENTITY`, `ENCODE_RULES` | the package's identity file and encode rules; default: `identity.yaml` and `rules.json` beside the suite, else this runner's own (the monorepo keeps them in `tests/conformance/packages/<package>/`) |
| `ENCODE_WAIT_SCALE` | every case wait times this factor; default: `runner.wait_scale` in the identity file, else 1 |
| `ENCODE_VSIX_DIR` | fixture extensions a case adds by package name (default `$CONFORMANCE_WORK/vsix`); `memfs-sample.vsix` is VS Code's MIT file system provider sample (`fsprovider-sample` in microsoft/vscode-extension-samples), packaged with `vsce` |

Each window gets a private, empty `<slot>/tmp` as `TMPDIR` and its own `XDG_CONFIG_HOME` under the slot, so pickers
over the home and temp folders list what the recordings list. Provisioning never keeps the editor's
`state.vscdb.backup` files.

1. Pull every source image of your platform's mirror definition (`../fixtures/mirror/*.yaml`, the one whose `platform`
   is your machine's) at its pinned digest, and tag it with the name the file gives. For example, pull
   `mcr.microsoft.com/devcontainers/base@<digest>` and tag it `mcr.microsoft.com/devcontainers/base:alpine`
   (`bin/conformance build mirror --pull` does this for you).
2. Build in this order:
   ```sh
   bin/conformance build mirror               # a local registry (container encode-registry, 172.17.0.1:5055), your platform's
   bin/conformance build engine/base
   bin/conformance build engine/pilot-states
   bin/conformance build editor/fresh-public  # captured with no extension installed
   bin/conformance build git/<name>           # each fixtures/git/<name>/: repositories from their fast-export streams
   ```
   Git fixtures are served per run: before a case that clones over `git://`, the provisioner starts (or refreshes) the
   `encode-git` container from the pinned image and checks that it serves exactly the fixture's commits. A case whose
   repository no Git fixture lists is refused.

Case folders live under `$CONFORMANCE_WORK/workspaces`. The private daemons mount that folder at the same path,
because the extension bind-mounts a case folder from the editor's path. It must therefore not be under `/tmp`: the
`docker:dind` image mounts its own tmpfs over `/tmp` and would hide it. The runner refuses a work folder there.

Your tarballs have other hashes than the published catalogue's (`../fixtures/CATALOG.json`). A case's pin
(`engine: base@<sha12>`) resolves to your build of the same definition (same name and definition hash): see
`ENCODE_REFERENCE_CATALOG`.

## Run

```sh
ENCODE_EXTENSION=/path/to/your-extension.vsix bin/conformance run --feature F-0201 --slots 31-32
```

- `--slots`: free slot numbers (1-127; default `$ENCODE_SLOTS`, else 31-32). Slot `s` uses the window debugging port
  9222+s, the private daemon port 23750+s and the address space of `dind.address_pool(s)`. That space is in
  10.128.0.0-10.255.255.255 and overlaps no route of the machine; the daemon refuses to start otherwise.
- Cases run in parallel, one per slot. `--profile <name>` limits the run to one profile, `--case <id>` to one case.
- Profiles list `hosts: [local]`: this machine.

### The extension under test

- **Which build.** `ENCODE_EXTENSION` names it: a package file (`/path/to/your-extension.vsix`) or a
  `publisher.name@version` the editor can install by id. A profile's editor environment says
  `extensions: [under-test]`; provisioning installs `ENCODE_EXTENSION` there, by id, into a fresh profile for every
  case. Fixture extensions a case adds by package name are looked up in `ENCODE_VSIX_DIR` (default
  `$CONFORMANCE_WORK/vsix`).
- **Its identity.** Set `reimplementation.extension_id` in `encode/identity.yaml` to your build's id, and
  `reimplementation.display_name` to its display name. Observations are normalized before the comparison: the id
  becomes `${EXT_ID}`, the display name in notification sources `${EXT_NAME}`, and the editor's product name in window
  titles (`app_names`) `${APP_NAME}`. The status bar observation keeps the items whose id contains your extension id.
  No case asserts an identity, so another id or name never fails a case once the file names it.
- **Command lines are not compared.** Any command line shown on screen is replaced by `<docker command>`
  (`redact.py`). A case asserts the message around it and that a command is named, never the command's construction.

## In CI

One job per profile:
1. set up as above (cache the fixture builds by definition hash);
2. run `bin/conformance run --feature <F> --profile <P>` for the features of the suite;
3. publish `summary.json`.

The job fails on any `fail`. `not-applicable` (a profile the machine cannot provide) is reported, not failed.
`not-comparable` (a case recorded under a newer normalization than this runner's) also fails the job: the runner is
out of date, and no verdict may be taken from it until it is synced.

## Not here

- The recordings, transcripts and raw observations stay where the suite is recorded and kept green against the
  reference.
- So do cases that depend on the reference's own artefacts (reference-only cases) and cases whose fixtures hold state
  the reference wrote.
- So does the recording side's own machinery: scheduling, accounts and orchestration.
