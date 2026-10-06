# lib-identifiers

Library `lib-identifiers`: the behaviour shared over the identifier tables of the extension packages
(`docs/architecture/l3/windows-and-explorer/contracts.md` §1, the "Identifier tables" ADR draft). It is bundled into
the extensions that use it and never published on its own. Libraries read no files: the generator of the tables
(`tools/identifiers.ts`) and the string-table check (`tools/string-tables.ts`) are repository tools.

| | |
|---|---|
| Owner | area B (windows and explorer) |
| Contract | `registerCommands`, `readSetting` and `setContextKey` over a package's generated table (contracts §1.2), added with the first package that needs them |
| Allowed imports | none yet; never an extension (layout rule 4) |
| Coverage exclusions | none |
