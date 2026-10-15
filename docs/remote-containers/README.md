# Dev Containers

Dev Containers opens a folder inside a container built from the folder's `devcontainer.json`. The editor's interface
stays on your machine; the files, terminals and extensions that need to run next to the code run in the container.

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
