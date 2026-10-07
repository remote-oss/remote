# lib-identifiers

Internal library, bundled into the extensions that use it and never published on its own. It holds the behaviour
shared over each extension's generated identifier table (`src/identifiers.generated.ts`, written by
`pnpm identifiers`):

- `registerCommands`: registers every command of the table with its handler. A handler whose `isAvailable` returns
  false does nothing; when the command's policy is `infoLine` it also shows the information line "'{0}' is not
  possible in the current context." with the command's title in the user's language. Registration refuses to run
  after the activation stood down, and fails when a command has no handler.
- `readSetting`: the effective value of a setting. When a legacy twin is declared, the winning side's value counts
  when both hold one, the other side's when only it does, and the declared default when neither does. A key holds a
  value when a settings level that applies to its scope sets it; for a pair whose legacy side wins, an empty or
  null legacy value does not count.
- `setContextKey`: sets a context key the extension owns, and fails for one the editor sets.
- `identifierHost`: the adapter over the editor API that the three operations use.

Repository tools, not this library, read files: `tools/identifiers.ts` writes the tables and checks them, and
`tools/string-tables.ts` checks the string tables.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Allowed imports | `vscode` types in `src/editor-adapter.ts` only (the adapter takes the API as a parameter); no extension, no library |
| Coverage exclusions | none |
