# Release 1 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **"Open Setting" in the dialog that says the server has no download source opens your user settings file at the
  setting**, not the Settings editor. Nothing is written to the file.
  - F-3902 AC-9, which the family shares, describes the Settings editor on the User tab. The Settings editor can't
    open in a window whose remote authority did not resolve (measured on VS Code 1.139.1 and VSCodium); the settings
    file opens there (athena on #737; spec question on remote-oss/remote-ssh#79).

- **A Feature named in `features` and again in `dev.containers.defaultFeatures`, differing only in letter case, is installed once, with the configuration's options.**
  - F-0414 AC-28 and BR-14 have `features` win on the same id; the dev container CLI merges the two lists by their ids'
    text, so it would install both and let the defaults' options apply last. The extension leaves out of
    `--additional-features` every default whose id equals a key of `features` ignoring case (athena on #1204;
    remote-oss/remote-containers#59, card containers-93).

- **Reopen in Container checks Docker and reads the configuration before the window reloads.** When that takes longer
  than half a second, a "Reading Dev Container Configuration" notification shows meanwhile, with Cancel.
  - F-0401 5.0 step 2 has the reload "within about 1 s"; the dev container CLI's read of the configuration can't
    promise that (ruling (c) on #929, card containers-24). The notification is F-0408's S283, with its Cancel (athena on
    2026-11-01, card containers-114).

- **Switching the dev container's `remoteUser` to another account and reloading the window connects** as that
  account, in the same container, with no rebuild. Files the new account creates in a bind mount keep its own
  user and group ids, because the ids were synchronized for the previous account. Rebuild the container to
  synchronize them again.
  - F-0416 7.E4 and AC-35 describe a failed connect instead (ruling 16 on #737; spec question on
    remote-oss/remote-containers#63).

- **A port the configuration publishes with `appPort` shows no running process, and the status item lists the published
  ports in the order of `appPort`.** The row's Running Process stays empty and its icon is the one without a process,
  even while something listens on the port. The status item reads `Forwarded Ports: <first>, <second>`, in the order
  the configuration lists them.
  - F-1101 AC-40 describes the process, the icon with a process and the ports in the order `<container port>, <number>`.
    Core 1.139.1 takes a static row's process only when the authority resolves, and later processes update only the
    forwarded rows; the order is the one our resolver gives (athena on #1334; spec question on
    remote-oss/remote-containers#42).

- **A dev container whose setup failed is stopped about ten seconds after the failure dialog**, unless its
  `shutdownAction` is `none`; it is not left running. The dialog stays, and Retry or a reload starts the container
  again.
  - F-0415 AC-18b has the container keep running after the failure; F-0417 BR-5 stops a container whose window's
    connection ended, and a failed connect ends it (athena's ruling on #1331; spec question on
    remote-oss/remote-containers#32).

- **Open in Container in New Window on the row of a folder the profile does not trust shows core's trust question in the
  new window while that window is already on the container's authority**, not on the local folder. Trusting connects
  the window to the same container, which stays stopped until then; declining shows the notice that the folder is not
  trusted and leaves the window on the local folder, the container still stopped.
  - F-0902 AC-49 has the new window open on the local folder when the question shows. The extension asks it inside the
    new window's resolve, after the window has switched (athena on #1464, ruling-1464; spec question on
    remote-oss/remote-containers#80).

- **A download that fails leaves no partial archive, and a window closed during the install leaves no half-installed
  directory.** The download folder and the `vscode` volume are as they were before the attempt.
  - F-0503 AC-21 and AC-23 describe a `vscode-server-{platform}.tar.gz_{epoch-ms}` file per failed attempt and a
    `{commit}_{epoch-ms}` directory on the volume, both left behind (athena on #1591: `ruling-1591-no-partials`; spec
    question on remote-oss/remote-containers#34).
## Interim behaviour

- **Editing the dev container configuration shows no rebuild prompt.** Reload the window, or run "Rebuild
  Container", to use the edit. The notification that offers the rebuild (F-0303) comes in a later release.
  - F-0416 AC-25, AC-31, AC-34 and AC-35 answer that notification with "Ignore", and their rows reload instead
    (ruling 15 on #737).

- **"show log" in the progress notification, and the log commands, open the Dev Containers log in the Output panel.**
  They do not open a terminal named "Dev Containers". The log terminal (F-0104) comes in a later release.
  - F-0408 AC-17 and F-0301 AC-53 describe the terminal and stay deferred (athena on #737, ruling 5 as amended).
