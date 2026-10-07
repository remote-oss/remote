# lib-product

The running editor's product profile, and where its server archive comes from. Every name, folder, URL and licence
fact the remote extensions use about the editor is read here, from the editor's own product.json; no other code
knows a product by name. It is bundled into the extensions that use it and never published on its own.

## Contract

- `readProfile(text)` reads product.json into a profile, or reports it `unreadable`. A missing field gives its empty
  value; a missing server data folder stays absent, for the caller's own fallback.
- `expand(template, values, allowedNames)` makes a `${name}` template into one absolute http or https URL, or names
  the unknown placeholder, or reports a result that is not such a URL.
- `resolveServerArchive(profile, host, policy, override)` finds the archive URL in this order: the extension's
  override from an allowed settings layer, the product's own template, the built-in table; else `noSource`. An
  unusable override is `invalidOverride`; an unusable product template or table entry is skipped and reported.
- `OVERRIDE_POLICIES` holds each extension's override: its setting, the layers that count, whether a base URL is
  accepted, and the placeholders its templates may use.
- `classifyLicence(facts)` decides whether a server comes under the server licence terms, by its source.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry point | `lib-product` (`src/index.ts`) |
| Allowed imports | none: no library, no extension, no `vscode`, no file, process or network access |
| Literals | product names and download hosts live only in `src/product-table.ts` (checked by `tools/check-layout`) |
| Coverage exclusions | none |
