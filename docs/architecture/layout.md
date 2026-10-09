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
│   └── lib-<name>/          shared libraries (candidates below)
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

   Rules 3 and 4 hold for every way of reaching another package: by name, by a relative path into its folder, by
   an alias in a manifest or a `tsconfig`, in code and in types. A package reaches another package only by its
   package name, declared as a `workspace:` dependency. Lint and `tools/check-layout` enforce this for source
   files and package manifests. They do not see every route through repository-wide configuration (the root
   manifest, `pnpm-workspace.yaml`, `tsconfig` files and what they extend, symbolic links), so a change to any of
   these is reviewed by the architecture lead.
5. **Each package keeps its own tests.** Unit tests live in the package. The package's conformance suite moves to
   `packages/<x>/tests/conformance/` when the specs and tests move here; until then CI fetches it from
   `remote-oss/remote-<x>`.
6. **Every package has a `README.md`** that names its maintainers, its features in words (extensions; the feature
   ids live in the traceability matrix, never in shipped prose, D-59) or the contract it offers (libraries), its
   allowed imports and its coverage exclusions. A README ships in the VSIX and is written in the product's voice; the maintainers' table (owner, components, allowed
imports, coverage exclusions) moves out of shipped READMEs before any publication (#108), into the package's
`MAINTAINERS.md` which `.vscodeignore` excludes.

## The acceptance package

`tests/acceptance` is a private workspace package that may import any extension or library; nothing imports it;
it never ships (ruled 2026-10-08, card tooling-04).

## Libraries

Confirmed by the container view (`c4-l2-containers.md` §1, 2026-10-06): `lib-log`, `lib-identifiers`,
`lib-standdown`, `lib-product`, `lib-authority`, `lib-companion`, `lib-host`, `lib-ssh`, `lib-server`,
`lib-forwarding`. A library exists only with at least two consumers; the import graph in the container view is the
one the lint enforces. Folders are created by the coding worker of the first package that needs them.
