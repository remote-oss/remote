# Task card tooling-57: the run's own template catalogue and template registry (authoring harness)

Containers increment 2, authoring. Size: M. Builder: `task:claude`. Design: `brief-increment-2-authoring.md` ruling 9
(harness first), with proteus's two points from its design check of #1214:
- the product honours the harness-only index variable **only under `REMOTE_OSS_ACCEPTANCE=1`**, with a row (that row
  is in the C14 catalogue card; this card provides the variable);
- the rows use the **smallest templates**, with their images **pre-pulled by digest**.

## 1. Measured already (daedalus, 2026-10-20, CLI 0.89.0)

Record these in `tests/acceptance/README.md`'s containers section:
- **Plain HTTP is used only for `localhost:<port>`.** `templates publish` to `127.0.0.1:<port>` fails with a TLS error
  (`wrong version number`). The same registry addressed as `localhost:<port>` works ("Sending as plain HTTP request").
  So the template references in the run's index use `localhost:<port>`, and the registry needs no TLS. The run's
  registry (`tools/acceptance-registry.ts`) keeps publishing on `127.0.0.1`; only the name changes.
- **`templates apply` and `templates metadata` have no `--log-format`.** `apply` prints one JSON line on stdout,
  `{"files":["./.devcontainer/devcontainer.json"]}`, and its log as text on stderr. A missing template exits 1 with
  stdout empty. `metadata <id>` prints the template's metadata as JSON on stdout. The bridge card reads the stdout
  JSON and the exit code, and never the stderr text (ADR-0009).
- `apply` leaves out `devcontainer-template.json`, `README.md` and `NOTES.md` by itself.
- **The public index** (`https://containers.dev/static/devcontainer-index.json`) is `{"collections": [{sourceInformation,
  features, templates}]}`. 300 collections hold 183 templates, and each template's `id` is its full OCI reference
  (`ghcr.io/devcontainers/templates/alpine`), with `version`, `name`, `description`, `options`, `optionalPaths`,
  `type`, `files`, `platforms`, `publisher`, `documentationURL` and `licenseURL`.

**athena's three conditions (2026-10-20), which bind this card.** R-76 is about the product. Test data may hold this
material only as follows:
1. The mirrored template layers stay in the run's cache, fetched and checked by digest like the server archive. They
   are never committed and never in a VSIX.
2. The committed index snapshot holds only the `devcontainers/templates` collection's metadata (MIT). Its folder holds
   the licence notice (the MIT text of `devcontainers/templates`, from the `licenseURL` the entries name) and
   `SOURCE.md` with the URL and the index's date and digest, so the attribution goes with it.
3. None of it is reachable from a package. It stays under `tests/` only. Add a unit row to `tools/` (or extend the
   package-view check) that no file under `tests/acceptance/fixtures/templates/` reaches a VSIX.

## 2. The pinned index (`tests/acceptance/fixtures/templates/`)

- `devcontainer-index.json`: a **trimmed snapshot** of the public index, taken once and committed. It holds only the
  collection whose `sourceInformation.ociReference` is `ghcr.io/devcontainers/templates`, with its `templates` (no
  `features`), plus §3's custom collection.
  - A header file `SOURCE.md` names the URL, the date and the sha256 of the full file it was cut from.
  - It's published data of the dev container specification's index, holding metadata only, no template files
    (R-76's line: the product bundles no template content, and this is test data).
  - Write the cut as a small script in `tools/` (`tools/trim-template-index.ts`, with a unit row on a fixture), so it
    can be redone.
- **At run start** the harness writes the run's copy, with every `id` under `ghcr.io/devcontainers/templates/`
  rewritten to `localhost:<registry port>/devcontainers/templates/`. It serves that copy on the download host at
  `/templates/devcontainer-index.json` (`tools/acceptance-downloads.ts`, a new path case beside `ok` and `missing`).
  - The harness also serves `/templates/broken-index.json` (invalid JSON) and makes `/templates/unreachable` drop the
    connection, for the failure rows.
- **The variable:** every launch's environment gets `REMOTE_OSS_TEMPLATE_INDEX=${HARNESS_DOWNLOADS_LOCAL}/templates/devcontainer-index.json`.
  Document it in the README's variables table as harness-only. The product reads it only under
  `REMOTE_OSS_ACCEPTANCE=1` (the C14 catalogue card).

## 3. The run's templates

- **Mirrored templates**, the smallest ones the rows need: `alpine` (image type, with `options` and `optionalPaths`)
  and `docker-existing-dockerfile` (the reuse rows).
  - `tools/acceptance-templates.ts` holds a pinned table `{name, version, layerDigest}` for each.
  - At cache time it fetches each one's single layer (`application/vnd.devcontainers.layer.v1+tar`) from `ghcr.io`
    anonymously (the registry's token endpoint, then the manifest by tag, then the blob), checks the digest, and keeps
    it in the runner's cache folder, as the server archive is kept.
  - At run start it extracts each layer into the run folder and publishes it into the run's registry with
    `devcontainer templates publish <folder> -r localhost:<port> -n devcontainers/templates` (the CLI the product
    bundles).
  - If the CI runners can't reach `ghcr.io` even at cache time, comment here and stop.
- **One template of our own** for the custom-id rows (F-0802 BR-6 to BR-8):
  `tests/acceptance/fixtures/templates/custom/src/mini/`. It's an image template on the pinned `alpine` image, with
  one string option and one optional path, written from the spec's template format alone. It's published as
  `localhost:<port>/remote-oss-run/custom/mini:1`, and it's also the custom collection in the index (§2).
- **Images:** the `alpine` template's default image goes into the run's pre-pulled images by digest, beside the pinned
  Alpine. Rows that apply it pick the option that gives that image. Write the digest down in the table.
- **When:** only for launches that ask (`templates: true` in the launch table, like `registry: true`), which also
  implies `registry: true`.

## 4. Rows

- **Unit:**
  - the index trim;
  - the id rewrite;
  - the layer-digest check (a mismatch fails the cache step, naming the template);
  - the publish command line;
  - the launch flag.
- **Acceptance**, a smoke row in the `containers` launch, named `#1235: the run's index lists the mirrored
  templates and the CLI applies one from the run's registry`:
  1. GET the index from `REMOTE_OSS_TEMPLATE_INDEX`: it parses, and lists `localhost:<port>/devcontainers/templates/alpine`;
  2. `devcontainer templates apply -w <scratch> -t localhost:<port>/devcontainers/templates/alpine:3 -a
     '{"imageVariant":"<the pinned one>"}'` exits 0 and writes `.devcontainer/devcontainer.json`;
  3. the same for `remote-oss-run/custom/mini:1`.
  It cites no criterion.

## 5. Done when

`node tools/acceptance.ts --editor vscodium --launches containers` passes with the smoke row (paste the summary line),
and all gates pass. PR title: `tests: the run's own template catalogue and template registry (card tooling-57,
#1235)`. Request athena only.
