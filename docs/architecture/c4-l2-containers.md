# C4 level 2: containers (packages) and the shared-library split

Status: first version, `remote-architect`, 2026-10-06. Inputs: the catalogue (229 rows), the area A and B dossiers
and contracts, `catalogue/constraints.md`. This is the view the component views (L3) and the first coding briefs
are built on; it changes only by a commit that names the rows or rulings that forced the change.

## 1. Packages

Seven extension packages and ten shared libraries, all under `packages/` (layout rules in `layout.md`).

### Extensions

| Package | Extension id | Authorities | Features (published) | Notes |
|---|---|---|---|---|
| `remote-containers` | `remote-oss.remote-containers` | `dev-container`, `attached-container`, `k8s-container`, `apple-container`, `exec` | 94 + 6 decisions | The largest; the engine side is area C around the dev container CLI |
| `remote-ssh` | `remote-oss.remote-ssh` | `ssh-remote` | 67 + 8 decisions | Transport (area A) plus windows and companion endpoints (area B) |
| `remote-ssh-edit` | `remote-oss.remote-ssh-edit` | none | 9 + 2 | Declarative language plus one completion provider; the first conformance target (744 cases) |
| `remote-explorer` | `remote-oss.remote-explorer` | none | 9 + 2 | The hub view `remoteTargets`; the companion protocol's server |
| `remote-wsl` | `remote-oss.remote-wsl` | `wsl` | 12 + 1 published, 16 pending | Area D waits for the drafts; its window side is B, its server side reuses A |
| `remote-server` | `remote-oss.remote-server` | `tunnel` | 11 + 2 | Remote - Tunnels; the relay is the editor's shipped tunnel executable |
| `remote-extensionpack` | `remote-oss.vscode-remote-extensionpack` | none | 5 + 1 | Code-less manifest (R-62) |

### Libraries

A library exists only when at least two packages need the same behaviour; everything else stays in its package until
`jscpd` or a second consumer says otherwise. Libraries are bundled into each extension and never published.

| Library | Responsibility | Consumers | Depends on |
|---|---|---|---|
| `lib-identifiers` | Per-extension tables of the D-14 identifiers and the R-27 invented ones, generated from each manifest; command registration with the out-of-context guard (R-46); setting reads with legacy-key precedence; the string tables that conformance addresses | all seven (the pack: generation only) | none |
| `lib-standdown` | The R-54 check at activation; the one warning; the "standing down" context key (polarity per ADR draft: entries visible by default) | all except the pack and ssh-edit | `lib-identifiers` |
| `lib-log` | A logger passed in, never global; a channel created lazily only where a spec has one; `logOncePerSession`; a redaction rule libraries cannot bypass; levels per package setting; what may never be logged (prompt answers, tokens, event payloads; F-3905) | containers, ssh, wsl, server | none |
| `lib-product` | The product profile read once from `product.json`; archive URL resolution (override, product template, built-in table, dialog); the only file where product names, hosts and prefixes appear | containers, ssh, wsl, server | none (diagnostics are returned as values) |
| `lib-authority` | Resolver host over `registerRemoteAuthorityResolver`; one authority codec per family; window opener (current/new window, folder/workspace/empty, reload, close remote); the proposed-API gate and its one family-wide setup notification; label formatters (the workspace-trust gate moved to the containers engine, F-0106, its only consumer) | containers, ssh, wsl, server, explorer (opener and gate) | `lib-identifiers`, `lib-standdown`, `lib-log` |
| `lib-companion` | The F-5902 §5 protocol: versioned plain-data payloads, 10 s caller timeout, foreign-payload rule, companion detection across hosts (`extensionsAny` with silent fallback); the one copy of the companion interface document; a recording fake as a test fixture | explorer, ssh, wsl, server | `lib-identifiers`, `lib-log` |
| `lib-host` | The host channel: `runScript`, `copyToHost`, `identity`, `platformHint`, with the failure kinds `lib-server` maps; no implementation of its own | ssh (over `lib-ssh`), containers (over `docker exec`), wsl (over `wsl.exe`), `lib-server` | none |
| `lib-ssh` | `ssh`/`scp` discovery and checks; argument building and spawning; the local connection server (one `ssh` per host string across windows); prompt relay and the hidden login terminal; the `ssh_config` model (files in effect, host list, `ssh -G`, Host-block writer); stderr classification into failure kinds and hints; the host-channel implementation over `ssh` | ssh; containers for its over-SSH hop (F-1302, placement open); ssh-edit does not use it | `lib-host`, `lib-identifiers`, `lib-log` |
| `lib-server` | Host bootstrap (POSIX `sh` and PowerShell scripts shipped as text); server download (host-first, client fallback), install, locks, commit rewrite, licence gate (R-68, one rule pending K5), caches (R-58); server start, reuse, socket mode, kill, uninstall, lifetime; default extensions handed to a starting server | ssh, wsl, containers (install into a container, F-0503/F-0419/F-0505) | `lib-host`, `lib-product`, `lib-log` |
| `lib-wsl` | The `wsl.exe` runner, distro inventory, path mapper and the WSL host-channel implementation (added 2026-10-06, area D dossier) | wsl; containers for Docker-in-WSL (F-0204, F-0207, F-1301) | `lib-host`, `lib-log` |
| `lib-forwarding` | The window tunnel to the server (local port range search, relay or socket); the resolver's tunnel factory; default and static forwards (`tunnels` proposal); port attributes | ssh, wsl, containers, server | `lib-log` |

Not a library, by the two-consumer rule: the tunnel client (service calls through the shipped executable, sign-in
through `vscode.authentication`, the tunnel picker) lives in `remote-server`; the containers engine (dev container
CLI bridge, engine CLI, volumes, features, compose, recovery) lives in `remote-containers`; the ssh_config language
and completion live in `remote-ssh-edit`. Dialog and progress helpers stay in their packages until duplication shows.

### Import graph

```
remote-extensionpack  ->  (nothing)
remote-ssh-edit       ->  lib-identifiers   (no log by F-4002 AC-14; no stand-down by F-4901 §6)
remote-explorer       ->  lib-identifiers, lib-standdown, lib-companion, lib-authority (gate only)   (no log by F-5901 §6; no product use)
remote-server         ->  lib-identifiers, lib-standdown, lib-authority, lib-product, lib-forwarding, lib-companion, lib-log
remote-ssh            ->  lib-identifiers, lib-standdown, lib-authority, lib-product, lib-host, lib-ssh, lib-server, lib-forwarding, lib-companion, lib-log
remote-wsl            ->  lib-identifiers, lib-standdown, lib-authority, lib-product, lib-host, lib-wsl, lib-server, lib-forwarding, lib-companion, lib-log
remote-containers     ->  lib-identifiers, lib-standdown, lib-authority, lib-product, lib-host, lib-wsl, lib-server, lib-forwarding, lib-companion, lib-log  (+ lib-ssh if F-1302 lands the hop here)

lib-ssh -> lib-host, lib-identifiers, lib-log        lib-server -> lib-host, lib-product, lib-log
lib-authority -> lib-identifiers, lib-standdown, lib-log       lib-companion -> lib-identifiers, lib-log
lib-standdown -> lib-identifiers           lib-product -> (nothing)       lib-forwarding -> lib-log
lib-host -> (nothing)       lib-identifiers -> (nothing)       lib-log -> (nothing)       lib-wsl -> lib-host, lib-log
```

No cycles; `lib-log`, `lib-identifiers`, `lib-host` and `lib-product` are the roots (neither identifiers nor stand-down logs anything under the specs: the warning and the R-46 line are UI, 2026-10-06). The lint of ADR-0002 enforces the edges once the packages exist.

## 2. Server-side pieces

Our only code that runs on a remote side is text shipped in the VSIX: the POSIX bootstrap script and the PowerShell
bootstrap script of `lib-server`, run through the host channel, plus two WSL scripts of `lib-wsl` (the stream relay
run by the server's Node, and the `code` shim for a distro). Everything else on the remote side is the product's
own server, its tunnel executable, or the dev container CLI's work inside the engine. There is no agent, daemon or
service of ours on any host.

## 3. The web question

Explorer and server must ship a browser entry point as well as the Node one (constraints A6, F-5901, F-8901), and
server's `webOpener` needs a browser build. ADR-0002's open item is therefore answered "yes, for two packages";
the browser bundle of each excludes `lib-ssh`, `lib-host`, `lib-server` and `lib-forwarding` by construction.

## 4. Areas, owners and the order of component views

| Area | Owner | Packages and libraries | Rows | State |
|---|---|---|---|---|
| A transport and server lifecycle | `remote-architect-worker-1` | `lib-host`, `lib-ssh`, `lib-server`, `lib-forwarding`, `lib-product`, the A part of `remote-ssh`, the tunnel client of `remote-server` | 73 | dossier and draft contracts merged |
| B resolvers, windows, explorer, companions | `remote-architect-worker-2` | `lib-identifiers`, `lib-standdown`, `lib-authority`, `lib-companion`, `remote-explorer`, `remote-ssh-edit`, `remote-extensionpack`, the B parts of `remote-ssh`, `remote-server`, `remote-containers`, `remote-wsl` | 57 | dossier, draft contracts and two ADR drafts merged |
| C containers engine | `remote-architect-worker-3` | the engine side of `remote-containers`: dev container CLI bridge, engine CLI, volumes, features, compose, recovery, attach, Kubernetes, Remote Explorer data | 85 | catalogue rows only |
| D WSL | `remote-architect-worker-4` | `lib-wsl`, the engine side of `remote-wsl`, the WSL server install and start over `lib-server` (A contributes) | 25 published + 4 pending | dossier merged |
| lead | `remote-architect` | `lib-log`, the traceability matrix, the build order, ADRs | — | this document |

## 5. Decisions this view takes (each a line in the ADR list or a revision already on main)

1. The host channel is a library of its own (`lib-host`) so that `lib-ssh` and `lib-server` do not depend on each
   other; three implementations (ssh, docker exec, wsl) live with their transports.
2. The editor CLI is Tunnels-only and never downloaded (ADR-0005/0006 revised 2026-10-06).
3. Stand-down polarity: entries visible by default, hidden by a "standing down" key (area B's ADR draft).
4. One family-wide proposed-API setup notification (area B's contract), pending the containers room's answer on F-1403.
5. A feature has one owning component and may list contributors; the matrix carries both columns.
6. `engines.vscode` floor 1.139 (ADR-0007, to write).

## 6. Rulings applied after the first version (2026-10-06)

R-77: R-54 extends to remote-explorer and remote-ssh-edit with the standing-down key (area B option A); ssh-edit
gains `lib-standdown` once F-4002/F-4901 are revised (a follow-up brief, PR #21 stands). R-78: no mid-session
re-check; the next activation decides. R-79: the hang rule is one family adaptation (bound wait, then F-2601's
dialog). R-80: the source-based licence rule alone binds the shared gate (`lib-product`'s table, one active entry).
R-81: the R-27 lint checks against published identifier inventories. R-82: provenance pointers move below the wall.
R-83: every room's spec starts servers with telemetry off. D-55 (Tunnels) pending; the OpenSSH-over-WebSocket spike
runs as investigation; Tunnels last in the build order. D-59/R-85: ADR-0008.

## 7. Open at this level

- F-1302 (containers over an SSH host): where the hop and the download run; decides whether `remote-containers`
  imports `lib-ssh`.
- The WSL package's split between B and D waits for the drafts.
- Publication and packaging (Open VSX only per F-9901/F-3904; pre-release scheme) need their ADR.
