# Task card tooling-40: remote-ssh's activation and wiring tests split by feature

Issue: #800. Release 0.2 (gate throughput). From athena's brief and hermes's addition (the `activate` collision). Size:
M (about 1.5 agent-days). Builder: unassigned (task:claude). Track C: tooling-44 (#804) lands after this one, because
both touch `extension.ts`. The data is in tooling-38 §0:
- `remote-ssh/test/unit/wiring.test.ts` changed on both sides of 10 merges, and conflicted at merge time 3 times;
- `src/extension.ts` 7 (hermes: #604, #609, #612, and the semantic collision where `adapters` was hoisted, #608);
- `src/pipeline/wiring.ts` 6, which stays as it is (tooling-38 §0, observations).

Behaviour doesn't change, and no row's name changes.

## 1. `test/unit/wiring.test.ts` → one file per step

The file holds 13 `describe` blocks, one per part of the composition, over shared helpers. Different cards touch
different blocks, but the blocks share one file, so their edits meet.
- **Shared helpers:** `serverSettings`, `portsOf`, `BRIDGE_PORT`, `ALIAS`, `inputFor`, `stepsOf`, `CONNECTED`,
  `lookupWith`, `tunnelWith` and `channelRunOf` move unchanged into `test/unit/wiring.fixture.ts`, which exports them.
  The pattern is `pipeline.fixture.ts`.
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
inline. It then runs the setup and wires each feature in place: the connect registration, the companion endpoints,
and the configuration-file handler passed into the setup. A card that needs a shared value earlier, or adds a feature,
edits the middle of the function. That's where #604, #608 and #612 collided.

**After:**
1. **`src/activation/context.ts`:** `ActivationContext`, a plain object type with the values every feature reads:
   `manifest`, `host`, `adapters`, `extension`, `configPlaces`, `help`, `translate` and `vscodeContext` (the
   `ExtensionContext`). `activationContextOf(context): Promise<ActivationContext>` builds it once, at the top of
   `activate`. It is the function today's first lines become.
2. **One module per feature** in `src/activation/`, each exporting one function that takes the `ActivationContext`
   and, where needed, the setup's result (`ServedActivation`), and returns a `vscode.Disposable` or nothing:

   | Module | Moves from `extension.ts` |
   |---|---|
   | `connect-feature.ts` | `registerConnectOf`, `editorProfile`, `dataFolderNameOfEditor`, `acceptanceWindowName`, `recordAuthority`, `acceptanceResolverEditorOf` |
   | `companion-feature.ts` | the `createProtocol` and `serveSliceEndpoints` block, and `configuredHosts` |
   | `config-file-feature.ts` | the `openConfigFileHandler(...)` construction passed to the setup |

3. **`activate` becomes a short, linear list:** build the context; run the setup with the config-file handler; return
   if not serving; push the result's disposal; then one call per feature, each pushing its disposable.
4. **A new feature card** adds a module and one call line, at the end of the list. A value several features need joins
   `ActivationContext`, so no card reorders `activate`.
5. **Coverage:** each module imports `vscode`, so it joins `extension.ts` in `coverage.json`'s exclusions with the
   same reason, `loads the editor`. Its logic stays in the covered modules it calls, as today.

**What this doesn't remove:** two cards that each add a feature in the same window still both append one call line at
the end of `activate`. That's a one-line conflict, which `git` often resolves, instead of interleaved edits in the
middle of a 120-line function. A generated registry isn't worth it here: the order of the calls matters (the connect
registration before the companion endpoints, which read its active connection).

## 3. Gates and review

All gates, with `pnpm test:unit` row counts equal before and after. The acceptance runs don't change, but run the
`windows` launch once filtered, as a smoke test of activation, and paste it. PR title `remote-ssh: activation composes
feature modules, and the wiring rows split by step (card tooling-40, #800)`. Request athena only.

## 4. Land when

Most remote-ssh product branches touch `extension.ts` or `wiring.test.ts`. Land it right after a quiet window, and tell
hermes the moment it merges. An in-flight branch resolves like this:
- a block it added to `wiring.test.ts` moves to the step's new file;
- an edit to `activate` moves into the feature module it belongs to, or a new one.

## 5. Open rows (stop and report on #800)

1. A feature block in `activate` reads a value the setup produces in a way that can't pass through `ServedActivation`
   or `ActivationContext`. Name it.
