# Task card tooling-41: locale string tables are generated from the default tables

Issue: #801. Release 0.2 (gate throughput). From athena's brief, family 1. Size: M (about 2 agent-days). Builder:
unassigned (task:claude). Track D: tooling-43 (#803) lands after this one, because both touch `strings.test.ts` and
`tools/string-tables.ts`. The data is in tooling-38 §0: each of remote-ssh's 15 `l10n/bundle.l10n*.json` files
changed on both sides of 4 merges (hermes: #594, #647, #651). Every new string touches all 15, and every new manifest
key touches the 15 `package.nls*.json` tables.

## 1. The rule that requires complete locale tables

The rule is the specs', and it stays:
- **F-2002 BR-3** (remote-oss/remote-ssh#12): "The reimplementation ships the same 14 languages, every file holding
  every key of its English table."
- **F-4003 BR-6** (remote-oss/remote-ssh-edit#16) says the same for remote-ssh-edit, and **F-5001 AC-16** for
  remote-explorer's runtime strings.
- `tools/string-tables.ts` enforces it, and its header names it ("each locale has … exactly the keys of …").

athena's first option, letting a locale table miss keys and relying on `vscode.l10n`'s fallback to the source text,
would break BR-3. So the locale tables are generated. Only the sources are written by hand.

**The translations today:** remote-ssh and remote-explorer have none. Every one of their locale tables is an exact copy
of the English default (checked: 0 differing values). remote-ssh-edit has real translations for its two runtime keys
(F-4003 §3.4's table). Its manifest tables are English copies.

## 2. The layout after

In each extension package that ships locales: remote-ssh, remote-explorer, remote-ssh-edit, and remote-containers.
containers-01 has merged, so remote-containers has 14 nls tables and 14 bundles, all byte-identical to its defaults.

| File | Who writes it | In git |
|---|---|---|
| `package.nls.json` | by hand | yes |
| `l10n/bundle.l10n.json` | by hand | yes |
| `translations/<locale>.json` | by hand, only when the locale has a translated text: `{"manifest": {<key>: <text>}, "runtime": {<key>: <text>}}`, either part optional | yes |
| `package.nls.<locale>.json` | `tools/locale-tables.ts` | no (`.gitignore`: `packages/*/package.nls.*.json`) |
| `l10n/bundle.l10n.<locale>.json` | `tools/locale-tables.ts` | no (`.gitignore`: `packages/*/l10n/bundle.l10n.*.json`) |

Neither `.gitignore` pattern matches the default tables: `package.nls.json` and `bundle.l10n.json` have no second dot
before `.json`.

**The rule of the generator:**
- for each locale of the package's `identifiers.json` `locales`:
  - `package.nls.<locale>.json` is every key of `package.nls.json`, with the value of `translations/<locale>.json`'s
    `manifest` entry when there is one, else the English value;
  - `l10n/bundle.l10n.<locale>.json` is the same over `l10n/bundle.l10n.json` and `runtime`.
- Keys keep the default table's order.
- Files are written as Prettier writes JSON, so `format:check` passes, or Prettier ignores them (`.prettierignore`,
  next to the generated identifier tables). The builder chooses, and says which.

**remote-ssh-edit has no default runtime bundle today.** It gains `l10n/bundle.l10n.json`, with its two keys mapped to
themselves. That's the same form remote-ssh's default bundle has. string-tables' branch for "a package that ships no
default bundle" is then dead, so it goes. The 14 current bundles' German, French and other texts move into
`translations/<locale>.json` under `runtime`, unchanged.

## 3. The tools

- **`tools/locale-tables.ts`, new:**
  - `node tools/locale-tables.ts` writes every package's locale tables;
  - `--check` fails on a stale or missing generated file, on a translation key that the default table lacks, on an
    empty translated text, and on a translations file for a locale outside `locales`.
- **`package.json` scripts:**
  - the `identifiers` script becomes `node tools/identifiers.ts && node tools/locale-tables.ts`;
  - every script that runs `node tools/identifiers.ts` first (`typecheck`, `lint`, `build`, `test:unit`, `dead`,
    `check-consumed`, `coverage`, `coverage:update`) runs `pnpm -s identifiers` instead. So tests, packaging and editors see
    complete tables after any run.
- **CI needs no workflow change.** `ci.yml` already runs `pnpm identifiers` before `check-layout`,
  `check-public-surface` and the check matrix (lines 81 and 125). The other jobs run `pnpm build`, directly or
  through `pnpm package`. So the generator runs before every reader, and proteus has nothing to change. If the build
  finds a job that reads tables before either step, that's §8 row 1.
- **`tools/check-layout.ts`** runs `checkStringTables` in-process (lines 141–143 and 228), so it relies on the tables
  being generated. The CI step order above guarantees that. Locally, `pnpm check-layout` becomes
  `pnpm -s identifiers && tools/check-layout`.
- **`tools/public-surface.ts`** adds `translations` to `PACKAGE_FOLDERS`, so the hand-written translations (today
  remote-ssh-edit's 14 runtime texts) are scanned for banned words. The generated tables are scanned as before, after
  `pnpm identifiers`.
- **`knip.jsonc`** adds `tools/locale-tables.ts!` to the root workspace's entries.
- **`check-string-tables`** becomes `node tools/locale-tables.ts && node tools/string-tables.ts`. string-tables'
  parity checks stay, and they now check the generator's output: a generator bug fails them.
- **`pnpm package`** runs `build`, so the VSIX holds the generated tables, through `.vscodeignore`'s existing
  `!package.nls*.json` and `!l10n/**`.

## 4. Rows

- **Tools rows** (`tools/locale-tables.test.ts`, at 100 %):
  - a package with one translated runtime key for `de` gets `de`'s bundle with that text and every other key in
    English, while `fr` is all English;
  - a manifest translation lands in `package.nls.de.json` only;
  - key order follows the default;
  - `--check` with a stale file, an unknown key, an empty text and an unknown locale reports one problem each;
  - a package without `l10n/` gets no bundles.
- **`tools/string-tables.test.ts`:** the no-default-bundle rows go with the branch, and the rest are unchanged.
- **The existing package rows that read locale tables keep passing over the generated files**, because `test:unit`
  generates first:
  - remote-ssh `strings.test.ts`'s locale row;
  - remote-explorer `manifest.test.ts` F-5001 AC-16 and its nls row;
  - remote-containers `manifest.test.ts`'s F-1406.5 rows (its nls tables per locale, and its bundles);
  - remote-ssh-edit `identity.test.ts`'s nls row.
- **A new row in remote-ssh-edit** (`test/unit/identity.test.ts`), `F-4003 BR-6: each locale's runtime bundle holds
  its translated texts`: for each of the 14 locales, the generated `l10n/bundle.l10n.<locale>.json` holds the two
  texts of F-4003 §3.4's table, verbatim. No row covers those translations today; this one proves the move into
  `translations/` for good, beyond §5's one-off comparison.

## 5. The migration, in one PR

1. Generate, and compare every generated file byte for byte with the committed one it replaces. They must be equal,
   apart from formatting if Prettier ignores them. Paste the comparison.
2. Delete the committed locale tables (`git rm`): 28 in each of remote-ssh, remote-explorer and remote-containers,
   and 28 in remote-ssh-edit. Add the `.gitignore` lines, the `translations/` folders, and remote-ssh-edit's default
   bundle.
3. **Docs:** `docs/architecture/l3/windows-and-explorer/components.md`'s `identifiers.string-tables` row gains one
   sentence: the locale tables are generated from the default tables and `translations/`. Open cards that still say
   "and the 14 locale bundles" are read as "the default bundle" from now on, and hermes tells their builders.

## 6. Land when

Any branch that adds a string touches the 15 files. Land it right after a quiet window, and tell hermes the moment it
merges. An in-flight branch resolves like this:
- **Locale files it edited:** git reports modify/delete for each one. The author `git rm`s them all, keeping only the
  default-table additions.
- **A new remote-ssh-edit runtime key with translations:** its texts go into `translations/<locale>.json` too.
  Without translations, it's in the default table only, as for every other package.

## 7. Gates and review

All gates, plus a `pnpm package` and `unzip -l` of the remote-ssh VSIX listing the 14 locale bundles and tables. PR
title `tools: locale string tables are generated from the default tables (card tooling-41, #801)`. Request athena
only. athena checks §1's reading of BR-3: the rule is about what ships, so generating satisfies it.

## 8. Open rows (stop and report on #801)

1. Something reads a locale table from the source tree without a generating script having run before it: a CI job, a
   tool, or the conformance runner. Name it.
2. A row or a rule requires remote-ssh-edit to ship no default runtime bundle. Report it, and keep the package's
   translations as the generator's key source instead.
