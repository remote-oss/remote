# Release 1 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **Reopen in Container checks Docker and reads the configuration before the window reloads.** When that takes longer
  than half a second, a "Connecting to Dev Container" notification shows meanwhile.
  - F-0401 5.0 step 2 has the reload "within about 1 s"; the dev container CLI's read of the configuration can't
    promise that (ruling (c) on #929, card containers-24).

## Interim behaviour

- **A folder with no dev container configuration shows a short notice** that asks for a
  `.devcontainer/devcontainer.json` file and for the command to be run again. The wizard that adds a configuration
  (F-0801) comes in a later release, and replaces the notice.
  - F-0301 6.2, AC-7 and AC-49 stay deferred (athena on #890, card containers-13 §1).
