# Release 1 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **Reopen in Container checks Docker and reads the configuration before the window reloads.** When that takes longer
  than half a second, a "Connecting to Dev Container" notification shows meanwhile.
  - F-0401 5.0 step 2 has the reload "within about 1 s"; the dev container CLI's read of the configuration can't
    promise that (ruling (c) on #929, card containers-24).

- **Switching the dev container's `remoteUser` to another account and reloading the window connects** as that
  account, in the same container, with no rebuild. Files the new account creates in a bind mount keep its own
  user and group ids, because the ids were synchronized for the previous account. Rebuild the container to
  synchronize them again.
  - F-0416 7.E4 and AC-35 describe a failed connect instead (ruling 16 on #737; spec question on
    remote-oss/remote-containers#63).

## Interim behaviour

- **Editing the dev container configuration shows no rebuild prompt.** Reload the window, or run "Rebuild
  Container", to use the edit. The notification that offers the rebuild (F-0303) comes in a later release.
  - F-0416 AC-25, AC-31, AC-34 and AC-35 answer that notification with "Ignore", and their rows reload instead
    (ruling 15 on #737).

- **A folder with no dev container configuration shows a short notice** that asks for a
  `.devcontainer/devcontainer.json` file and for the command to be run again. The wizard that adds a configuration
  (F-0801) comes in a later release, and replaces the notice.
  - F-0301 6.2, AC-7 and AC-49 stay deferred (athena on #890, card containers-13 §1).

- **"show log" in the progress notification, and the log commands, open the Dev Containers log in the Output panel.**
  They do not open a terminal named "Dev Containers". The log terminal (F-0104) comes in a later release.
  - F-0408 AC-17 and F-0301 AC-53 describe the terminal and stay deferred (athena on #737, ruling 5 as amended).
