# Task card tooling-31: CI fails on a contributed setting, command or view that no code consumes

Issue: #674. Tooling (R-99), not 0.2-gating. Design: athena, register 3289d3d (2026-10-13). Size: M. Builder: assigned by
hermes.

## 1. Why

`remote.SSH.localServerDownload` was declared in remote-ssh's manifest and never read, so two of its three values did
nothing (connect-38, #672). An audit after it found more of the same:
- **Settings with no consumer:** `enableAgentForwarding`, `enableX11Forwarding`, `defaultForwardedPorts`,
  `experimental.enhancedSessionLogs` and `suppressWindowsSshWarning`.
- **Modules only tests import:** `packages/remote-ssh/src/environment/agent-link.ts` and `display.ts`. knip passes
  them today because test files are knip entries.

No gate catches this: `check-identifiers` checks the manifest against the declared identifiers, and `dead` (knip) checks
exports reachable from entries that include tests.

## 2. The rules (athena)

- **R1. Tables, not manifests.** The check reads the generated identifier tables (`packages/<x>/src/identifiers.generated.ts`,
  written by `tools/identifiers.ts`), never raw manifest strings. A table key is the generated name, for example
  `externalSSHAskpass` for `remote.SSH.externalSSH_ASKPASS`. A raw grep for the id misses that.
- **R2. What "consumed" means.** An entry counts as consumed when a **production** source file of the same package
  references its generated name. A production source is a `.ts` file under `packages/<x>/src/`, other than
  `identifiers.generated.ts`, `*.test.ts` and `src/testing/**`. By kind:
  - **`settings`:** a reference to the key (§3.2);
  - **`commands`:** the package passes its `commands` table to lib-identifiers' `registerCommands`. That call's typed
    handler map (`{readonly [Name in keyof Commands]: CommandHandler}`) makes a missing handler a type error, so every
    key of a table passed there counts as registered. A table that's never passed to `registerCommands` leaves every
    key unconsumed;
  - **`runtimeCommands`, `internalCommands` with role `served`, `contextKeys` with setter `extension`:** a reference
    to the key (§3.2);
  - **`views`:** a reference to the key inside the argument list of a call to a function named `createTreeView`,
    `registerTreeDataProvider` or `registerWebviewViewProvider`, directly or on any object (an editor port of that
    name counts);
  - **menus and keybindings** aren't table kinds. Each one names a command, so it's consumed through that command. The
    check doesn't report a menu or keybinding entry of its own. If its command is unconsumed, the command's line
    reports it once;
  - **not checked:** `authorities`, `languages`, `standDown`, `enabledApiProposals`, `internalCommands` with role
    `called`, and `contextKeys` with setter `core`. These are declared for the manifest or the editor, not for code to
    consume.
- **R3. One allowlist.** Each entry names the key, the card issue that wires it, and its slice. At a release tag the
  allowlist must be empty, except for entries whose slice is out of that release by a recorded decision.
- **R4. Dead modules are knip's.** Modules that only tests import are found by a **production-mode** knip run
  (`knip --production`, where test files aren't entries), filtered by the same allowlist. There's no second detector.

## 3. Changes

### 3.1 Files

| File | Change |
|---|---|
| `tools/identifier-consumption.ts` | new: `consumptionOf(root, folder)`, the analysis of §3.2, and `checkConsumption(root, allowlist, options)`, the report of §3.4 |
| `tools/identifiers.ts` | a third mode, `--consumed`, beside the default (generate) and `--check`. It runs `checkConsumption` and §3.3's knip run, prints §3.4's lines, and sets the exit code. `--consumed --release` is the tag run |
| `tools/unconsumed-allowlist.json` | new: the allowlist, §3.5 |
| `tools/identifier-consumption.test.ts` | new: the rows of §4 |
| `package.json` | the script `"check-consumed": "node tools/identifiers.ts && node tools/identifiers.ts --consumed"` |
| `knip.jsonc` | mark each production entry and project pattern with knip's production suffix `!` (for example `"src/extension.ts!"`, `"src/**/*.ts!"`), leaving test entries unmarked. The ordinary `pnpm dead` run is unchanged by this (knip ignores `!` outside `--production`). Check that by running `pnpm dead` before and after |
| `.github/workflows/ci.yml` | `- run: pnpm check-consumed` right after `- run: pnpm check-identifiers` (line 83). On a tag push (`push: tags: ['*-v*']`), the step runs `node tools/identifiers.ts --consumed --release` instead: use an `if:` on `github.ref_type == 'tag'` with two steps, or one step with a shell test, whichever the file's other steps do |
| `tools/README` or the tools section of the repository's docs, wherever `check-identifiers` is described | one paragraph: what the check reads, the allowlist, the release rule |

### 3.2 The analysis (TypeScript's checker, not text)

The check builds one TypeScript program per package from that package's `tsconfig.json`, with the `typescript` package
that's already a dependency, as `tools/check-workspace.ts` does. It then walks every production source file.

For a table `T` (an exported `const` of `identifiers.generated.ts`), a key `K` of `T` is **referenced** by:
1. **Member access:** a property access `x.K`, or an element access `x['K']`, where the type of `x` is `typeof T`. That
   covers `settings.logLevel`, an import alias, and a parameter typed `typeof settings`.
2. **A contextually typed key:** a string literal `'K'` (or a no-substitution template literal) whose **contextual
   type** is assignable to `keyof typeof T`, and which isn't itself a property name of an object literal. That covers
   remote-ssh's `valueOf(host, 'defaultExtensions')`, whose parameter is `entry: keyof typeof settings`. A string
   `'path'` in unrelated code has no such contextual type, so it doesn't count. This is the trap of a text search:
   `path` is a settings key.
3. **Property names in an object contextually typed by a mapped type over `keyof typeof T`.** That covers the
   `registerCommands` handler map. Only commands use it, and R2's `registerCommands` rule already decides commands, so
   this counts only for the other kinds.

These **don't** count:
- a whole-table use: `T` passed as a value, `Object.keys(T)`, `Object.values(T)`, `for … of`. Such a use is reported as
  a note (`whole table: packages/<x>/src/<file>:<line> uses <T>`) and consumes no key, except `commands` passed to
  `registerCommands` (R2). A settings dump that iterates the table, for example, proves nothing about any one key;
- a reference in `identifiers.generated.ts`, in a test file or under `src/testing/`;
- a reference in another package. Tables are package-local, and a library reads no extension's table.

### 3.3 The knip run

`knip --production --no-progress --reporter json`, run from the repository root with the marked `knip.jsonc`. Parse the
JSON, take every **unused file** under `packages/*/src/`, and drop the ones on the allowlist (kind `module`, §3.5). Each
remaining file is a problem (§3.4). Unused exports in production mode are **not** this check's: `pnpm dead` owns them.
If knip's JSON shape differs from what the code expects, the run fails with `identifiers: knip output not understood`,
never with a silent pass.

### 3.4 Output and exit codes

Lines, in this order (each prefixed `identifiers: `, as the tool's other modes):
1. one per unconsumed entry not on the allowlist: `packages/<x>: <kind> <key> (<id>) is contributed but no production
   source consumes it`, sorted by package, kind and key. For a module:
   `packages/<x>: module src/<path> is imported only by tests`;
2. one per allowlist entry whose key **is** consumed now:
   `allowlist: <package> <kind> <key> is consumed now; remove it (card <card>)`. A stale entry is a problem, so a wired
   setting leaves the list;
3. one per allowlist entry naming a package, kind or key that doesn't exist:
   `allowlist: <package> <kind> <key> names nothing`;
4. with `--release` only: one per allowlist entry without a `decision`:
   `allowlist: <package> <kind> <key> must be wired before a release (card <card>, <slice>)`;
5. the notes (whole-table uses), as `note: …`;
6. `consumed: ok` when there's no problem.

**Exit codes:** 0 with no problem lines; 1 with any; 2 when a package's program can't be built or the allowlist can't
be read (the message names which).

### 3.5 The allowlist

`tools/unconsumed-allowlist.json`:

```json
{
  "entries": [
    {
      "package": "remote-ssh",
      "kind": "settings",
      "key": "enableAgentForwarding",
      "card": "#<W4 issue>",
      "slice": "0.2 slice 2"
    }
  ]
}
```

**Fields:**
- `package`: the folder name;
- `kind`: a table name, or `module`;
- `key`: the table key (the generated name, not the manifest id), or, for a module, the path under the package
  (`src/environment/agent-link.ts`);
- `card`: the issue that wires it;
- `slice`: the release and slice it's planned for;
- `decision` (optional): the recorded decision that keeps it out of a release. An entry with a `decision` passes
  `--release`; every other entry fails it.

Unknown fields are an error (exit 2).

**The first allowlist** (athena):

| package | kind | key | card | slice | decision |
|---|---|---|---|---|---|
| remote-ssh | settings | `enableAgentForwarding` | `#<W4 issue: F-2311 terminal features>` | 0.2 slice 2 | — |
| remote-ssh | settings | `enableX11Forwarding` | `#<W4 issue: F-2312 terminal features>` | 0.2 slice 2 | — |
| remote-ssh | settings | `defaultForwardedPorts` | `#<W4 issue: F-2507 applyDefaults>` | 0.2 slice 2 | — |
| remote-ssh | settings | `enhancedSessionLogs` | `#674` | deferred | D-86 |
| remote-ssh | settings | `suppressWindowsSshWarning` | `#674` | deferred | D-60 |
| remote-ssh | module | `src/environment/agent-link.ts` | `#<W4 issue: F-2311>` | 0.2 slice 2 | — |
| remote-ssh | module | `src/environment/display.ts` | `#<W4 issue: F-2312>` | 0.2 slice 2 | — |
| remote-ssh | settings | `localServerDownload`, `allowLocalServerDownload` (two entries) | `#672` | 0.2 | — (only if connect-38 hasn't merged when this lands; otherwise leave them out) |

The deferred ones name this card as their card, because no wiring card exists while the decision holds.

**Before you write the list, run the check on main and compare.** If it reports an entry the audit didn't name, don't
add it to the list: report it on #674 with the check's line, and the lead cards it or adds it. The first list is
athena's, and the check's real output decides whether it's complete.

## 4. Rows

**Tools rows** (`tools/identifier-consumption.test.ts`, with `TemporaryWorkspace` packages that have a
`tsconfig.json`, an `identifiers.generated.ts` and `src/` files, as the other identifier rows build them):

| Cite | Given | Expected |
|---|---|---|
| #674 R2 | a settings table `{logLevel, path}`; `src/a.ts` reads `settings.logLevel` | `path` is reported, `logLevel` isn't |
| #674 R2 | `src/a.ts` has `function valueOf(entry: keyof typeof settings) {…}` and calls `valueOf('path')` | `path` is consumed |
| #674 R2 (trap) | `src/a.ts` has `const name = 'path'; join(name)` and no other use | `path` is reported |
| #674 R2 | `externalSSHAskpass` in the table (from `remote.SSH.externalSSH_ASKPASS`); `src/a.ts` reads `settings.externalSSHAskpass` | consumed, and the line names the id as written in the table |
| #674 R2 | the only reference is in `test/unit/a.test.ts`; then in `src/testing/fake.ts` | reported, both times |
| #674 R2 | `src/a.ts` does `Object.values(settings).forEach(…)` and nothing else | every key reported, plus one `whole table` note |
| #674 R2 | a commands table passed to `registerCommands(host, outcome, commands, handlers)` in `src/` | no command reported |
| #674 R2 | a commands table never passed to `registerCommands` | every command reported |
| #674 R2 | a views table `{remoteTargets}`; `src/a.ts` calls `editor.window.createTreeView(views.remoteTargets, …)` | consumed; the same key referenced only in a `const` that never reaches a registration is reported |
| #674 R2 | a `contextKeys` entry with setter `core`; an `internalCommands` entry with role `called` | neither reported |
| #674 R3 | an allowlist entry for a reported key | not reported; exit 0 |
| #674 R3 | an allowlist entry for a key that's consumed | `allowlist: … is consumed now; remove it (card …)`; exit 1 |
| #674 R3 | an allowlist entry for a missing key; one with an unknown field | `names nothing`, exit 1; exit 2 with the field named |
| #674 R3 | `--release` with one entry without `decision` and one with | one `must be wired before a release` line for the first only; exit 1 |
| #674 R4 | a stubbed knip runner returning a JSON report with an unused file `packages/x/src/m.ts`, with and without an allowlist entry for it | the module line, then none |
| #674 R4 | a knip runner answering text that isn't the expected JSON | `knip output not understood`; exit 1 |
| #674 | `checkConsumption(REPOSITORY_ROOT, <the committed allowlist>, {release: false})` with the real knip | no problem lines: the first allowlist covers main as it is |

The knip runner is a port of `checkConsumption` (`runKnip: () => Promise<string>`), so the tools rows don't start knip.
Only the repository row runs the real one.

**Mutations to run, and list in the PR:**
- making R2 rule 2 (contextual keys) count every string literal: the trap row fails;
- dropping the test-file exclusion: the test-only row fails;
- skipping the stale-entry check: the "consumed now" row fails.

## 5. Gates and review

All gates. `pnpm check-consumed` passes on the branch, and the CI step runs in the PR's checks. The new tools file is
at 100 %. PR title `tools: CI fails on a contribution no code consumes (card tooling-31, #674)`. themis or triton reviews;
athena gives the design check.

## 6. Open rows (stop and report on #674)

1. **The W4 issue numbers.** daedalus fills the `#<W4 issue>` placeholders in §3.5 with the numbers of the slice-2
   wiring cards (F-2311, F-2312 terminal features; F-2507 `applyDefaults`) before the build starts. If they're still
   placeholders when you start, ask daedalus.
2. **TypeScript doesn't give `valueOf('path')` the contextual type `keyof typeof settings`** in a case on main, for
   example through a generic wrapper. Report the call. Don't fall back to text matching.
3. **`knip --production` reports unused files outside the two modules,** or flags production entries the `!` marking
   missed. Report the list. Don't widen the allowlist by yourself.
4. **A package's commands are registered some other way than `registerCommands`** (a `vscode.commands.registerCommand`
   in `src/`). Report the call site: it's either a defect or a gap in R2, athena's call.
