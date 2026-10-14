# Task card containers-19: the remaining gate rows

Issue: #938. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`.

**What this card is:** acceptance rows, plus whatever small runtime fix a row exposes. A fix bigger than a few lines is
reported on #938 before it's written (§6).

**Builds after:**
- #918 (containers-09 part 2: `devContainerFolder`, `devContainersOf`, `openFolderWindow`, `reopenInContainer`);
- containers-11 (#881: the F-0410 dialog, `waitForDialog`'s use);
- containers-14 part 2 (the rebuild commands in a container window);
- containers-15 (#893: the Dockerfile tag);
- containers-18 (#906: `dev.containers.cacheVolume`).

Sources:
- the brief §5, gate rows 3 and 4;
- F-0409 (remote-oss/remote-containers#23): AC-1, AC-2, AC-3, AC-6;
- F-0412 (#29) AC-41; F-0405 (#24) AC-25, AC-26; F-0201 (#18) AC-50 (the Rebuild Without Cache half);
- F-0419 (#92) AC-9 (the rebuild half).

The rest of F-0409 is the recorded gate's (D-87: F-0201 and F-0409 are the recorded suites). This card adds no row for
the ACs the recorded gate confirms.

## 1. The rows (`tests/acceptance/containers/reuse.test.ts`, new, the containers launch)

Helpers: #918's. `containerOf(folder)` is `devContainersOf(folder)` asserted to hold exactly one id. `inspectOf(id)` is
`docker inspect -f '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.StartedAt}}|{{json .Config.Labels}}'`.

| # | Steps | Assertions |
|---|---|---|
| R3, gate row 3 | `devContainerFolder('reuse-same', {name: 'Reuse'})`. Open it, Reopen, and record `containerOf`. Close the window. Open the folder again, and Reopen | first: one container, with a Docker-generated name (not empty, not the folder's) and the labels `devcontainer.local_folder` = the folder and `devcontainer.config_file` = its devcontainer.json (F-0409 AC-1, AC-3); second: the same id, still one container, `StartedAt` unchanged (it kept running: shutdown is increment 2, so nothing stopped it) |
| R4, gate row 4 | `reuse-stopped`: Reopen, record the id, close the window, `docker stop <id>`, open again, Reopen | the same id, status `running`, a later `StartedAt`, one container, and no dialog (F-0409 AC-2) |
| R4b | `reuse-removed`: Reopen, record the id, close, `docker rm -f <id>`, open again, Reopen | a new id, one container, connected, and no dialog at any 250 ms poll from the Reopen until connected (F-0409 AC-6) |
| T41 | three folders named `.f412x-_a..b___c_.d`, `f412end.` and `-f412lead`, each `devContainerFolder(<name>, {build: {dockerfile: 'Dockerfile'}})` with a one-line `FROM <the run's image>` Dockerfile. Reopen each in turn, closing each window | the images `vsc-f412x-a.b__c_d-<64 hex>`, `vsc-f412end.<64 hex>` and `vsc--f412lead-<64 hex>` exist, each tag accepted by Docker (F-0412 AC-41). The CLI makes the tag (ADR-0009), so this row checks the pinned CLI's rule. A mismatch is reported (§6), not fixed by renaming |
| B25 | `rebuild-fails`: a Dockerfile configuration that builds, Reopen; then replace the Dockerfile with one whose `RUN false` fails, and run `remote-containers.rebuildContainer` in the connected window | S034's dialog with `Edit devcontainer.json Locally`, `More Actions...` and `Retry`; no container for the folder afterwards (the old one is gone: containers-14 removes it first, BR-17) (F-0405 AC-25's first half). Then `More Actions...` lists exactly `Reload Window`, `Edit devcontainer.json Locally`, `Open Recent...` and `Open Documentation` |
| B26 | `rebuild-docker`: Reopen; then set `dev.containers.dockerPath` to `/nonexistent/docker` and run `remote-containers.rebuildContainer` | S339's dialog with containers-11's three buttons (F-0405 AC-26's first half). **And the container:** the spec says "the old container is gone". Record what we leave, and see §6 row 2. Restore the setting in `finally` |
| B50 | as B26, with `remote-containers.rebuildContainerNoCache` | the same S339 dialog, with the indicator `Opening Remote...` while it shows (F-0201 AC-50, the Rebuild half; the Switch Container half is later) |
| V9 | `cache-toggle`: with `dev.containers.cacheVolume` `true`, Reopen and check the `vscode` mount. Set it `false`, Reload Window: the same container, still mounted (containers-18 L-rows have this half). Then `remote-containers.rebuildContainer` | after the rebuild: a new id with no `/vscode` mount (F-0419 AC-9, the rebuild half). Restore the setting in `finally` |

**Every row cleans its containers** in `finally` (`docker rm -f` of `devContainersOf`), so later launches start clean.

## 2. The catalogue (`coverage-containers-r1.tsv`)

- `acceptance`: F-0409 AC-1, AC-2, AC-3, AC-6; F-0412 AC-41; F-0405 AC-25; F-0201 AC-50; F-0419 AC-9.
- F-0405 AC-26: `acceptance` only if B26's container half matches the spec, or once athena rules on §6 row 2.
  Until then it stays `todo`, naming #938.
- Each case label is the row's `#` lower-cased with its gate row number, for example `(gate-row-3)`, as #918's
  labels are (check-coverage's form).

## 3. Gates and review

Run all gates, the containers launch locally (`docker ps` first, and remove your own leftovers after), and the
VSCodium run. The PR title is `tests: the remaining Dev Containers gate rows: reuse and restart by id, and the
handed-over rows (card containers-19, #938)`. Request athena only; hermes assigns the peer.

## 4. Open rows (stop and report on #938)

1. **T41's tags differ from F-0412 AC-41.** Report the pinned CLI's tags. It's the CLI's rule (ADR-0009), and the
   answer may be a spec question, not code.
2. **B26 leaves the old container in place.** containers-14 runs C2's second check before the removal, so a missing
   Docker program stops the rebuild before anything is removed. That's arguably safer, but it isn't the observed
   behavior. Report it, and athena rules whether it's a documented deviation.
3. **R3's second Reopen restarts the container** (`StartedAt` changes). Report it: nothing in release 1 should stop a
   container between windows.
