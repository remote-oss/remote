# Task card containers-79: the template pick, flat, curated and custom-id, and the reuse-existing-file chooser (F-0802)

Containers increment 2, authoring. Size: L. Builder: `task:claude`. Brief:
`docs/architecture/l3/containers-engine/brief-increment-2-authoring.md` rulings 5 to 8. Spec:
remote-oss/remote-containers#40 (F-0802), 5.0 steps 1 to 4, 6.1 to 6.3, 6.5, 6.6, BR-2 to BR-8, BR-10, BR-13, BR-14
and BR-15. **Depends on containers-77 (#1239)**, for the catalogue, and **containers-76 (#1238)**, for the metadata
call.

## 1. The surface (`src/authoring/template-pick.ts`, new; the quick pick through a port, so it's unit-testable)

```ts
export type TemplateChoice =
  | {kind: 'listed'; template: CatalogueTemplate}
  | {kind: 'custom'; templateId: string; metadata?: Readonly<Record<string, unknown>>}
  | {kind: 'reuse'; templateId: string; entry: string}   // a "From '<entry>'" row
  | {kind: 'learnMore'}                                   // the wizard ends; the link was opened
  | {kind: 'cancelled'};
export function pickTemplate(request: {title: string; folder: FolderFacts; catalogue: CatalogueTemplate[]},
                             ports: TemplatePickPorts, cancellation: AbortSignal): Promise<TemplateChoice>;
```

`FolderFacts`, read by the caller before the pick (so the pick has no file access): the target folder's **root
entries** (names and kinds), and whether a **significant** file exists anywhere below it, with its language matches
(§3).

**The reuse-existing-file chooser** (6.5, BR-13) comes first when the root has a Dockerfile-family entry:
- **The family:** the name contains `dockerfile` in any case, the entry is a file or a folder, and only root entries
  count.
- **Compose-family rows aren't listed yet.** They wait for F-0413 (ruling 5: their criteria are `later (Compose)`).
- **The rows:**
  - S190 `From a predefined container configuration template...`, with detail S390 `Use a base configuration from the
    container template registry`, focused first;
  - one S189 `From '{0}'` per Dockerfile-family entry, sorted by character code, with detail S287 `Refer to the
    existing '{0}' in the container configuration` (F-0807's string, reused);
  - `Learn More`, with description S148.
- The title is the caller's, the placeholder S198 `How would you like to create your container configuration?`, and
  the filter matches labels only (`matchOnDescription` and `matchOnDetail` false).
- **A "From" row** gives `reuse` with `templateId` = the catalogue's `docker-existing-dockerfile` entry (by its `id`'s
  last segment), and `entry` = the row's name, which the write uses for `build.dockerfile`. If that template isn't in
  the catalogue, fail the pick with the catalogue failure of containers-77. S190 goes on to the template pick.

**The template pick:**
- **Title, placeholder and buttons:** the caller's title (S024 for F-0801's command); the placeholder S302 `Select a
  container configuration template or enter a custom template id`; no Back button (BR-10).
- **The flat list** (no significant file, BR-14): `Learn More` (desc S148) first, then every template sorted by
  `name` with `localeCompare` (BR-2; ties keep index order).
  - Each template item: `label` = `name`, `description` = `owner`, `iconPath` = the `verified` codicon only when
    `owner === 'devcontainers'` (BR-5).
  - No "Open Documentation" item button: F-0105 is later (ruling 8).
- **The curated list** (a significant file exists, BR-14): S323 `Show All Templates...` (detail S325 `Show all
  available predefined container templates.`), then `Learn More`, then §3's curated templates sorted by name.
  - S323 replaces the items in place with the flat list, with focus on its first template (6.6 step 3).
- **Focus:** the first template item, never `Learn More` (BR-3). Set `activeItems`.
- **Filtering:** labels only (BR-4). `Learn More`, and `Show All Templates...` in the curated list, are
  `alwaysShow`.
- **Custom-id mode** (BR-6): when the value has at least two `/`, the items become S388 `Use '{0}' as template...`
  (with `{0}` the exact value, detail S040 `Apply this custom template instead of one of the listed templates.`,
  `alwaysShow`), plus `Learn More`, plus `Show All Templates...` in the curated list. Back under two slashes, the
  previous items return.
  - Selecting S388 runs `templateMetadata(value)` once (BR-7: never while typing). A failure is silent (BR-8). It
    gives `custom` with the metadata when it worked.
- **Learn More** opens the product's documentation URL (R-31, ruling 8), the same constant F-0402's "learn more"
  uses (`CONTAINERS_INTRODUCTION`), and gives `learnMore`.
- **Escape**, or hiding the pick, gives `cancelled` (BR-10). Nothing persists between runs (BR-15).

All strings go into the containers string table and every bundle: S024, S148, S190, S189, S198, S287, S302, S323,
S325, S388, S390 and S040.

## 2. Our curated table (`src/authoring/curated-templates.ts`, data)

Ruling 6: our own table, with the rows asserting BR-14's rule, not the observed lists.
- `NEUTRAL_FILES`: the names and patterns BR-14 observed as neutral: `readme.txt`, `foo.txt`, `requirements.txt`,
  `README.md`, `data.json`, `package.json`, `Makefile` and `Gemfile`. Generalise them to `*.txt`, `*.md`, `*.json`,
  `Makefile` and `Gemfile`, with that list in the file's comment. A file inside `.git/` never counts; folders never
  count.
- `CORE_TEMPLATES`: the eight core ids (`alpine`, `debian`, `docker-in-docker`, `docker-outside-of-docker`,
  `docker-outside-of-docker-compose`, `kubernetes-helm`, `kubernetes-helm-minikube`, `ubuntu`), matched against the
  catalogue by the last segment of the `id`, under `ghcr.io/devcontainers/templates/` or the harness's rewritten
  prefix.
- `LANGUAGE_MATCHES`: our own map from a file pattern to template ids:
  - `*.go` to `go`, `go-postgres`, `universal`;
  - `*.py` to `python`, `anaconda`, `anaconda-postgres`, `miniconda`, `miniconda-postgres`, `universal`;
  - `*.js` and `package.json` to `javascript-node`, `javascript-node-mongo`, `javascript-node-postgres`, plus
    `universal` for `*.js`;
  - `*.ts` to `typescript-node`, `universal`;
  - `*.csproj` to `dotnet`, `dotnet-mssql`, `dotnet-postgres`, `dotnet-fsharp`;
  - `*.rs` to `rust`, `universal`;
  - `*.java` to `java`, `universal`.
  - A match whose id isn't in the catalogue is left out. Write the table's rule (every file present adds its matches,
    neutral ones included, once curation is on, BR-14) in the file's comment.
- Scanning the folder: a walk of the target folder bounded at 5 000 entries and depth 8, done by the caller and
  handed over in `FolderFacts`. Past the bound, treat the folder as having a significant file.

## 3. Rows

**Unit** (`template-pick.test.ts`, `curated-templates.test.ts`), named after the criteria:
- F-0802 AC-2: the flat order, with Learn More first;
- AC-3: the badge only for `devcontainers`;
- AC-4: the focus;
- AC-5: label-only filtering;
- AC-9 and AC-10: the custom-id threshold;
- AC-11: metadata on select only, with silent failure;
- AC-18: Learn More;
- AC-19's first-screen half: Escape;
- AC-22, AC-29 and AC-36's Dockerfile half: the chooser rows, their order, focus and labels-only filter;
- AC-24, AC-25, AC-28 and AC-30: the curated list's shape and rule, with Show All in place;
- AC-26, AC-34 and AC-35: the rule (neutral versus significant, at any depth, `.git` ignored) against our table;
- AC-31: no persistence.

**Acceptance** comes with the wizard card (containers-80), through the real quick pick.

## 4. Done when

The unit rows pass with the new files at 100 %, and all gates pass. PR title: `remote-containers: the template pick,
flat, curated and custom-id, and the reuse-existing-file chooser (card containers-79, #1241)`. Request athena
only.
