# Remote Development, from the remote-oss project

This extension pack lets you open a folder inside a container, or on a remote machine over SSH, and keep working with
the full feature set of your editor. It installs the extensions below in one step.

Packs or extensions that name Microsoft's extension ids do not install or activate the family's extensions.

## The members

- [Dev Containers](https://github.com/remote-oss/remote/tree/main/packages/remote-containers#readme): work on a
  folder or a repository inside a container.
- [Remote - SSH](https://github.com/remote-oss/remote/tree/main/packages/remote-ssh#readme): work on a folder on a
  remote machine over SSH.

Remote Explorer, which the members depend on, and Remote - SSH: Editing Configuration Files, which comes with Remote -
SSH, arrive together with the members; this pack does not list them. Each member can also be installed on its own.

WSL: not part of this release.

Remote - Tunnels: not part of this release.

## Requirements

You need an editor of version 1.139.0 or later. What each member needs besides that, such as the supported remote
platforms, an SSH client or a container engine, is described in the member's own readme:

- [Dev Containers](https://github.com/remote-oss/remote/tree/main/packages/remote-containers#readme)
- [Remote - SSH](https://github.com/remote-oss/remote/tree/main/packages/remote-ssh#readme)

## Installation

Install the pack from the Extensions view of your editor, or from the page of the gallery you use. Installing it
installs the members of this release, Dev Containers and Remote - SSH, and Remote Explorer with them.

- Install this pack or Microsoft's Remote Development pack, not both. Running the two together is unsupported, and the
  family's extensions stand down next to Microsoft's.
- If the gallery does not have one of the members, the pack installs without it and says nothing. Install that member
  on its own once the gallery offers it.
- Uninstalling the pack also uninstalls the members it installed.

## Getting started

- [Get started with Dev Containers](https://github.com/remote-oss/remote/tree/main/packages/remote-containers#readme)
- [Get started with Remote - SSH](https://github.com/remote-oss/remote/tree/main/packages/remote-ssh#readme)

## Where the commands are

Each member's commands are in the Command Palette under the member's own category: "Dev Containers" and
"Remote-SSH". The remote indicator at the lower left of the status bar lists the common remote commands.

## Release notes

The [releases of the project](https://github.com/remote-oss/remote/releases) list what each version changes.

## Feedback

Report problems and ask questions on the [issues page of the project](https://github.com/remote-oss/remote/issues).
For a problem in one member, use that member's own place in the same repository, linked above. The source of this
pack is in
[its folder of the repository](https://github.com/remote-oss/remote/tree/main/packages/remote-extensionpack).

## Telemetry

Neither this pack nor its members collect or send telemetry.

## License

The pack is licensed under the MIT License; see the `LICENSE` file in the package.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | F-9001, F-9002, F-9101, F-9901 |
| Components | none |
| Allowed imports | none |
| Coverage exclusions | none |
