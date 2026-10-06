# Coding brief: lib-wsl, pure parts (first coding target from area D)

Status: draft by `remote-architect-worker-4` for `remote-architect`, 2026-10-06, to be reviewed and issued to a
coding worker.
- Design: `components.md` (D1a, D2, D3) and `contracts.md` §1.
- ADRs: 0002, 0003, the drafts "wsl.exe channel" and "Distro and path model".
- Everything here is pure TypeScript with no `vscode` import and no process, network or file access. It is tested
  with Mocha alone, against fixtures, before any Windows host exists.
- The process part of D1, the D4 channel and the spawner fake are the second brief. They need area A's revised H1
  (PR #27) on main and the H1 contract suite.

## What is built

| Piece | Where | Content |
|---|---|---|
| Decoder | `packages/lib-wsl` | `decodeManagementOutput(bytes)`: UTF-16LE with or without a byte-order mark, or UTF-8 when WSL was told to print UTF-8 (`WSL_UTF8=1`, Microsoft WSL docs); detection from the bytes, never from a flag; CRLF and stray NUL characters normalised |
| D1a parser | `packages/lib-wsl` | `parseList`, `parseOnline` and `parseStatus` per contract D1a, returning records or `unparseable` |
| D2 pure core | `packages/lib-wsl` | `matchDistro(rows, typedName)` → `{registeredName, version, isDefault}`, `distroUnknown`, or `noDistro`. Also `filterDockerDesktop(rows)`, `multiDistroAllowed(windowsBuild)`, `windowsBuildFromRelease(osRelease)`, `sortOnlineCatalogue(rows)` and `installCommandLine(name)` |
| D3 pure core | `packages/lib-wsl` | `shareToDistro(windowsPath)` for `\\wsl.localhost\<d>\…` and `\\wsl$\<d>\…`. `distroToShare(distro, linuxPath)` emits `wsl.localhost` only. `isWindowsMountShape(linuxPath)`. `parseWslpathOutput(text)` for the one process call that the next brief adds |
| URI helper | `packages/lib-wsl` | `remoteFolderUri(distro, linuxPath, outerAuthority?)` → `vscode-remote://wsl+<d>[@<outer>]<path>`, built with B's `wsl` codec from `lib-authority` if it is on main, otherwise a test pins the expected strings for the later switch (question 3) |
| Kinds | `packages/lib-wsl` | The closed kind list of contract D1 as a type and constants, with no behaviour yet |

## Behaviour to get right (each a named unit test)

- **Decoding:**
  - UTF-16LE with a BOM;
  - UTF-16LE without a BOM;
  - UTF-8;
  - CRLF line ends;
  - a trailing NUL;
  - an empty output (no distro) → zero rows.
- **List parsing** (contract D1a; F-6201 §16, F-6302 BR-1):
  - the default marker `*` in front of one row;
  - names with spaces, dots, dashes and non-ASCII letters;
  - states Running, Stopped, Installing and Converting mapped, and anything else → `other`;
  - version `1`, `2` or missing → `unknown`;
  - a localised header: columns are found from the layout and the marker, never from the English header words
    (question 2);
  - a header-only output → zero rows.
- **Online parsing** (F-6102): NAME and FRIENDLY NAME pairs, friendly names with spaces, the leading explanatory lines
  skipped.
- **Matching** (F-6201 BR-1, 6.7, 6.8, 7.E1; F-6402 BR):
  - case-insensitive, returning the registered spelling;
  - the empty name → the default row;
  - an empty name with no default row → `noDistro`;
  - no match → `distroUnknown` carrying the name as typed (for STR:S053);
  - two registered names that differ only in case → the exact-case match wins, else `distroUnknown`. This is a design
    choice, recorded as question 4.
- **Docker Desktop** (F-6701 BR-3): `docker-desktop` and `docker-desktop-data` are removed unless asked for.
- **Old builds** (F-6103 BR-2, 7.E3): build 18362 or newer → true; below 18362 → false; unknown → true.
  `windowsBuildFromRelease('10.0.17763')` gives 17763.
- **Online catalogue order** (F-6102 BR-2): by friendly name, ignoring case, digits compared as text ("Ubuntu 20.04"
  before "Ubuntu 4" when the text says so).
- **Install line** (F-6102 BR-3): exactly `wsl.exe --install -d <NAME>`, using the internal name, never the friendly
  name. Names are validated against WSL's name characters so that nothing can be injected into the terminal line.
- **Share paths** (F-6204 BR-1, F-6207 BR-3):
  - both share hosts in, case-insensitive host and distro;
  - `wsl.localhost` only out;
  - spaces and non-ASCII characters kept;
  - a root share → `/`;
  - a non-share path → `notShare`.
- **Mount shape** (F-6206 R1): `/mnt/c/x` → true; `/mnt/c` → true; `/mnt/cd/x` → false; `/win/c/x` → false.
- **URIs:** round trip through the codec for a plain distro, a distro with spaces, and a nested
  `@ssh-remote+<host>`.

## Fixtures

Kept under `packages/lib-wsl/test/fixtures/`, each file with a header naming its source.

- The clean side has no Windows host and may not use lab material (AGENTS.md). The fixtures are therefore
  **constructed**, not recorded. Their sources are the field lists in Microsoft's public WSL documentation
  (`basic-commands.md`: names, state, version, the default, the online NAME and FRIENDLY NAME columns) and the
  published remote-wsl specs. Each fixture says "constructed" and names the document and section it follows.
- Files are stored as the raw bytes `wsl.exe` would produce: UTF-16LE with and without a BOM, plus one UTF-8
  variant.
- Distro names in fixtures are invented (`fixture-alpha`, `Fixture.Beta-2`, `fixture γ`), except `docker-desktop`,
  which F-6701 names.
- **Replacement:** once a clean Windows runner exists (the lead's infrastructure item), each constructed fixture gets
  a recorded twin from that runner. A test then runs both. A difference is a parser bug or a fixture bug, never a
  reason to edit the recorded file.

## Dependencies

- `lib-host`: none in this brief. `lib-log`: none: the pure functions return values and diagnostics.
- `lib-authority`'s codec, if merged. Otherwise the URI helper waits (question 3).

## Done

- ADR-0003 gates green; every test is named after the rule or AC it proves.
- `tools/check-layout` passes with the new package: the folder, the manifest and the allowed edges from L2.
- No conformance case runs against these parts alone. F-6201, F-6204, F-6102, F-6103 and F-6701 prove them later
  through remote-wsl on a Windows profile.
- The PR answers R1 to R6.

## Open before coding (through the lead)

1. **Who creates `packages/lib-wsl`.** The skeleton (manifest, tsconfig, Mocha setup) per `layout.md`, by the lead as
   for the other libraries, or by the coding worker as the PR's first commit.
2. **Localised `wsl.exe` output.** WSL prints its management text in the Windows display language, so the header
   words and state words vary. The parser above does not depend on the header. Two further steps I propose for D2:
   - read the states with `--list --running --quiet` (names only, no localised text) and the versions from the last
     column of `--list --verbose`;
   - admit WSL's own MIT-licensed source (`microsoft/WSL`) as an allowed source `[wsl]` for its output formats and
     message ids, like `[cli]` under R-76.

   The second is a change to what the clean side may read, so it goes to the register.
3. **The URI helper and B's codec.** Depend on `lib-authority` now, or keep the helper's strings pinned and switch
   when the codec lands. I recommend switching, so that the authority string is never built in two places.
4. **Case-only duplicates.** WSL registers names case-insensitively, so two names differing only in case should not
   exist. The rule in the tests (exact case first, else `distroUnknown`) is defensive. Confirm, or drop the test.
5. **Placement of the two WSL scripts.** L2 §2 puts the relay and `wslCode.sh` in `lib-wsl`; `components.md` puts them
   in the `remote-wsl` package (D5r, D8). Either works. `lib-wsl` is the better home for the relay, because containers
   may relay into a distro too; `wslCode.sh` belongs to the `remote-wsl` VSIX, since the launcher looks it up there.
   This is not part of this brief; it is recorded for the second.
