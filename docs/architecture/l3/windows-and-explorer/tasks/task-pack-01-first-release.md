# Task card pack-01: the Extension Pack's package for its first release (manifest, bundles, README, packaging)

Issue: #1158. Release: the pack's first release, with Dev Containers and Remote - SSH (D-90). Size: M. Builder: `task:claude`.
Specs, all `spec:reviewed`, in remote-oss/remote-extensionpack (read them with plain `gh issue view <n> -R
remote-oss/remote-extensionpack`):
- **F-9901 (#10):** identity, member list, publishing rule, README outline.
- **F-9001 (#5):** package data; BR-4 description, BR-5 keywords, BR-6 bundles, BR-7 engine.
- **F-9002 (#6):** listing and README.
- **F-9101 (#7):** members and install.

The package is code-less (R-62): no `main`, no activation event, no contribution. This card builds the package and
its static rows. Install and gallery behaviour (F-9101's install flows, F-9001 and F-9002's Extensions-view rows) is
a later acceptance card, and so is publishing to Open VSX.

## Amendment (athena's rulings on #1166, 2026-10-20; D-56, D-59)

This block overrides the lines marked *superseded* below; they stay for the record.
- **Repository and issues.** F-9001 AC-6 and F-9901 AC-15 were republished with D-56's URLs: `remote-oss/remote.git`
  with a `directory`, and `remote-oss/remote/issues`. Ours matches the spec, so that's no deviation and has no
  notes entry. The rows assert the spec as it is, with no `(ruling-d56)` label.
- **Descriptions are English in every bundle** (D-56: English in every locale now, reviewed machine translation before
  the first public release, as every member ships). The 13 language bundles and `qps-ploc` carry BR-4's English
  sentence. The localized **display names** stay verbatim from F-9001 3.3 (D-41a). This is a deviation from F-9001
  3.3, BR-4 and AC-4: an entry in `pack-release-1-notes.md`. Athena's spec question is on
  remote-oss/remote-extensionpack#5.
- **The README has no affiliation sentence** (D-56: no affiliation or trademark notice anywhere; D-59(1): the public
  surface stands on its own). It contains neither the word "Microsoft" nor "reference", and no feature ids (no
  `F-9xxx`, the maintainers table included). The factual install advice stays, worded without naming another
  publisher: packs that list other extensions' ids don't install these, install one pack and not both, and the
  family's extensions stand down beside the extensions they reimplement. This is a deviation from F-9002 BR-3's first
  half and AC-7: an entry in `pack-release-1-notes.md`. Athena's spec question is on remote-oss/remote-extensionpack#6.
  Any row that asserted BR-3's sentence asserts ours instead.
- `pack-release-1-notes.md` therefore holds exactly two deviation entries: the English descriptions and the README's
  missing affiliation sentence.

## 1. What's on main

`packages/remote-extensionpack/` holds a placeholder `package.json` (name `vscode-remote-extensionpack`, version
0.0.0, `private`, MIT, `repository` of the monorepo), a stub `README.md` and the two tsconfigs.
`tools/repository.ts` already maps the folder to its manifest name. `tools/package-extensions.ts` refuses a manifest
with no built `main`, so the pack can't be packaged yet.

## 2. `package.json` (F-9901 identity card and "Structure kept verbatim"; F-9001 3.3)

Exactly these fields; drop the placeholder's others:
- `name` `vscode-remote-extensionpack`, `displayName` `%displayName%`, `description` `%description%`.
- `version` `0.1.0`: the family's current manifest version, which the release process bumps. It never claims the
  reference's history.
- `publisher` `remote-oss`, `license` `MIT`, `private` `true` (as the members have).
- `engines.vscode`: the ADR-0007 root constant. Read how the members get `^1.139.0` and what the layout check
  verifies, and use the same mechanism, not a literal of its own if there's a shared source.
- `categories` `["Other", "Extension Packs"]`, in this order. `extensionKind` `["ui"]`.
- `keywords` `["remote", "remote development", "extension pack", "open source", "dev containers", "ssh"]` (BR-5,
  first release).
- `extensionPack` `["remote-oss.remote-containers", "remote-oss.remote-ssh"]`, in this order (D-90 member list,
  first release). Never a Microsoft id, never `remote-oss.remote-wsl` or `remote-oss.remote-server` in this release.
- `repository` `{"type": "git", "url": "https://github.com/remote-oss/remote.git", "directory": "packages/remote-extensionpack"}`
  and `bugs` `{"url": "https://github.com/remote-oss/remote/issues"}`, as every member has them. This is
  athena's ruling on #1158 (comment 6283610363, after D-56). F-9001 AC-6 and F-9901 AC-15 name the spec repo
  `remote-oss/remote-extensionpack` instead, so they're a deviation: a row asserts ours (§6), and an entry goes in
  the release notes (§7a). Athena has put the spec question on remote-extensionpack #5 and #10. *(superseded: see "Amendment")*
- No `icon`. D-41 and D-56 already decided the family's icon (an original `>_` design, still to be made), and
  packages ship without one until it exists (athena on #1158). F-9901 AC-1 stays `todo`.
- No `main`, `activationEvents`, `contributes`, `pricing` (F-9002 AC-17), `enabledApiProposals` or `scripts` that ship.

## 3. String tables (F-9001 BR-4, BR-6, 3.3; F-9901 "Localized display names")

- `package.nls.json`: `displayName` "Remote Development"; `description` exactly "An extension pack from the remote-oss
  project that installs the Dev Containers and Remote - SSH extensions together."
- The 14 bundles `package.nls.<l>.json` for cs, de, es, fr, it, ja, ko, pl, pt-br, qps-ploc, ru, tr, zh-cn, zh-tw:
  - `displayName` is **verbatim** the value of F-9001's 3.3 table for that language. Copy it from the spec, character
    for character.
  - *(superseded: see "Amendment")* `description` is your own translation of the English sentence. It names "remote-oss", and keeps "Dev Containers"
    and "Remote - SSH" as the members' display names, untranslated. It must be non-empty, differ from the English,
    and differ from the reference's description for that language (F-9001 3.3's second table). *(superseded: see "Amendment")*
  - *(superseded: see "Amendment")* `qps-ploc`'s description is the English sentence pseudo-localized by the reference's substitution (each Latin
    letter an accented or look-alike character, length and word order kept, as "Rëmøtë Ðëvëløpmëñt").
- No `l10n/` folder. `pnpm check-string-tables` must pass. If it needs a rule for a package with no `l10n/`, the
  members' existing case shows the way.

## 4. `README.md` and `LICENSE` (F-9002, F-9901 "README outline", "Coexistence", "Telemetry")

- Write the README to F-9002's rules: §5 and BR-1 to BR-14, its AC-6 to AC-16 and AC-23, and F-9901's outline. In
  short:
  - **Opening:** the title names "Remote Development". The pack and its members are the `remote-oss` project's, not
    Microsoft's. *(superseded: see "Amendment")*
  - **Members:** exactly the two members, each with a one-line purpose and a link to its own README. Remote Explorer
    and "Remote - SSH: Editing Configuration Files" come through the members' packs. WSL and Remote - Tunnels are each
    "not part of this release", with no promise or date.
  - **Install:** installing both packs is unsupported (install one, not both), and the family's extensions stand down
    next to Microsoft's. *(superseded: see "Amendment")*
  - **Reference sections:** requirements with the lowest supported editor version, a getting-started list, and a
    release-notes link.
  - **Statements:** neither the pack nor its members collect telemetry, and the licence is MIT.
  - **Links and images:** every link is absolute `https:` or `mailto:`, with no editor-scheme link and no `aka.ms` or
    Microsoft URL. Images only if they have an `https:` URL in a `remote-oss` repository; use none if none exist.
  - **No borrowed text:** no sentence of the reference's readme.
  - Keep tables narrow enough that none needs horizontal scrolling (BR-14).
- Point the README's project links at the same repository as `repository` and `bugs` (§2):
  `https://github.com/remote-oss/remote/tree/main/packages/remote-extensionpack` for the pack, the members' own
  folders for their READMEs, and `https://github.com/remote-oss/remote/issues` for issues.
- `LICENSE`: the repository root's `LICENSE` (MIT, "remote-oss contributors"), copied into the package folder.
  There's no `ThirdPartyNotices.txt` and no `LICENSE.txt`.
- `.vscodeignore`: `**`, then `!package.json`, `!package.nls*.json`, `!README.md`, `!LICENSE`. The VSIX's file list
  is then exactly F-9901 AC-14's (no icon yet).
- The maintainers table at the end of the README stays (the members have one too). Update it: features F-9001, *(superseded: see "Amendment")*
  F-9002, F-9101 and F-9901; components none; allowed imports none.

## 5. Packaging (`tools/package-extensions.ts`)

- A **code-less** manifest has an `extensionPack` and no `main`. It's packaged without the built-main check. In the
  no-arguments selection, a folder is chosen when it has `dist` (as now) **or** its manifest is code-less. Keep the
  `node_modules` check for both.
- Rows in `tools/package-extensions.test.ts`: a code-less manifest is packaged; a manifest with neither `main` nor
  `extensionPack` still fails with today's message; the no-arguments selection includes the code-less folder.
- Check that `tools/package-view.fixture.ts`'s line `remote-extensionpack: no src/extension.ts, skipped` (the build's
  view) still holds, since the build has nothing to bundle.
- `pnpm package` writes `dist/vscode-remote-extensionpack-0.1.0.vsix`. List its contents (`npx @vscode/vsce ls` in
  the folder) in the PR.

## 6. Rows: `packages/remote-extensionpack/test/unit/manifest.test.ts`

Read the package's own files, after the pattern of remote-ssh's `skeleton.test.ts` manifest block. One `it` per line,
each citing its criterion:
- `F-9001 AC-1`: the two placeholders and their English values.
- `F-9001 AC-2, F-9101 AC-2`: the categories, exactly.
- `F-9001 AC-3`: the keywords hold `remote development`, `dev containers` and `ssh`, have at most 30 entries, and
  aren't the reference's eight.
- `F-9001 AC-4, F-9901 AC-10`: exactly the 14 bundles and `package.nls.json`, no `l10n/`. Each bundle's
  `displayName` is the table's, each language `description` is non-empty and differs from the English and from
  the reference's, and `qps-ploc`'s differs from the English. Put the two reference tables in the test file as *(superseded: see "Amendment")*
  constants, copied from F-9001 3.3.
- `F-9001 AC-5`: `engines.vscode` equals the ADR-0007 constant, from the same source the layout check uses.
- `F-9001 AC-6, F-9901 AC-15 (ruling-d56): repository and bugs are the monorepo's, as the members' are, and no URL is Microsoft's`. *(superseded: see "Amendment")*
  Assert `repository` and `bugs` exactly as §2, and no Microsoft-owned URL anywhere in the manifest or bundles. Use
  one regular expression for `microsoft.com`, `aka.ms`, `visualstudio.com` and `Microsoft/vscode`. In the coverage
  file, both criteria are `unit` with this row.
- `F-9001 AC-23, F-9101 AC-1, F-9901 AC-2`: `extensionPack` is exactly the two ids in order, and the description
  names exactly "Dev Containers" and "Remote - SSH", not "Remote Explorer".
- `F-9901 AC-4`: categories and `extensionKind` as the reference's; no `main`, `activationEvents` or `contributes`.
- `F-9901 AC-14`: the `.vscodeignore` keeps exactly the files of §4. Assert the patterns, not a VSIX.
- `F-9901 AC-16`: the keyword list is the project's (as AC-3), and `F-9901 AC-18`: display name and description as
  AC-1.
- `F-9002 AC-1, AC-17`: the root files, and no `pricing` (or `Free`).
- README rows, by reading `README.md` as text, one each:
  - `F-9002 AC-6, AC-7`;
  - `F-9002 AC-8, AC-23` (exactly the two member names, the "not part of this release" sentence for WSL and Remote -
    Tunnels);
  - `F-9002 AC-9`;
  - `F-9002 AC-10` (the editor floor named);
  - `F-9002 AC-11, F-9901 AC-7`;
  - `F-9002 AC-14, F-9901 AC-5` (every link absolute `https:` or `mailto:`, none Microsoft's, no `vscode:`-like
    scheme);
  - `F-9002 AC-15` (no image, or each `https:` in a `remote-oss` repository);
  - `F-9901 AC-8` and `F-9901 AC-13`: read those two criteria and assert what they ask of the README.
- If a criterion turns out to need the gallery or a running editor, leave it out and list it in the PR for the
  acceptance card.

The package gets a `test` entry wherever the test runner and the coverage tool list packages. Check how
`remote-ssh-edit` (a small package) is wired, and do the same. With no `src`, the coverage gate has nothing to
measure; check the tool doesn't fail on that, and add the package to its exclusions only if it must.

## 7a. Release notes

New file `docs/architecture/l3/windows-and-explorer/pack-release-1-notes.md`, with the same header and sections as
`docs/architecture/l3/containers-engine/release-1-notes.md`. One deviation entry, worded for users: the pack's
Repository and Issues links lead to the project's repository (`remote-oss/remote`), where the family's extensions are
developed together. Then its cite line: F-9001 AC-6 and F-9901 AC-15 name `remote-oss/remote-extensionpack`
(athena's ruling on #1158, after D-56; spec question on remote-oss/remote-extensionpack #5 and #10). *(superseded: see "Amendment")*

## 7. Coverage

The pack's features aren't in any coverage file yet. Seed a `docs/architecture/catalogue/coverage-extensionpack-r1.tsv`
for F-9001, F-9002, F-9101 and F-9901, the way coverage-44 seeded slice 2 (`tools/spec-acceptance-criteria.ts` and
`tools/check-coverage.ts`). Mark the rows above `unit`, F-9901 AC-1 `todo` (the icon, D-41 and D-56), and the rest `todo`.
`node tools/check-coverage.ts` must pass. If adding a coverage file needs a decision the tools don't already make
(its release name, its list), stop and ask daedalus on this issue.

## 8. Done when

- The new rows and the tools rows pass. `pnpm test`, `pnpm check-string-tables`, the layout check (`tools/check-layout`),
  the whole diff linted, `jscpd`, `knip` and `check-coverage` are clean.
- `pnpm package` writes the VSIX. Show its contents in the PR.
- PR title: `remote-extensionpack: the code-less pack of the first release, with its bundles, README and packaging (card pack-01, #1158)`.
  Request athena only.
