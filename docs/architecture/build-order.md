# Build order

Status: `remote-architect`, 2026-10-07, for release 0.2 slice 1 (project item #40) and slice 2 (#41). The slice
order lives in the project; this page gives the component order inside a slice and the acceptance harness.

Decisions since the first version: D-55 (2026-10-07) Remote - Tunnels is not built for now; D-56 the identity card is
approved (manifest updates and the icon as low-priority cards); D-65 an 8-row recorded gate for slice 1, pilot
F-2301 on Monday.

## Slice 1: connect to a Linux host over SSH with key authentication and open a folder

Feature rows (the PM's cut, confirmed against the area A and B matrices): foundation F-2001, F-3901, F-3903;
connect F-2101, F-2102, F-2201, F-2202, F-2301, F-2304, F-2305, F-2306, F-2307, F-2501, F-2601; server F-2401,
F-2403, F-2409, F-3902; open F-2502. One addition: F-2206 (remote platform decision, R4) is on the connect path of
every POSIX host and cannot be left out; it joins slice 1. F-2108 (pre-connection script) stays in slice 3: the
pipeline runs it only when the setting is set, and the default path does not touch it.

Component order, each step buildable and testable before the next exists:

| Step | Components | Package | Tests that gate it | Seat |
|---|---|---|---|---|
| 1 | H1 host channel, recording fake, contract suite | `lib-host` | unit; the suite against the fake | Claude (branch `feature/lib-host` exists) |
| 2 | P1–P4 profile, expander, resolver, product table | `lib-product` | unit with the VS Code, VSCodium and synthetic fixtures | Claude |
| 3 | The acceptance harness (below) | `tests/acceptance/` | runs one smoke case in CI | Claude |
| 4 | S1, S2, S4, S5, S6 pure parts | `lib-ssh` | unit against recorded fixtures (branch `feature/lib-ssh-pure` exists) | local workers (task cards), Claude reviews |
| 5 | lib-identifiers, lib-standdown | both | unit (PR 2 pending review) | Claude |
| 6 | lib-log | `lib-log` | unit | local worker (one card) |
| 7 | X1–X3 helper | `lib-helper` | unit; runtime against a fake endpoint | Claude |
| 8 | S3 spawner, S9 connection server, S10 ssh host channel | `lib-ssh` | the H1 contract suite against a real `sshd` container (harness) | Claude |
| 9 | V1 scripts, V2 probe, V3 planner, V5 locks, V6 gate, V4 transfer, V7 runtime | `lib-server` | unit against the fake channel; acceptance against the container (F-2401, F-2403, F-2409 ACs) | Claude; V1 script parsing and V3 planning as cards |
| 10 | Resolver host, `ssh-remote` codec, window opener, proposed-API gate, presenter | `lib-authority` | unit; harness for F-2501, F-2502, F-2601 ACs | Claude; the codec as a card |
| 11 | R1 pipeline, R2 diagnostics, R4 platform; ssh.package, connect-flows, resolver-front, failure-ui, window-surfaces | `remote-ssh` | acceptance: the slice's ACs end to end | Claude |

Slice 2 (terminals and forwarding): S7/S8 prompt UI and login terminal (F-2308), `lib-forwarding` (F-2104, F-2507,
F-2604, F-2410), terminal features (F-2106, F-2311, F-2312, F-2508); order: lib-forwarding, then S7/S8, then the
features.

Not in 0.2: F-2008 is a boundary note, not a feature to build; F-2606 is not built (F-3907); F-3907 is a decision;
F-2509 is built (option (a), B's window surfaces) but belongs to slice 3, not "not built".

## Slice 3: the pre-connection script, Open Web UI and fish hosts (athena, 2026-10-20, #1205)

Three features, and nothing else joins. The commands D-86 put in 0.2 (F-2204, F-2411, F-2412, `clearAllSessionHints`
of F-2605, F-2302, F-2303) are already in, by D-86 and `SLICE_ONE_FEATURES` (`coverage-slice1.tsv`). F-2605 beyond `clearAllSessionHints` stays out (D-86).
F-2606 and F-3907 stay as above.

All three specs are `spec:draft`. A card that seeds coverage or builds against a criterion waits for the spec's review,
so that the criterion ids it cites are final. The harness card (fish) doesn't wait.

**F-2108, the pre-connection script (P2): to build, replacing a stub.** `steps.preconnect` (`pipeline/connect.ts`,
bounded by `PRECONNECT_MILLISECONDS`) is wired to `pipeline/preconnect-step.ts` (`wiring.ts`). Today that step reads
the setting through `preconnectScriptFor` (`host-settings.ts`: one path or an alias map). It goes on when no script
applies, and fails with `preconnectFailed` and a log warning when one does, so no connect runs without the script the
user asked for. The card replaces that stub's failing branch with the runner. It keeps `preconnectScriptFor` and the
stub's tests for the no-script path, and adds no second step.
- *Component:* `ssh.preconnect-runner` in `remote-ssh` (catalogue). `ports.settings.preconnect` (`connect-ports.ts`)
  already supplies the setting's value, so a `PreconnectPorts` port adds only a file reader (content and executable
  bit), a process spawner and the approval memory. It needs no new library: the spawn goes through `lib-ssh`'s `ProcessSpawner` (`machine.spawner`), and the lines through
  `lib-log` with its masking.
- *Which script:* `remote.SSH.preconnect` as F-2108 resolves it: one path, or a map from host alias to path. That
  includes workspace-file and remote-folder settings and Restricted Mode (BR-15). The confirmation dialog is what
  guards a script someone else put in a folder's settings, so it must show for every script that isn't remembered,
  whatever layer named it (AC-32).
- *Approval memory:* "Allow and Don't Ask Again" remembers the path with the SHA-256 of the file's content, in
  `globalState`, never synced (`setKeysForSync` leaves it out). Changed content asks again, with the spec's changed
  message. Nothing else of the script is stored.
- *During the run:* F-2304's progress text "Running pre-connection script (show log)", and every output line in the log
  as `[preconnect] <line>`, masked like any line (R-26).
- *Outcomes:* Skip continues, and so does Cancel (F-2108 6.2, AC-10). A modal warning can't tell Cancel, Escape and the
  close button apart. Exit non-zero, no start, unreadable or not
  found go to F-2601's failure dialog with the spec's reason. The `PreconnectScriptFailure` row of the troubleshooting
  terminal is F-2605's, so its criteria are `deferred` with D-86's reason.
- *Rows:* unit on the alias map, the hash memory and every outcome. Acceptance in a launch with a local script fixture,
  where the scripted surface answers the dialog.

**F-2509, Open Web UI (P3): built** (card remote-ssh-16, option (a)). Slice 3 only seeds its criteria after the
review and tags them. A product change follows only where a row fails.

**F-2704's fish hosts (P2): harness first.** The host image gains its `fish` variant: a Dockerfile argument, as
planned above. A launch runs F-2704's login-shell rows against it, and the existing fish rows (#1103, `ruling-fish`)
move there. A product change follows only where a row fails. Coverage seeding waits for the review.

**0.2's recorded gate (D-63, D-65):** the eight slice-1 features of D-65 (F-2301, F-2304, F-2305, F-2306, F-2403,
F-2409, F-2601, F-2502) and F-2104 with slice 2. That's 9 features, recorded by the kit on pull when 0.2 reaches QA.
Slice 3 has no P0 feature, so it adds none. The other 11 P0 features are acceptance-tested only, as D-65 says.

## Acceptance tests and the harness (D-63)

Coding gate per slice: tests derived from the acceptance criteria, run in CI on Linux and locally. Release gate: a
small recorded set for the P0 rows (20 for 0.2), recorded by the kit on pull when the slice reaches QA.

The harness, `tests/acceptance/`:

- **Editor under test:** the recorded VS Code (1.139.1, ADR-0007; the floor 1.125 has its own smoke run) downloaded by `@vscode/test-electron` into a
  cache, started headless under `xvfb` in CI, with a fresh user-data and extensions folder per run, our VSIX
  installed by file, `--enable-proposed-api remote-oss.remote-ssh` passed on the command line (F-1403's argv route
  is what the product does; the harness is allowed the switch because it is not the product).
- **Target:** one Linux `sshd` container built from a public base image by a Dockerfile in `tests/acceptance/host/`,
  with a generated key pair per run, a non-root user with a POSIX `sh` login shell, no `bash` requirement, and
  `AllowTcpForwarding yes`; variants are Dockerfile arguments (a `bash` shell, a `fish` shell for slice 3). The
  harness writes a temporary `ssh_config` with `Host harness` pointing at the container and passes it through
  `remote.SSH.configFile`.
- **Driving the editor:** the extension-host test runner (`@vscode/test-cli`) runs the test code inside the editor
  so it can call commands, read the output channel through our own log adapter's test hook (a documented,
  harness-only environment variable, never in a VSIX path the user reaches), and observe window state through the
  API. Dialogs are observed by a harness UI adapter that the package installs only when that variable is set: it
  records what would be shown and answers scripted buttons. This is the one place a test hook exists, and it is an
  adapter swap, not product logic.
- **Assertions:** per acceptance criterion, named `F-xxxx AC-n`, observing: the resolved authority, the window's
  remote name, files and processes on the container (through `docker exec`), the log channel's lines by meaning,
  the dialog the adapter recorded.
- **What stays unit-level:** everything the pure components decide (argument lists, parsing, classification,
  planning); the harness proves the wiring and the host interaction.
- **CI environment:** GitHub Actions `ubuntu-latest` has Docker and `xvfb`; one job per slice; the recorded-case
  runner of the kit is separate and is not part of this harness (its registry and daemon needs are the kit's).

Server fixtures (ruled 2026-10-08): the coding gate runs the server cases (install, start, lock, kill) against a
stand-in server archive built by the test and placed in the container with `docker cp`, so CI needs no internet;
before slice 1's release gate (D-65) one CI job installs and starts a real server, a VSCodium musl REH downloaded
through the VSCodium product fixture's template (MIT, no licence gate), cached by version, run on `workflow_dispatch`
and on the release branch; it covers F-2403 including the client fallback with the container's network cut. The
acceptance suite is a private workspace package (`tests/acceptance`, card tooling-04).

Each component brief lists its ACs in two columns: acceptance (harness) and unit. Writing the harness cases from
that table is local-worker work once the harness exists.

## Local-worker task cards

Under `docs/architecture/l3/<area>/tasks/`, one file per card: package and file boundary; the contract section it
implements; the test table (given → expected) the worker writes tests and code from; the gates; the reviewing
coder. A card with a judgement call left in it is a Claude task instead. The first six come from the lib-ssh pure
parts (S2, S4 parser, S4 writer, S4 `ssh -G` reader, S5, S6).
