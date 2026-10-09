# Coding brief: lib-server (V1–V9) — slice 1, build-order step 9

> Issued by `remote-architect` 2026-10-07; the PM allocates the seats. Design: `contracts.md` §5 (the policy record
> §5.0 and V1–V9; V10 prefetch is WSL's and waits), `adr-drafts/` "bootstrap and install", `local-connection-server.md`
> for how S9 hands the channel over. Depends on `lib-host` (H1 and its recording fake), `lib-product` (P1–P4,
> `classifyLicence`), `lib-log`; the harness (#47) for the acceptance tests over a real host; S10 for the end-to-end
> run (step 8 may land in parallel: everything here is built and unit-tested against the recording channel first).
> Binding: ADR-0002, 0003, 0004, 0006 (the profile names folders and launcher; nothing product-specific here), 0007,
> 0008; R-68 (never accept for the user), R-80 (source-based gate), R-83 (telemetry off), R-86 (no deliberate Windows
> failure), R-79 (bounded waits as data).

## Split into tasks

| Task | Content | Seat |
|---|---|---|
| server-01 (card) | The policy record type and the three shipped rows (ssh, containers, wsl) as data with a validator: every field from §5.0, no per-extension branch anywhere; `scriptParameters` shape for V1 | local worker |
| server-02 (card) | V1 `parseResult`: the result block between two markers, statuses, host facts, server facts, timings; `noResultBlock`; fixtures constructed from the contract's status list | local worker |
| server-03 (Claude) | V1 `scriptFor`: the POSIX `sh` script text as a template with its parameter block (probe, install, start, kill, uninstall, cleanup; single-script and stepwise), written from the specs only, under 8192 characters for the PowerShell twin (PowerShell itself provisional (lab); ship the POSIX one, stub the other with a clear failure; when the PowerShell twin is written it carries V3's unpack rule too: a leading `./` is not a folder, the top folder is stripped only when it is the one entry, else entries keep their paths (ruled 2026-10-08, #189); the POSIX `unpack_move_top` is the model); downloader order `wget` then `curl` and the configuration-file skip; lowercase proxy variables with the host environment winning; locks by `flock` or atomic `ln`; macOS sockets in `TMPDIR`; the two-mode bootstrap confirmed by the room (script on stdin to a POSIX login shell; otherwise `sh` after sourcing `~/.profile`); unpack percentage lines as progress | Claude |
| server-04 (card) | V3 `plan`: reuse before source, placement from the record, `useExecServer` logged once and never applied, `invalidInstallPath` before any channel use, the reused CLI layout of F-3902 rule 10; pure, table-driven | local worker |
| server-05 (card) | V5 lock decisions as pure functions: client lock age rule (4 minutes), poll about 0.5 s, 2-minute give-up, host lock loop 30 attempts 1 s apart with "retry N"; with a fake clock and a fake file port | local worker |
| server-06 (card) | V9 `cacheFolders` and `clientArchiveFolder` as pure functions (reference layout for `code`/`code-insiders`, `<applicationName>` level otherwise; the `/vscode` volume tree) | local worker |
| server-07 (Claude) | V2 probe, V4 transfer (placement, `clientPathOnHost` else `copyToHost` else streamed unpack; `cache` none → temporary file deleted; `kept` → temporary name, verification by the record's ordered rules from the download port's response facts, atomic rename; manual bootstrap; commit rewrite by editing the unpacked `product.json` only), V6 gate (`classifyLicence` from lib-product; per-profile acceptance keyed by the terms URL, never synced; the modal through a UI port with "Accept and Continue" / "Cancel"; `licenceDeclined` with its reason), V7 `startOrReuse` (the start options exactly as the contract lists them, `--telemetry-level off` always, `--accept-server-license-terms` only after `accepted`, readiness on the "Extension host agent listening on" line, bad bind host → fallback to 127.0.0.1 with its message, grace time per resolve and never to Windows, `serverPort`, `installExtensions` logging per id), V8 kill, uninstall, cleanup per the record's policy; all over H1 with the recording channel in unit tests | Claude |
| server-08 (Claude, acceptance) | The slice-1 acceptance tests over the harness container with S10: F-2401 (prerequisites and probe), F-2403 (download on the host, then the client fallback with the container's network cut), F-2409 (start, readiness, token file, port range, bad bind host fallback), F-2407 (install path), F-2408 (locks: two windows installing at once), F-2411/F-2412/F-2413 (kill, uninstall, cleanup keeping five). Part 2 (the real musl server, gated by `REMOTE_OSS_REAL_SERVER=1`, its own CI job) fetches the archive once per run into a folder the run removes, with no CI cache: F-2403's download and kept-entry cases must prove the download every run, and a restored cache would turn them into hits (ruled 2026-10-09, replacing "cached by version") | Claude |

## Behaviour to get right (beyond the contract tables)

- Every wait is a policy value with an R-79 bound (download, unpack, start, lock), never a literal; cancellation
  everywhere through `AbortSignal`; progress as events for the caller.
- The remote environment step of V7 (F-2311/F-2312: `SSH_AUTH_SOCK` and `DISPLAY` learned from the session; the agent
  link with a random per-window name, never overwriting, never removed; gated by core's terminal trust through S8)
  is slice 2 with S8; in slice 1 V7 exposes the hook and the tests assert it is not invoked.
- Client-side HTTP only through the injected download port (the editor's proxy-aware path; `contracts.md` §5
  network rule); a test proves no module creates its own agent.
- Nothing product-specific: folder names, launcher, data folder and URLs come from the profile; a test runs the
  planner and the runtime options against the synthetic product fixture of lib-product.
- Strings shown to the user (S027, S043, S071, S075, S076, S088, S135, S157, S168) are ids resolved by the package's
  string table, never literals in the library.

## Done

Gates green per task; cards reviewed by coding-worker-1; the Claude tasks peer-reviewed; the acceptance tests of
server-08 green in CI; ADR-0008 in README and comments; PR bodies answer R1–R6 and list provisional (lab) items
(PowerShell script, Windows lock forms).
