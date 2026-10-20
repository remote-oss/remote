# Task card containers-77: the template catalogue, fetched once per wizard run (C14's catalogue port)

Containers increment 2, authoring. Size: M. Builder: `task:claude`. Brief:
`docs/architecture/l3/containers-engine/brief-increment-2-authoring.md` ruling 3, plus proteus's point from its design
check (the harness-only index variable is honoured only under `REMOTE_OSS_ACCEPTANCE=1`, with a row). Specs: F-0802
BR-1 and 7.E3; F-0801 7.E10 (a) and PRE-5. **Depends on tooling-57 (#1235)**, which serves the run's index and sets
`REMOTE_OSS_TEMPLATE_INDEX`.

## 1. The port (`src/authoring/catalogue.ts`, new)

```ts
export interface CatalogueTemplate {
  id: string;            // the full OCI reference, e.g. ghcr.io/devcontainers/templates/alpine
  version: string;
  name: string;          // the label
  description?: string;
  owner: string;         // the GitHub owner login shown as the item's desc (F-0802 5.0 step 2)
  options: Readonly<Record<string, unknown>>;
  optionalPaths: readonly string[];
  documentationURL?: string;
}
export type CatalogueResult =
  | {kind: 'catalogue'; templates: CatalogueTemplate[]}
  | {kind: 'failed'; cause: string};   // the network or parse error's own message
export function parseCatalogue(text: string): CatalogueResult;   // pure
export function fetchCatalogue(ports: CataloguePorts, cancellation: AbortSignal): Promise<CatalogueResult>;
```

- **Source:** `https://containers.dev/static/devcontainer-index.json`. **Exception:** when `REMOTE_OSS_ACCEPTANCE` is
  exactly `1` in the extension host's environment and `REMOTE_OSS_TEMPLATE_INDEX` is set, use that URL. That's the
  harness's, documented as harness-only, the same way the acceptance log tee is. Read both in one place, beside where
  the acceptance switch is read for the log.
- **Fetch:** Node's `https` (or `http` for the harness's `http://` URL) **in the extension host**, so core's proxy
  support applies (`http.proxy`, ruling 3). There's no cache: one fetch per wizard run (F-0802 BR-1, AC-37). Bound it
  at 30 s, which gives `failed` with `the catalogue download timed out`.
- **Parse:** every `collections[].templates[]` entry, in index order.
  - An entry without a string `id`, `name` and `version` is skipped.
  - `owner` is the GitHub owner login: the second path segment of the `id` when the registry is `ghcr.io`, otherwise
    the `publisher`. Check that against the index (for `ghcr.io/devcontainers/templates/alpine` it's
    `devcontainers`), and write the rule you find in the PR. F-0802 BR-5's badge depends on it.
  - Invalid JSON gives `failed` with the parser's message.

## 2. The failure (F-0801 7.E10 (a), F-0802 7.E3, the preferred outcome)

When the fetch fails, the wizard shows **no screen**. Instead it shows a modal error with our own text, which names
the network cause. The string is ours (ADR-0008), so it's provisional until the spec records it (the brief's §6
question):
- id `catalogueUnavailable`;
- text `The list of dev container templates couldn't be downloaded: {0}`, where `{0}` is the `cause`.

Add it to the containers string table and every bundle (`check-string-tables`). Show it on every entry path. The
remote indicator path shows it too, which the reference doesn't (7.E10's preferred outcome). The wizard card calls
this; this card exports `showCatalogueFailure(dialogs, cause)`.

## 3. Rows

- **Unit:**
  - `parseCatalogue` on a trimmed copy of tooling-57's fixture: order kept, owner derived, a malformed entry skipped,
    junk text;
  - the source choice: the default URL; the harness URL only under `REMOTE_OSS_ACCEPTANCE=1`, and **not** with the
    variable alone (proteus's row: `#1214 design check: the harness index variable is ignored without
    REMOTE_OSS_ACCEPTANCE=1`);
  - the timeout;
  - the failure text.
- **Acceptance** rows come with the wizard card (containers-80), which drives the screens.

## 4. Done when

The unit rows pass with `catalogue.ts` at 100 %, and all gates pass. PR title: `remote-containers: the template
catalogue, fetched once per wizard run (card containers-77, #1239)`. Request athena only.
