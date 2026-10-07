# lib-standdown

Internal library, bundled into the extensions that use it and never published on its own. It holds the first step
of every activation:

- `standDownIfPresent`: when the extension a package stands down for runs in the same window, it sets the package's
  standing-down context key, shows one warning whose button opens the Extensions view on that extension, and
  resolves to `standing`; the package then registers nothing. Otherwise it clears the key and resolves to
  `serving`. The warning is not awaited, so activation never waits for the user. A package whose menus need no
  gating passes no key.
- `standDownHost`: the adapter over the editor API that the guard uses.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Allowed imports | `vscode` types in `src/editor-adapter.ts` only (the adapter takes the API as a parameter); no extension, no library |
| Coverage exclusions | none |
