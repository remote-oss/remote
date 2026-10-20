# Task card containers-76: the CLI bridge applies a template and reads a template's metadata (C14's CLI port)

Containers increment 2, authoring. Size: S. Builder: `task:claude`. Brief:
`docs/architecture/l3/containers-engine/brief-increment-2-authoring.md` ruling 4 and §4 ("the CLI port's two new
calls, `applyTemplate` and `templateMetadata`, on the existing bridge"). ADR-0009: the CLI is used unmodified, and its
results are read from structured output. **Depends on tooling-57 (#1235)** for the smoke row only.

## 1. Measured (daedalus, 2026-10-20, CLI 0.89.0; recorded in tooling-57)

- Neither `templates apply` nor `templates metadata` has `--log-format`.
- `apply` prints **one JSON line on stdout**, `{"files":["./.devcontainer/devcontainer.json", …]}`, and its log as
  text on stderr. A failure exits 1 with **stdout empty**.
- `metadata <id>` prints the template's metadata as JSON on stdout: `{id, version, name, description, options, type,
  files, fileCount, featureIds, …}`.
- `apply` leaves out `devcontainer-template.json`, `README.md` and `NOTES.md` by itself.
- The CLI uses plain HTTP only for `localhost:<port>` registries. That matters to the harness only.

## 2. The calls (`cli/cli-bridge.ts`, `cli/cli-arguments.ts`)

```ts
applyTemplate(
  request: {workspaceFolder: string; templateId: string; templateArgs: Readonly<Record<string, string | boolean>>;
            features: readonly {id: string; options: Readonly<Record<string, unknown>>}[]; omitPaths: readonly string[]},
  onLine: (line: string) => void,
  cancellation: AbortSignal,
): Promise<{kind: 'applied'; files: string[]} | CliFailure>;
templateMetadata(templateId: string, cancellation: AbortSignal): Promise<{kind: 'metadata'; metadata: Readonly<Record<string, unknown>>} | CliFailure>;
```

- **The argv:**
  - `templates apply -w <workspaceFolder> -t <templateId> -a <JSON of templateArgs> -f <JSON of features>
    --omit-paths <JSON of omitPaths> --log-level info`;
  - `templates metadata <templateId> --log-level info`;
  - built in `cli-arguments.ts` beside the others, with no shell, as the bridge's other calls are.
- **The process:** through the existing `CliHost`, with the editor's environment as the other calls get it. The
  user's Docker credential helpers are the only credentials (ruling 4).
- **The result:**
  - exit 0 with stdout parsing as JSON of the expected shape (`files` an array of strings; metadata an object) gives
    `applied` or `metadata`;
  - anything else is a `CliFailure`: a non-zero exit, unparsable stdout, the wrong shape, or a failure to start.
    Use the bridge's existing failure kinds (read `CliFailure`), adding none unless none fits, and say which in the
    PR.
  - **Stderr is never read for meaning.** Its lines go to `onLine`, which C14 sends to the Dev Containers log, so
    "Show Log" can show them (F-0802 7.E1).
- **Cancellation** ends the process, as the other calls do.

## 3. Rows

- **Unit**, over the bridge's fake host:
  - the two argv shapes, with JSON-quoted arguments;
  - `applied` with files;
  - exit 1 with empty stdout;
  - exit 0 with junk stdout;
  - the wrong shape;
  - metadata;
  - stderr lines reach `onLine` and nothing else;
  - cancellation.
- **Acceptance**, a smoke row in the `containers` launch beside tooling-57's, named `#1238: the bridge applies
  the run's alpine template into a scratch folder and reads its metadata`. It goes through the bridge, with the
  harness reaching it the way the containers suite reaches other product internals, or through tooling-57's CLI
  path if there's no such hook. **No new product command for the test.** If neither path works, keep the unit rows
  and say so in the PR.

## 4. Done when

The unit rows pass with the bridge's new code at 100 %, and all gates pass. PR title: `remote-containers: the CLI
bridge applies a template and reads a template's metadata (card containers-76, #1238)`. Request athena only.
