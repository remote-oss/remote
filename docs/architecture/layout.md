# Repository layout (proposal)

Status: proposal by `remote-architect`, 2026-10-05. The extension folders follow decisions already made (D-10, D-48).
The library list is a set of candidates from the architecture brief; it is confirmed or changed by the container
view (C4 L2), which needs the Remote-SSH first pass. Library folders are created only then.

```
remote/
├── AGENTS.md  CLAUDE.md  README.md  LICENSE
├── docs/
│   ├── architecture/        design documents (see README.md there)
│   └── adr/                 decision records, NNNN-title.md
├── packages/
│   ├── remote-containers/   extension  remote-oss.remote-containers
│   ├── remote-ssh/          extension  remote-oss.remote-ssh
│   ├── remote-ssh-edit/     extension  remote-oss.remote-ssh-edit
│   ├── remote-explorer/     extension  remote-oss.remote-explorer
│   ├── remote-wsl/          extension  remote-oss.remote-wsl
│   ├── remote-server/       extension  remote-oss.remote-server
│   ├── remote-extensionpack/ extension remote-oss.vscode-remote-extensionpack
│   ├── lib-<name>/          shared libraries (candidates below)
│   ├── tunnel-agent/        service    the tunnel host agent (ADR-0016)
│   └── tunnel-relay/        service    the tunnel relay (ADR-0015)
├── tests/
│   └── conformance/
│       └── runner/          one copy of the runner (see tests/conformance/README.md)
├── tools/                   repository tools
└── .github/workflows/       CI
```

## Rules

1. **Folder name = repo name = the `<x>` of the extension id.** The pack is the one exception in its id
   (`vscode-remote-extensionpack`); its folder keeps the repo name.
2. **Extensions and libraries sit side by side in `packages/`.** A library folder starts with `lib-`. Libraries are
   internal: they are bundled into each extension's VSIX and are not published on their own.
3. **An extension never imports another extension.** Extensions talk to each other only through the interfaces the
   specs define (commands, the companion interface of R-66, exported extension APIs). Shared code goes in a library.
4. **A library never imports an extension**, and the library graph has no cycles.
5. **A service is a third kind**, named in `SERVICE_FOLDERS` (`tools/repository.ts`): a workspace package that runs on
   its own, outside the editor, with no extension manifest, publisher or engine floor. `tunnel-relay` (ADR-0015;
   ruling-3062-service-kind) and `tunnel-agent` (ADR-0016) are the two. A service imports libraries by package name
   and is imported by nothing. The extensions' network rule (contracts §5: an extension's HTTP goes through the
   editor's `fetch`) binds code that runs in the extension host, so it leaves a service out.

   Rules 3 and 4 hold for every way of reaching another package: by name, by a relative path into its folder, by
   an alias in a manifest or a `tsconfig`, in code and in types. A package reaches another package only by its
   package name, declared as a `workspace:` dependency. Lint and `tools/check-layout` enforce this for source
   files and package manifests. They do not see every route through repository-wide configuration (the root
   manifest, `pnpm-workspace.yaml`, `tsconfig` files and what they extend, symbolic links), so a change to any of
   these is reviewed by the architecture lead.
6. **Each package keeps its own tests.** Unit tests live in the package. The package's conformance suite moves to
   `packages/<x>/tests/conformance/` when the specs and tests move here; until then CI fetches it from
   `remote-oss/remote-<x>`.
7. **Every package has a `README.md`** that names its maintainers, its features in words (extensions; the feature
   ids live in the traceability matrix, never in shipped prose, D-59) or the contract it offers (libraries), its
   allowed imports and its coverage exclusions. A README ships in the VSIX and is written in the product's voice; the maintainers' table (owner, components, allowed
imports, coverage exclusions) moves out of shipped READMEs before any publication (#108), into the package's
`MAINTAINERS.md` which `.vscodeignore` excludes.

## The acceptance package

`tests/acceptance` is a private workspace package that may import any extension or library; nothing imports it;
it never ships (ruled 2026-10-08, card tooling-04).

## The tunnels conformance package

`tests/tunnels-conformance` is a private workspace package for the tunnels conformance run (#3076,
`ruling-3076-conformance-package`). It tests the relay over the wire, so:
- it depends on npm packages only, through the lockfile: the dev tunnels SDK at the family's 1.3.50 / 3.12.29 pin;
- it imports no workspace package, and nothing imports it;
- it never ships.

Its `pnpm deploy` is the Node stage of the run's client image. `tools/check-workspace.ts` enforces all of this, and the
tools' unit rows may import its modules.

## Libraries

Confirmed by the container view (`c4-l2-containers.md` §1, 2026-10-06): `lib-log`, `lib-identifiers`,
`lib-standdown`, `lib-product`, `lib-authority`, `lib-companion`, `lib-host`, `lib-ssh`, `lib-server`, `lib-wsl` (no milestone; cards wsl-00..06, 2026-10-09),
`lib-forwarding`, `lib-state` (card #3100, `ruling-3099-lib-state`: the event files of the folder history and of the session hints, and the reload handoffs). A library exists only with at least two consumers; the import graph in the container view is the
one the lint enforces. Folders are created by the coding worker of the first package that needs them.
