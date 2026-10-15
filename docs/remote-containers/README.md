# Dev Containers

Dev Containers opens a folder inside a container built from the folder's `devcontainer.json`. The editor's interface
stays on your machine; the files, terminals and extensions that need to run next to the code run in the container.

## Before you start

You need three things:

- **A supported editor.** VSCodium Insiders, on the 1.140 line this release is built for. The extension uses proposed
  editor APIs, which the editor enables for an extension only when you list it (see step 2).
- **Docker.** Docker Engine reachable by the `docker` command, with the daemon running and your user allowed to use it
  (on Linux, a member of the `docker` group). To use another program or path, set `dev.containers.dockerPath`.
- **A container the server can run in.** See [Requirements](../../packages/remote-containers/README.md#requirements) for
  the images that work.

## 1. Install the extension

Install **Dev Containers** from the VSIX file attached to the release:

- from a terminal: `codium-insiders --install-extension remote-containers-<version>.vsix`; or
- in the editor: open the Extensions view, choose **...** at the top of the view, then **Install from VSIX...**, and
  pick the file.

If another Dev Containers extension is enabled, this one steps aside and tells you so, because both use the same
commands, settings and remote connections. Disable one of the two and reload the window.

## 2. Let the editor enable the proposed APIs

Until you do, the editor starts without them and Dev Containers cannot open a window in a container. It shows a notice
that starts "Dev Containers needs proposed VS Code APIs that ... has not enabled for it".

1. Open the editor's runtime arguments file, `argv.json`: the notice's **Configure Runtime Arguments** button opens it,
   or open it yourself at `~/.vscodium-insiders/argv.json`.
2. Add the extension to its `enable-proposed-api` list, keeping any entries already there:

   ```json
   {
     "enable-proposed-api": ["remote-oss.remote-containers"]
   }
   ```

3. Quit the editor completely and start it again. The notice's **Quit** button does the quitting. Reloading a window is
   not enough: the editor reads `argv.json` only when it starts.

If a notice says that the previous attempt did not enable the proposed APIs, check that the list holds exactly
`remote-oss.remote-containers`, then restart again.

## 3. Open a folder in a container

Open a folder that has a `.devcontainer/devcontainer.json` (or a `.devcontainer.json`) and run **Dev Containers: Reopen
in Container** from the Command Palette, or choose **Reopen in Container** on the notification the editor shows for
such a folder. The window reloads and shows **Connecting to Dev Container** while it builds or starts the container,
installs the server in it and connects. The status bar then names the container.

## Where the editor server comes from

The window in the container is powered by a server that matches your editor build exactly. On the first connection your
machine downloads it, and the extension copies it into the container.
Where it is downloaded from, in this order:

1. **`remote.serverDownloadBaseUrl`**, when you set it in your user settings: a base address to which the path
   `/commit:{commit}/server-{platform}/{quality}` is added.
2. **The editor's own source**, when the editor names one for its server builds.
3. **A built-in source** for VSCodium and VSCodium Insiders.
4. Otherwise nothing is downloaded, and the connection stops with a dialog that tells you to set the base address.

The downloaded archive is kept on your machine, in the folder `remote.serverDownloadFolder` names (the system's temporary
folder when it is empty), so that the next container reuses it. In the container, the server is installed in the shared
Docker volume named `vscode`, which every dev container of the editor mounts, so it is installed once for all of them
and survives a rebuild. Set `dev.containers.cacheVolume` to off if you do not want that volume.

If the server carries a licence, you are asked to accept it before it is installed; **Cancel** ends the connection and
nothing is downloaded or started.

## When the dev container can't be set up

When a window cannot connect to its dev container, the editor shows a dialog instead of the window. The dialog has no
headline. Its detail says why, and it has three buttons.

### What the detail means

| Detail | What happened |
|---|---|
| A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running. | Docker refused a bind mount of the configuration: the format is wrong, or the source folder does not exist on the machine where the Docker daemon runs. |
| A port the container is setup to bind to is already in use. | A port in `appPort` or `forwardPorts` of the configuration is already taken on the machine where the Docker daemon runs. |
| An error occurred setting up the container. | The container could not be found, started or created for another reason. Open the log with **Dev Containers: Show Log** for the dev container CLI's own output. |
| The 'docker' command was not found. Make sure Docker is installed. | The `docker` program that `dev.containers.dockerPath` names could not be started. |
| Current user does not have permission to run 'docker'. Try adding the user to the 'docker' group. | Docker answered that your user may not use it. |
| Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed. | Docker answered with an error, usually because its daemon is not running. |

### What the buttons do

- **Retry** reloads the window and connects again.
- **Edit devcontainer.json Locally** reopens the folder on your machine in this window and opens its configuration
  file there.
- **More Actions...**, or pressing Escape, opens a list: **Reload Window**, **Edit devcontainer.json Locally**,
  **Open Recent...** and **Open Documentation**, which opens this page and shows the list again.

### Where the log is

Run **Dev Containers: Show Log** from the Command Palette. It holds the output of the dev container CLI and of each
step of the connect.
