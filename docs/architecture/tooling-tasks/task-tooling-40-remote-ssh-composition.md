# Task card tooling-40: remote-ssh's activation and wiring tests split by feature

Issue: #800. Release 0.2 (gate throughput). From athena's brief and hermes's addition (the `activate` collision). Size:
M (about 1.5 agent-days). Builder: unassigned (task:claude). Track C. tooling-44 (#804) doesn't depend on it:
tooling-44 keeps `extension.ts`'s imports as they are, so the two can run in parallel. The data is in tooling-38 §0:
- `remote-ssh/test/unit/wiring.test.ts` changed on both sides of 10 merges, and conflicted at merge time 3 times;
- `src/extension.ts` 7 (hermes: #604, #609, #612, and the semantic collision where `adapters` was hoisted, #608);
- `src/pipeline/wiring.ts` 6, which stays as it is (tooling-38 §0, observations).

Behaviour doesn't change, and no row's name changes.

## 1. `test/unit/wiring.test.ts` → one file per step

The file holds 13 `describe` blocks, one per part of the composition, over shared helpers. Different cards touch
different blocks, but the blocks share one file, so their edits meet.
- **Shared helpers:** `serverSettings`, `portsOf`, `WiringSeen`, `BRIDGE_PORT`, `ALIAS`, `inputFor`, `stepsOf`,
  `CONNECTED`, `lookupWith`, `tunnelWith` and `channelRunOf` move unchanged into `test/unit/wiring.fixture.ts`, after
  the pattern of `pipeline.fixture.ts`.
  - It exports only what a test file imports.
  - `serverSettings` and `lookupWith`, used only inside other helpers, stay unexported, or `pnpm dead` flags them.
  - The builder lists the fixture's exports in the PR.
- **The blocks** move unchanged, each into a file named for it:

  | `describe` | File |
  |---|---|
  | the composition of a connect's steps | `wiring-composition.test.ts` |
  | the composition's forwarding to this connect's server steps | `wiring-server-forwarding.test.ts` |
  | the download mode reaches this connect's plan | `wiring-download-mode.test.ts` |
  | the composition's forwarding of the later server steps | `wiring-later-server-steps.test.ts` |
  | a connect's socket mode | `wiring-socket-mode.test.ts` |
  | the connection step by mode | `wiring-connection-mode.test.ts` |
  | a terminal-mode connect's tunnel run | `wiring-terminal-tunnel.test.ts` |
  | the composition's server steps | `wiring-server-steps.test.ts` |
  | the composition's channel and window environment | `wiring-channel-environment.test.ts` |
  | a terminal-mode login's wait; a terminal-mode connect's channel; a terminal-mode connect's wait, from this connect's lookup and settings | `wiring-terminal-wait.test.ts` |
  | the composition's CLI path | `wiring-cli-path.test.ts` |

  Blocks added on main before the build go to the file of their step, or a new file named the same way.
- `wiring.test.ts` is deleted.
- **Proof:** the number of passing rows in `pnpm test:unit` is equal before and after, and each row name is unchanged.
  Paste both counts and `grep -c "it("` over the old and new files.

## 2. `src/extension.ts`: activate composes feature modules over one activation context

**Today:** `activate` builds the shared values (`manifest`, `host`, `adapters`, `extension`, `configPlaces`, `help`)
inline. It then runs the setup and wires each feature in place: the connect registration, the companion endpoints, and
the configuration-file handler passed into the setup. A card that needs a shared value earlier, or adds a feature,
edits the middle of the function. That's where #604, #608 and #612 collided.

**After:**
1. **`src/activation/types.ts`:** the types `Manifest` and `ServedActivation`, moved from `extension.ts`. Feature modules
   take them from here, so nothing imports `extension.ts`, which would be a cycle under
   `layout/no-intra-package-cycles`; that rule counts `import type`.
2. **`src/activation/editor-facts.ts`:** the helpers several features share, moved unchanged:
   - `ACCEPTANCE_FILES`, `acceptanceWindowName`, `editorProfile`, `dataFolderNameOfEditor`;
   - `configuredHosts`, `translate`, `surfaceAdapters`, and the constants they read.

   No single feature owns them: `acceptanceWindowName` and `ACCEPTANCE_FILES` serve `surfaceAdapters`, the connect
   registration and `activate`; `editorProfile` and `dataFolderNameOfEditor` serve the setup gate and the connect
   registration; `configuredHosts` serves the connect registration and the companion endpoints.
3. **`src/activation/context.ts`:** `ActivationContext`, the values every feature reads: `manifest`, `host`, `adapters`,
   `extension`, `configPlaces`, `help` and `vscodeContext` (the `ExtensionContext`).
   - `activationContextOf(context): Promise<ActivationContext>` builds it once, at the top of `activate`. It's today's
     first lines.
   - **It stays inside the composition root** (athena): only `src/extension.ts` and `src/activation/*` import it.
   - **The ESLint rule** (dike): `eslint.config.ts` already has a `no-restricted-imports` block for
     `packages/*/src/**` (near lines 337–352) with the `testing/` pattern. Flat config replaces a rule's options
     rather than merging them, so the new block can't be a separate one.
     - The existing block gains a second pattern, the `ActivationContext` module, for every file except
       `packages/remote-ssh/src/extension.ts` and `packages/remote-ssh/src/activation/**`. That's done with a second
       block that **repeats the `testing/` pattern** and adds the new one, scoped to remote-ssh.
     - `tools/eslint-config.test.ts` gains two rows:
       - a remote-ssh `src/connect/` file importing `src/activation/context.ts` is an error;
       - a remote-ssh `src/` file importing `testing/` is still an error, so the ban can't be lost silently.
4. **One module per feature** in `src/activation/`, each exporting one async function:

   | Module | Signature | Moves from `extension.ts` |
   |---|---|---|
   | `config-file-feature.ts` | `configFileHandlerOf(context): CommandHandler` | the `openConfigFileHandler(...)` construction passed to the setup |
   | `connect-feature.ts` | `connectFeature(context, served): Promise<{registration: ConnectRegistration; disposable: vscode.Disposable}>` | `registerConnectOf`, `recordAuthority`, `acceptanceResolverEditorOf` |
   | `companion-feature.ts` | `companionFeature(context, served, connect: {activeConnection(): …}): vscode.Disposable` | the `createProtocol` and `serveSliceEndpoints` block |

   **A feature that needs another's result takes it as an explicit parameter.** The companion feature takes the
   connect's `activeConnection`, as `activate` passes it today (`activeConnection: () => connect.activeConnection()`). So the order of the calls in `activate` is
   visible in their data.
5. **A feature module only wires** (athena): it calls covered modules with the narrow values they take, such as
   `context.host` or `served.logger`, never with the whole context. Any **new** branch or computation belongs in a
   covered module, not here.
   - **Carve-out: code moved as it is.** The helpers of points 2 and 4 move unchanged: `recordAuthority`
     (`mkdirSync`, `writeFileSync`), `acceptanceResolverEditorOf`, `registerConnectOf`, `configuredHosts` and
     `acceptanceWindowName` (an `existsSync` ternary and a timer).
   - Extracting their logic into covered modules is a refactor of its own, outside this card. The PR lists them as the
     moved-as-is exceptions, so a later card can take them.
   - From this card on, a change to them that adds logic moves that logic into a covered module.
6. **`activate` becomes a short, linear list:**
   1. build the context;
   2. run the setup with `configFileHandlerOf(context)`, and return if not serving;
   3. push the result's disposal;
   4. `const connect = await connectFeature(context, served)`, and push its disposable;
   5. push `companionFeature(context, served, connect.registration)`.

   **A new feature card** adds a module and one call line, at the end of the list. A value several features need joins
   `ActivationContext` or `editor-facts.ts`, so no card reorders `activate`.
7. **Coverage:** every file under `src/activation/` imports `vscode` or only declares types, so all six are coverage
   exclusions: `context.ts`, `editor-facts.ts`, `types.ts` and the three feature modules, with reasons `loads the
   editor` or `types only; no executable code`.
   - `tools/coverage.ts` requires each excluded path, with its reason, in `coverage.json` and in the package README's
     "Coverage exclusions" row.
   - The README's "Allowed imports" row adds `src/activation/` beside `src/extension.ts`, for `lib-companion`.
   - The rule of point 5 is what keeps untested logic out of these files, and athena's design check reviews each one
     for it.

**What this doesn't remove:** two cards that each add a feature in the same window still both append one call line at
the end of `activate`. That's a one-line conflict, which `git` often resolves, instead of interleaved edits in the
middle of a long function. A generated registry isn't worth it here: the order of the calls matters, as point 4
shows (athena accepted the ordered list).

## 3. Gates and review

All gates, with `pnpm test:unit` row counts equal before and after. The acceptance runs don't change, but run the
`windows` launch once filtered, as a smoke test of activation, and paste it. PR title `remote-ssh: activation composes
feature modules, and the wiring rows split by step (card tooling-40, #800)`. Request athena only.

## 4. Land when

Most remote-ssh product branches touch `extension.ts` or `wiring.test.ts`.
- **Open PRs at the time of writing (main 7dd735ac):** #753 (connect-39) has merged, so its changes to
  `extension.ts`, `pipeline/wiring.ts` and `wiring.test.ts` are already on main. Before starting, the builder lists
  the open PRs that touch `src/extension.ts` or `test/unit/wiring.test.ts` (`gh pr list` with each PR's files), names
  them in the PR, and tells hermes.
- **When:** right after a quiet window, telling hermes the moment it merges.

An in-flight branch resolves like this:
- `wiring.test.ts` is deleted on main, so git reports modify/delete. The branch takes the deletion, then moves its new
  or changed `describe` blocks into the step's new file, and its edits to the file's shared helpers into
  `wiring.fixture.ts`.
- An edit to `activate` moves into the feature module it belongs to, or a new one. An edit to `registerConnectOf`
  goes to `connect-feature.ts`, and one to `surfaceAdapters` or another shared helper goes to `editor-facts.ts`.

## 5. Open rows (stop and report on #800)

1. A feature block in `activate` reads a value the setup produces in a way that can't pass through `ServedActivation`
   or `ActivationContext`. Name it.
