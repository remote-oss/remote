# lib-companion

The plain-data messages that Remote Explorer and the extensions that serve it exchange: the version envelope,
the payload shapes, and the rules that read them.

It also says which family companions are present, across extension hosts where the editor allows it, and holds the
interface document, `docs/companion-interface.md`. For tests, under `src/testing/` (never imported by a bundle):
`lib-companion/testing/recording-fake`, a command bus that plays any side of the interface, records every call, and can
answer, reject, stay silent, or answer with a foreign or newer-major payload.

It is bundled into the packages that use it and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-companion` (`src/index.ts`), `lib-companion/testing/recording-fake` |
| Allowed imports | `vscode` types in `src/editor-adapter.ts` only (the adapter takes the API as a parameter); no extension, no library |
| Coverage exclusions | none |
| Editor declarations | `vscode-dts/` holds the editor's declaration file for the `extensionsAny` proposal, copied unchanged from lib-authority's, so that the two-argument `extensions.getExtension` compiles. It isn't linted or formatted. |
