# ADR-0006: The running editor's product.json drives server and CLI resolution

- Status: accepted (the user's constraint, 2026-10-05: "VSCodium won't be our only editor, so we have to expect
  that the editor configures the URL patterns for the REH and CLI binaries"; the resolution orders below are the
  lead's design under R-47 and the user may change them)
- Date: 2026-10-05
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
   `updateUrl`, `downloadUrl`, `urlProtocol`, the gallery, the licence fields, and the two templates below. Every
   resolver and the Tunnels extension take their names, folders, URLs and scheme from the profile; none of them
   reads `product.json` itself or knows a product by name.
2. **Server (REH) archive URL**, R-47 rule 4 unchanged: (a) a user-set override setting; (b) the product's
   `serverDownloadUrlTemplate`; (c) the built-in table for products that declare none, keyed by `applicationName`
   (VS Code and VS Code Insiders through the explicit Microsoft URL behind the R-68 gate; `codium`,
   `codium-insiders`); (d) the no-default dialog. Placeholders in every template: `${os}`, `${arch}`, `${commit}`,
   `${quality}`, `${version}`, `${release}` (the specs' name for the product's release tag, F-3902 rule 3 and
   F-1402) and `${applicationName}`. An unknown placeholder or an unexpandable template is never an empty string:
   in the product's template it is logged and resolution falls through to the next source (F-3902 rule 3); in the
   user's override setting it is the dialog. (Revised 2026-10-06 from the area A dossier.)
3. **CLI archive URL**, same shape: (a) a user-set override setting; (b) the product's `cliDownloadUrlTemplate`, a
   field we define and document so that any product can declare it next to `serverDownloadUrlTemplate` (proposed
   to VSCodium as a one-line addition to its patch); (c) the built-in table, which for a product that only
   declares `updateUrl` + `commit` + `quality` uses the OSS CLI's own shape
   `${updateUrl}/commit:${commit}/cli-${os}-${arch}/${quality}` (Microsoft-licensed on genuine VS Code, R-68 gate),
   and for VSCodium its release assets; (d) the no-default dialog.
4. **Remote-side names follow the profile**: the server runs as `serverApplicationName` in `~/<serverDataFolderName>/`
   keyed by `commit`; the CLI runs as `tunnelApplicationName`; caches are per product (R-58); the editor's URI scheme
   is `urlProtocol` (R-32); the gallery is the product's own (R-47 rule 3). Two products never share state on a
   remote.
5. **Settings for the overrides** follow D-14 where the reference has them and R-27 where they are invented. The
   specs give each extension its own override policy (Dev Containers: `remote.serverDownloadBaseUrl`, any settings
   layer, a base URL or a template, F-1402; Remote-SSH: `remote.SSH.serverDownloadUrlTemplate`, user layer only,
   F-3902), so `lib-product` takes a per-extension override policy (key, allowed layers, accepted forms) from one
   table and applies the same resolution order to all. (Revised 2026-10-06.)
6. **Conformance**: the suite's profiles include at least two real products (genuine VS Code with the explicit
   server URL; VSCodium) and one synthetic `product.json` with made-up names and both templates, so a build that
   hard-codes any product fails a case.

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
- A VSCodium contribution (declaring `cliDownloadUrlTemplate`) is a public action and goes through the register
  before it is filed.
- Open until the specs are read: the exact override setting names and their reference counterparts, and whether
  the Dev Containers decisions (F-1402) need a wording update for the CLI.

## Check

Lint: the strings `codium`, `vscodium`, `code.visualstudio.com`, `vscode-server`, `.vscode-server` and
`update.code.visualstudio.com` may appear only in `lib-product`'s table file and its tests (a `no-restricted-syntax`
literal check or a grep in `tools/check-layout`). Conformance: the synthetic-product profile passes.
