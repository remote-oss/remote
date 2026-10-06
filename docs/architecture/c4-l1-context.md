# C4 level 1: context

Status: first version, `remote-architect`, 2026-10-06, from the 229 catalogue rows, the two area dossiers and the
constraints list. Revised as spec revisions arrive (`tools/spec-watch`).

## The system

**The remote-oss family**: seven extensions published as `remote-oss.remote-<x>` that let a Code-OSS-based editor
open a workspace on another machine or in a container, with the editor's own server running there. Nothing of the
family runs as a service of ours: everything executes inside the user's editor, on the user's machines, with the
user's accounts.

## People

| Actor | What they do with the family |
|---|---|
| Developer | Opens folders on SSH hosts, in WSL distros, in dev containers and over tunnels; forwards ports; edits `ssh_config`; installs the pack |
| Container or host administrator | Provides the targets: an sshd, a Docker or Podman engine, a WSL distro, a tunnel host |
| Packager of an editor product | Ships a `product.json` that names server and tunnel artefacts, and may grant proposed API to our ids |

## External systems

| System | Role | Owner of the interface | Constraint |
|---|---|---|---|
| The editor (VS Code, VSCodium, any Code-OSS product) | Hosts the extensions; resolves remote authorities; shows the Remote Explorer, the indicator, the Ports view | Microsoft (OSS, MIT) `[oss]` | Proposed API `resolvers`, `contribViewsRemote`, `tunnels`, `extensionsAny`, `contribRemoteHelp`, `terminalDataWriteEvent` must be granted per extension id (F-1403, constraint 27–34) |
| `product.json` of the running editor | Names, folders, server URL template, gallery, URI scheme, `tunnelApplicationName` | The product | ADR-0006; genuine VS Code names no server URL, so the user must set one (F-1402, F-3902) |
| The editor's server (REH) archives | Downloaded to hosts and containers | The product's download location | R-47, R-68 licence gate for Microsoft-licensed archives |
| The editor's tunnel executable | Shipped in the editor's bin folder; the local relay of Remote - Tunnels and the host side of a tunnel | The product | ADR-0005 decision 2; never downloaded by the family (F-8902) |
| OpenSSH client (`ssh`, `scp`) on the user's machine | Every SSH connection, forward and remote command | OpenSSH; Windows ships its own | ADR-0004: never a JavaScript SSH implementation |
| SSH hosts (`sshd`, a login shell, `sh`/`bash`/PowerShell) | Where the server runs for Remote-SSH; also where a dev container may run | The developer's administrators | Bootstrap scripts are our text, shipped in the VSIX |
| Docker, Podman or another engine (CLI and socket) | Dev containers: images, containers, volumes, compose | The engine vendor | Reached through the dev container CLI and the engine's CLI |
| The dev container CLI (`@devcontainers/cli`) | Configuration, features, image build, create, start, lifecycle hooks | Open source, MIT, the containers.dev reference implementation | ADR-0005 decision 1, R-76 |
| WSL (`wsl.exe`, distros, `wslpath`) | Windows Subsystem for Linux targets | Microsoft | Area D; 16 specs still pending |
| Dev tunnels service | Tunnel registration and relay | Microsoft | Only through the shipped executable; the service's terms for non-Microsoft clients are an open question (F-8902 Q1) |
| GitHub and Microsoft accounts | Tunnel sign-in | Through `vscode.authentication` only | No client ids or secrets of ours (F-8902) |
| Open VSX (and the product's own gallery) | Distribution of the family; the server installs extensions from the product's gallery | Eclipse Foundation / the product | Constraint 39, 70; publishing ADR pending |
| Family companions | Each member talks to the others only through command ids with versioned plain-data payloads | Us (F-5902 §5, R-66) | No exports, no file watching |

## Boundaries that matter

- **The wall.** The design and the code know the specs, the conformance suites, VS Code OSS, the dev container
  CLI and public documentation; never the reference extensions' code or files (`AGENTS.md`).
- **The product boundary.** Every product-specific name, folder, URL and host list lives in one table (`lib-product`,
  ADR-0006); the rest of the code sees a profile.
- **The process boundary.** Transport is child processes (`ssh`, `scp`, the engine CLI, the dev container CLI,
  `wsl.exe`, the tunnel executable); our own remote-side code is two bootstrap scripts shipped as text.
- **The identity boundary.** Identifiers, strings and payload shapes are the reference's, verbatim (D-14, R-29);
  publisher, ids, icon, description and links are ours.
- **The conformance boundary.** The suite observes the UI and the targets' state from outside; the design exposes no
  test hooks and must make every acceptance criterion observable through strings, rows, dialogs, files and processes.
