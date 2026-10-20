# Task card containers-57: a configuration whose image or Dockerfile isn't a string shows S081 (F-0301 AC-11)

Issue: #1154. Milestone 0.4, containers release 1. Size: S. Builder: `task:local` (selene). Design: athena's ruling 4 on #737,
option (a), narrowed (2026-10-20). Spec: remote-oss/remote-containers#20 (F-0301), 7.E3 and AC-11. Every decision
is made below. If something doesn't match what you find, stop and comment on this issue; don't choose.

## 1. Why

F-0301 AC-11, a configuration whose `image` is a number, wants a modal error dialog with "Edit devcontainer.json
Locally" | "More Actions..." | "Retry". Its preferred text is S081, `Configuration "<path>" not valid.`, with the
configuration's path. No container is created, and the file is unchanged.

Today the dialog shows the generic S034. The dev container CLI doesn't reject `"image": 42`: it runs
`docker pull 42` and fails like a missing image (measured by daedalus with CLI 0.89.0). So the extension checks the
types itself, after the configuration read and before the container step.

## 2. The change

### 2.1 New file `packages/remote-containers/src/config/source-types.ts`

```ts
/**
 * @fileoverview Whether a configuration's image and Dockerfile entries have the types the devcontainer.json schema
 * gives them. The dev container CLI takes a number as an image name, so the connect checks these itself.
 */

/** Whether `value` is absent or a string. */
function absentOrString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/**
 * Whether `configuration`'s `image`, `dockerFile` and `build.dockerfile` are each absent or a string. A `build` that
 * isn't an object, and every other property, are not checked here.
 */
export function sourceTypesValid(
  configuration: Readonly<Record<string, unknown>>,
): boolean {
  const {build} = configuration;
  const dockerfile =
    typeof build === 'object' && build !== null && !Array.isArray(build)
      ? (build as Record<string, unknown>).dockerfile
      : undefined;
  return (
    absentOrString(configuration.image) &&
    absentOrString(configuration.dockerFile) &&
    absentOrString(dockerfile)
  );
}
```

Don't check `service` or `dockerComposeFile`. F-0301 7.E3 records that a number as the Compose service gives 7.E6 or
7.E4, not 7.E3, so those stay as they are.

### 2.2 `packages/remote-containers/src/connect/failures.ts`

Add after `containerSetupFailed`:

```ts
/** The configuration's image or Dockerfile entry has the wrong type; `configFile` is the configuration's path. */
export function configurationInvalid(configFile: string): Failed {
  return failure('configurationInvalid', {}, {id: 'S081', values: [configFile]});
}
```

### 2.3 `packages/remote-containers/src/surfaces/failure-strings.ts`

In `FAILURE_TEMPLATES`, between `S034` and `S104`, add:
`S081: 'Configuration "{0}" not valid.',`

### 2.4 The l10n bundles

Add the key `Configuration \"{0}\" not valid.` to `packages/remote-containers/l10n/bundle.l10n.json` and to each
`bundle.l10n.<locale>.json` (15 files in all), with the English text as its value, as every key there has. Put it on
the line right after the `"An error occurred setting up the container."` entry in each file; the files aren't sorted.
`pnpm check-string-tables` must pass.

### 2.5 `packages/remote-containers/src/connect/connector.ts`

1. The read cache keeps the whole read. Change
   `const reads = new Map<string, Promise<string | undefined>>();` to
   `const reads = new Map<string, Promise<ConfigurationResult | undefined>>();`
   and its comment to `/** Each payload's configuration as read without a container, read once per payload for the canonical requests and the connect's check (windows contracts §3.2). */`.
   Import `ConfigurationResult` (a type) from `../cli/cli-lines.ts`.
2. `readOf` returns `Promise<ConfigurationResult | undefined>`. In its `.then`, `return result;` replaces
   `return result.workspaceFolder;` (the failure branch stays). `readWithinCap` returns
   `Promise<ConfigurationResult | undefined>` too.
3. In `canonicalPathOf`, `const root = connection?.remoteWorkspaceFolder ?? read;` becomes
   `const root = connection?.remoteWorkspaceFolder ?? read?.workspaceFolder;`.
4. In `connectFresh`, change `await readWithinCap(payload, folder, tools);` to
   `const read = await readWithinCap(payload, folder, tools);`. Then, right after the `secondCheck` block (after
   `return engineCheckFailed(checked.detail);`'s closing brace) and before `lifecycle = dependencies.lifecycleFor(…)`,
   add:

   ```ts
       if (read !== undefined && !sourceTypesValid(read.configuration)) {
         // The next attempt reads the file again, so a fix the user saves is seen by Retry.
         reads.delete(payload);
         logger.error(
           `the configuration ${configFile} is not valid: its image or Dockerfile entry is not a string`,
         );
         return configurationInvalid(configFile);
       }
   ```

   Import `sourceTypesValid` from `../config/source-types.ts` and `configurationInvalid` from `./failures.ts`.
   `configFile` is the one already destructured from `tools` in `connectFresh`.

A read that failed or timed out (`read === undefined`) is not checked; the connect goes on as today.

## 3. Rows

**Unit.**
- `packages/remote-containers/test/unit/source-types.test.ts` (new), `describe('the source types of a configuration (card containers-57)', …)`. One `it` per line, each named `F-0301 7.E3: …`:
  - `{image: 'node:22'}` is valid;
  - `{}` is valid;
  - `{image: 42}`, `{image: true}`, `{image: {}}` and `{image: ['a']}` are invalid (one `it`, a `deepStrictEqual` of the four results with `[false, false, false, false]`);
  - `{dockerFile: 7}` is invalid, and `{dockerFile: 'Dockerfile'}` is valid;
  - `{build: {dockerfile: 7}}` is invalid, and `{build: {dockerfile: 'Dockerfile'}}` is valid;
  - `{build: 'x'}`, `{build: null}` and `{build: ['x']}` are valid (a `build` that isn't an object isn't checked);
  - `{service: 5, dockerComposeFile: 6}` is valid (not checked, 7.E4 and 7.E6).
- `packages/remote-containers/test/unit/failures.test.ts`: `configurationInvalid('/w/.devcontainer/devcontainer.json')` has kind `configurationInvalid`, reason `{id: 'S081', values: ['/w/.devcontainer/devcontainer.json']}`, not retryable, not silent. Follow that file's existing rows' form.
- `packages/remote-containers/test/unit/failure-dialog.test.ts`: the dialog of that failure has detail `Configuration "/w/.devcontainer/devcontainer.json" not valid.`, the same three buttons as the generic case, and an empty message. Copy the nearest generic-dialog row's form.
- `packages/remote-containers/test/unit/connector.test.ts`, with the fixture's `scene.configuration` set to a configuration result whose `configuration` is `{image: 42}`:
  - `F-0301 AC-11: an image that is a number ends the connect with S081 and the configuration's path, before any container step`. The result is the `configurationInvalid` failure with the fixture folder's config path, and `scene.prepared` is `[]`.
  - `F-0301 AC-11: after an invalid configuration the next connect reads it again`. Two connects give two entries in `scene.configurationReads` with `containerId` undefined. For the second, set `scene.configuration` to a valid one; it reaches `prepare`.
  - `F-0410 AC-13: an image that is a string that doesn't exist still reaches the container step`. `{image: 'nope:latest'}` gives one `scene.prepared` entry.
  - `F-0301 7.E3: a configuration read that fails isn't checked, and the connect goes on`. `scene.configuration` is a `configurationFailed` failure, and `scene.prepared` has one entry.
  Look at the existing rows that set `scene.configuration` (around lines 62, 675 and 1508 of the test file) for the result's shape.

**Acceptance.** `tests/acceptance/containers/configuration-errors.test.ts`, row e2 (`F-0301 AC-11, AC-55, AC-56 (e2)`):
- Rename it to `F-0301 AC-11, AC-55, AC-56 (e2): an image that is a number shows S081 with the configuration's path and makes no container, the title is unchanged while it is open, and More Actions... shows the four-item pick and then the disconnected title and status`.
- Its expected `dialog: FAILED_SETUP,` becomes the following, and `FAILED_SETUP` stays as it is for the other rows:

  ```ts
        dialog: {
          ...FAILED_SETUP,
          details: `Configuration "${path.join(folder, '.devcontainer', 'devcontainer.json')}" not valid.`,
        },
  ```
- Change `NUMBER_IMAGE`'s comment to: ``/** The configuration of a folder whose `image` is a number, which the connect rejects before the CLI runs. */``.
- Nothing else in e2 changes.
- If the folder path the dialog shows differs from `path.join(folder, …)` (a symlink, a `/private` prefix), stop and comment the two paths on this issue.

**Coverage.** `docs/architecture/catalogue/coverage-containers-r1.tsv`: `F-0301.AC-11` goes from `todo` to `acceptance`.
`node tools/check-coverage.ts` must pass.

## 4. Must stay green

The `containers` launch rows `F-0410 AC-13 (r1)`, `F-0410 AC-1 (r1b)`, `F-0410 AC-1 (buttons)` and `F-0410 AC-3 (r6)`
in `tests/acceptance/containers/recovery.test.ts`, and every row of `configuration-errors.test.ts` (7.E4, 7.E6 and
the others).

## 5. Done when

- `pnpm test` passes for remote-containers, and the changed files are at 100 % in its coverage gate.
- `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js <every changed file>` is clean, and so are
  `pnpm dupes`, `pnpm dead`, `pnpm check-string-tables` and `node tools/check-coverage.ts`.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers` passes. Paste the summary line
  in the PR.
- PR title: `remote-containers: an image or Dockerfile that isn't a string shows S081 before any container step (card containers-57, #1154)`.
  Request athena only.
