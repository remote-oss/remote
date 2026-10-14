# Task card tooling-42: suite registration by glob, and the acceptance README split by topic

Issue: #802. Release 0.2 (gate throughput). From the data behind athena's brief, beyond her five families. Size: S–M
(about 1 agent-day). Builder: unassigned (task:claude). Track A: lands after tooling-38 (#798), which also edits the
README's launch paragraphs and the case files' `tsconfig` entries. The data is in tooling-38 §0:
`tests/acceptance/README.md` changed on both sides of 12 merges, and `knip.jsonc` of 6.

## 1. Why

Every new acceptance suite is registered by hand in four lists: `knip.jsonc`'s `tests/acceptance` entries,
`tests/acceptance/tsconfig.json`'s `include`, `eslint.config.ts`'s `TYPESCRIPT_PROJECTS`, and the root
`tsconfig.json`'s `references` (README "To add a launch"). It also gains a README section. Each of these appends at the
same spot as the next suite's.

## 2. Changes

1. **`knip.jsonc`:** the `tests/acceptance` workspace's `entry` becomes:
   - `"vscode-test.mjs"`, `"*/*.test.ts"` and `"suite/settle.ts"`, replacing the per-suite lines;
   - `"*/src/extension.ts"`, for `slow-remote` and `window-agent` and any later development extension.

   `project` is unchanged. `pnpm dead` must report the same as before; paste both runs.
2. **`tests/acceptance/tsconfig.json`:** `include` becomes `"${configDir}/suite*/**/*"` and
   `"${configDir}/*/src/**/*"`, replacing the per-folder lines.
   - The bare `"${configDir}/suite*"` matches no files (dike measured `error TS18003: No inputs were found`), so the
     `/**/*` is required.
   - The `cases.json` lines go: after tooling-38, no suite imports a case file.
   - **The check:** `tsc -p tests/acceptance/tsconfig.json --listFilesOnly` before and after must list the same files,
     less the removed `cases.json` files. Paste the difference. `tsc --build --listFilesOnly` isn't usable here; it
     gives `error TS5094`.
3. **`eslint.config.ts`:** `TYPESCRIPT_PROJECTS` lists `'./tests/acceptance/tsconfig.json'` and
   `'./tests/acceptance/*/tsconfig.json'`. That replaces `server`, `windows` and each plain suite's line.
4. **The root `tsconfig.json`'s `references`:** TypeScript has no glob here, so the list stays.
   - It's kept sorted by path. A new suite then inserts by name rather than appending at the end.
   - A new tools row, `tooling-42: the root tsconfig references every tsconfig under tests/acceptance, sorted`, runs
     over the repository in `pnpm test:unit`. It fails, naming the path, on a missing or unsorted reference.
5. **The README, split by topic:**
   - `tests/acceptance/README.md` keeps its introduction, "Writing a test" and "The run in VSCodium".
   - Each other `##` or `###` topic moves unchanged to `tests/acceptance/docs/<topic>.md`, in lower-case words joined
     by hyphens: `launches.md`, `server-lifecycle.md`, `record-and-log.md`, `several-windows.md`,
     `reading-the-window.md`, `ports-cases.md`, `install-cases.md`, `network-cut.md`, `host-variants.md`,
     `download-host.md` and `host-accounts.md`, plus any topic main has added by then.
   - The README ends with a "Topics" list of links, sorted by file name.
   - A new tools row, `tooling-42: every page under tests/acceptance/docs is linked from the README, sorted`, checks
     it.
   - "To add a launch" (now in `launches.md`) says the suite needs no registration beyond its `launch.json` and, for
     a plain suite, its `tsconfig.json` and the root reference.
6. **Links into the moved sections:** cards and docs that link to a README anchor (`grep -rn "acceptance/README.md#"
   docs tests tools`) are updated to the topic page.

## 3. Gates and review

All gates. The tools rows above are in `tools/` and at 100 %. `pnpm dead`, `pnpm typecheck` and `pnpm lint` report
the same before and after. PR title `tests, tools: suite registration by glob, and the acceptance README split by
topic (card tooling-42, #802)`. Request athena only.

## 4. Land when

After tooling-38, and right after a quiet window. Tell hermes when it merges.
- **A branch that registered a suite by hand:** takes main's lists, since its suite is matched by the globs. A
  plain suite keeps its root reference, in sorted place.
- **A branch that added a README section:** moves the section to a topic page.
- **A branch that edited a README section after tooling-38 changed it:** applies its edit to the topic page that
  section moved to. The section's text is unchanged by the move, so the edit applies as it was.

## 5. Open rows (stop and report on #802)

1. A glob takes in a file the old list left out on purpose, so the knip, tsc or ESLint output changes. Name the file.
