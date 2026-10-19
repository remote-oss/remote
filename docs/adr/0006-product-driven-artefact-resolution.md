# ADR-0006: The running editor's product.json drives server and CLI resolution

- Status: accepted (the user's constraint, 2026-10-05: "VSCodium won't be our only editor, so we have to expect
  that the editor configures the URL patterns for the REH and CLI binaries"; the resolution orders below are the
  lead's design under R-47 and the user may change them)
- Date: 2026-10-05 (decision 7 added 2026-10-16)
- Deciders: the user; design by `remote-architect`
- Scope: every package that downloads, installs or starts a server (REH) or the editor CLI on a remote side:
  Remote-SSH, WSL, Dev Containers, Remote - Tunnels, and the shared server-lifecycle library
- Requirements: R-47 (server distribution follows product.json; resolution order rule 4; extended to the CLI
  archive), R-68 (licence gate), R-58 (cache per product), R-32 (URI scheme per editor), ADR-0005 (the editor CLI as
  launcher)

## Context

The extensions run in any Code-OSS-based editor: VS Code, VSCodium, and products we do not know by name. Each
product builds its own remote extension host archive ("REH", the server) and its own CLI binary, publishes them
under its own URL pattern, and names its own server binary, data folder and tunnel binary. Nothing about these may
be hard-coded for one product. The editor already states most of it in `product.json`, which sits in the
application root and is readable by an extension (`vscode.env.appRoot` + `product.json`) [oss]
`src/bootstrap-meta.ts`, `src/vs/platform/environment/node/environmentService.ts`.

Facts checked in VS Code OSS and the VSCodium build on 2026-10-05 ([oss] `src/vs/base/common/product.ts`,
`cli/build.rs`, `cli/src/constants.rs`, `cli/src/update_service.rs`; VSCodium `prepare_vscode.sh`,
`patches/00-remote-add-url.patch`, `patches/40-cli-use-reh-archive.patch`, `build_cli.sh`):

- `product.json` declares `quality`, `commit`, `applicationName`, `dataFolderName`, `serverApplicationName`,
  `serverDataFolderName`, `tunnelApplicationName`, `tunnelApplicationConfig`, `updateUrl`, `downloadUrl`,
  `urlProtocol`, `extensionsGallery`, `serverLicense*`.
- `serverDownloadUrlTemplate` is not a Code-OSS field; VSCodium adds it for the remote extensions, with the
  placeholders `${os}` and `${arch}` (its value points at its GitHub release assets `<app>-reh-${os}-${arch}-<version>.tar.gz`).
- No product declares a CLI download template. The OSS CLI derives its own download from `updateUrl`, `commit` and
  `quality` (`{updateUrl}/commit:{commit}/cli-{os}-{arch}/{quality}`); VSCodium's build replaces that with its
  release assets (`<app>-cli-<os>-<arch>-<version>.tar.gz`) through build-time environment, not through `product.json`.
- The CLI bakes every string field of `product.json` in at build time, so a product's CLI already knows its own
  names and endpoints.

## Decision

1. **One product profile, read once per session from the running editor's `product.json`**, in a shared library
   (`lib-product`, the only place a product name may appear in code). It carries: `applicationName`, `quality`,
   `commit`, `version`, `serverApplicationName`, `serverDataFolderName`, `dataFolderName`, `tunnelApplicationName`,
   `updateUrl`, `downloadUrl`, `urlProtocol`, the gallery, the licence fields, the two templates below and
   `serverDownloadRedirectHosts` (decision 7). Every resolver and the Tunnels extension take their names, folders, URLs and scheme from the profile; none of them
   reads `product.json` itself or knows a product by name.
2. **Server (REH) archive URL**, R-47 rule 4 unchanged: (a) the extension's user-override setting (F-1402,
   F-3902); (b) the product's `serverDownloadUrlTemplate`; (c) the built-in table for products that declare none,
   keyed by exact `applicationName` (`codium`, `codium-insiders`; genuine VS Code and VS Code Insiders have NO
   entry: Microsoft's artefacts are reached only through a URL the user sets, F-1402 rule 4, F-3902 rule 1); (d)
   the no-default dialog. Placeholders in every template: `${os}`, `${arch}`, `${commit}`, `${quality}`,
   `${version}`, `${release}` (the product's release tag, empty when the product has none; F-3902 rule 3, F-1402)
   and, where a spec allows it, `${applicationName}`; containers also keeps the reference's base-URL form (F-1402).
   An unknown placeholder or an unexpandable template is never an empty string: in the product's template it is
   logged and resolution falls through to the next source (F-3902 rule 3); in the user's setting it is the dialog.
   (Revised 2026-10-06 from the area A dossier and the constraints list, items A1 and A2.)
3. **The editor CLI is not downloaded by the family** (until D-76's patch ships: then a `cliDownloadUrlTemplate`
   field with the same placeholders, resolved in the same order as the server template, returns; recorded in
   ADR-0005 decision 2a). Withdrawn 2026-10-06: Remote-SSH never uses the CLI
   (F-3902 rule 5, constraint 43); Remote - Tunnels downloads nothing on the client and uses the tunnel executable
   the editor ships in its own bin folder, named by `tunnelApplicationName` (F-8902 rule 4, constraint 44); the host
   side of a tunnel is the editor's own. So there is no `cliDownloadUrlTemplate`, no CLI table and no CLI dialog.
   The profile still carries `tunnelApplicationName` for Tunnels to locate the shipped executable.
4. **Caches are keyed by product as well as commit** (added 2026-10-06 from the WSL dossier): VS Code and VSCodium
   share commit ids, so a client-side archive cache keyed by commit alone would hand one product's server to the
   other; the key is `applicationName` plus commit for every product except genuine VS Code, which keeps the
   reference layout (R-58).
5. **Remote-side names follow the profile**: the server runs as `serverApplicationName` in `~/<serverDataFolderName>/`
   keyed by `commit`; the CLI runs as `tunnelApplicationName`; caches are per product (R-58); the editor's URI scheme
   is `urlProtocol` (R-32); the gallery is the product's own (R-47 rule 3). Two products never share state on a
   remote.
6. **Settings for the overrides** follow D-14 where the reference has them and R-27 where they are invented. The
   specs give each extension its own override policy (Dev Containers: `remote.serverDownloadBaseUrl`, any settings
   layer, a base URL or a template, F-1402; Remote-SSH: `remote.SSH.serverDownloadUrlTemplate`, user layer only,
   F-3902), so `lib-product` takes a per-extension override policy (key, allowed layers, accepted forms) from one
   table and applies the same resolution order to all. (Revised 2026-10-06.)
7. **Redirects follow the source's step** (added 2026-10-16, #1031). A server download may end on another host
   only when whoever chose the source allows it. The user's override may redirect to any host: the user chose and
   trusts that source. A product's template may redirect to its own host, the hosts its `product.json` lists in
   `serverDownloadRedirectHosts` (an array of host names, our invented field; a product that serves its archives
   from a CDN declares the CDN there, as it declares the template), and the hosts the table lists for the
   template's host. A built-in table source may redirect only to the hosts the table lists. No setting widens
   this, and no prompt asks. No step allows a weaker scheme. The licence classification stays tied to the
   template's host (R-80). The rule is in `lib-product` and applies to every extension through `lib-server`
   (contracts §5 V4). When `cliDownloadUrlTemplate` returns (decision 3), it uses the same field.
8. **Conformance**: the suite's profiles include at least two real products (genuine VS Code with the explicit
   server URL; VSCodium) and one synthetic `product.json` with made-up names and both templates, so a build that
   hard-codes any product fails a case.

## Facts from the VSCodium CLI patch (D-76, 2026-10-08, for the later revision)

`cliDownloadUrlTemplate` exists next to `serverDownloadUrlTemplate` with the same shape; VSCodium bakes the release
into both, so only `${os}` and `${arch}` remain; `${release}` resolves from `version` (no `release` field). The CLI
honours `VSCODE_CLI_SERVER_DOWNLOAD_URL_TEMPLATE`, `VSCODE_CLI_COMMIT` and `VSCODE_CLI_QUALITY` at run time (set
together whenever the CLI might not match the client; templates pre-expanded except os/arch), never falls back to a
feed, and installs under `--cli-data-dir ~/<serverDataFolderName>/cli` → `cli/servers/<Quality>-<commit>/server/`;
the CLI archive contains one file named `<applicationName>`; alpine x64/arm64, linux armhf, and (2026-10-09) linux ppc64le and s390x builds exist, so `${arch}` of the CLI template also takes `ppc64le` and `s390x` with os `linux`; the only server platforms without a CLI are riscv64 and loong64 (the family's first-slice policy then says: no CLI path for those two, the script path serves them); errors come
back in the serve reply (`StatusError` with url and status; `WrappedError` for templates), no separate stderr line;
no licence prompt, no device flow, no telemetry during an install. Only the patch's two messages are stable (`cannot expand ${name} for commit <sha> …`, `the download is not
commit <sha>`); the upstream `StatusError`/`WrappedError` text is a Debug dump, so the extension matches `url:`,
`status_code:`, `cannot expand` and `the download is not commit` loosely and shows the whole message as the fallback.

## Options considered

| Option | For | Against |
|---|---|---|
| Product profile from `product.json` with override, template, table, dialog (chosen) | Works for products we do not know; one place to test; matches how the editor's own CLI is built | Products without templates still need the table or the dialog until they add the fields |
| Known-product table only | Simple | Fails for every new product; the user rules it out |
| Ask the user for URLs on first use | No table | Unusable at scale; keeps the dialog as the last resort only |
| Our own download service | Full control | Money, infrastructure, licence exposure; out of scope |

## Consequences

- `lib-product` joins the library candidates (ADR-0002 layout); `lib-server` and the Tunnels design build on it.
- The built-in table is a list of exceptions that should shrink: each entry names the product and the reason it
  cannot declare its templates yet.
- Open until the specs are read: the exact override setting names and their reference counterparts, and whether
  the Dev Containers decisions (F-1402) need a wording update for the CLI.

## Check

Lint: the strings `codium`, `vscodium`, `code.visualstudio.com`, `vscode-server`, `.vscode-server` and
`update.code.visualstudio.com` may appear only in `lib-product`'s table file and its tests (a `no-restricted-syntax`
literal check or a grep in `tools/check-layout`). That table therefore also holds the licence-host list of F-3902
rule 11, the VSCodium release prefixes, the dev tunnels service domain (constraint A7) and the allowed redirect
hosts per source host (github.com → its release-asset hosts; 2026-10-08; a product's own list comes from its
`product.json`, decision 7). Conformance: the synthetic-product profile passes.
