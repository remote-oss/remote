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

## Acceptance tests and the harness (D-63)

Coding gate per slice: tests derived from the acceptance criteria, run in CI on Linux and locally. Release gate: a
small recorded set for the P0 rows (20 for 0.2), recorded by the kit on pull when the slice reaches QA.

The harness, `tests/acceptance/`:

- **Editor under test:** the floor's VS Code (1.139.1, ADR-0007) downloaded by `@vscode/test-electron` into a
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
