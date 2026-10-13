# lib-companion

The plain-data messages that Remote Explorer and the extensions that serve it exchange: the version envelope,
the payload shapes, and the rules that read them.

It is bundled into the packages that use it and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-companion` (`src/index.ts`) |
| Allowed imports | `vscode` types in `src/editor-adapter.ts` only (the adapter takes the API as a parameter); no extension, no library |
| Coverage exclusions | none |
