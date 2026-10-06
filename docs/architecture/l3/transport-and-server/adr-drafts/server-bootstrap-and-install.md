# ADR-NNNN: Our own bootstrap scripts install and start the server over the host channel; no editor CLI

- Status: proposed (draft by `remote-architect-worker-1` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead. The login-shell mode (dossier question 10) and the commit-rewrite meaning (contracts question
  (c)) wait on the remote-ssh room through `remote-development`.
- Scope: `lib-server` (V1 to V8), `lib-product` (P3), every resolver package
- Requirements:
  - remote-ssh F-3902 rules 1 to 11, F-2103 BR-13, F-2401 to F-2413, F-2701 to F-2704, F-2508;
  - remote-containers F-1402, F-0503;
  - R-47, R-58, R-68; ADR-0005 and ADR-0006 as revised on 2026-10-06; the host-channel ADR draft.

## Context

The reference installs through Microsoft's CLI by default. F-3902 rule 5 rules that out for every templated source,
and in this family every source is templated, so the server archive is always installed directly. Doing that needs
code on the remote side:
- detect the platform and prerequisites;
- find a downloader;
- lock;
- download and unpack;
- start the server and report its port;
- kill, uninstall and clean up.

The reference's scripts may not be read. Our own must therefore be written from the specs, and they run on Linux
(glibc and musl, with or without bash), macOS and Windows hosts.

## Decision

1. **Two scripts.** lib-server ships one POSIX `sh` script and one PowerShell script as text, written from the specs
   only. They are run through the host channel and never derived from the reference.
2. **Steps.** Each script has a fixed set of steps (probe, install, start, kill, uninstall, cleanup) and a parameter
   block. Each step ends with a result block between two marker lines, using the statuses of the contracts (V1).
   Only lib-server parses it.
3. **Install order.**
   1. Reuse when `bin/<client commit>/` or the reference's CLI layout holds the client's server (F-3902 rule 10).
   2. Else resolve the archive through lib-product (rule 1).
   3. Gate the licence (rule 11).
   4. Lock (F-2408).
   5. Download on the host first, with the client fallback by `localServerDownload` (rule 6).
   6. Unpack into `<data folder>/bin/<client commit>/`.
   7. Check `--version` and rewrite a differing commit (rule 9).
4. **Start.** The launcher from `product.json` (rule 7), with the start options of the contracts (V7), telemetry
   off on every start (R-83). Readiness is
   the server's own "Extension host agent listening on" line. `--accept-server-license-terms` is passed only after
   acceptance (R-68).
5. **No editor CLI.** `remote.SSH.useExecServer` is logged as not applied (F-2103 BR-13).
6. **Shell choice, pending the room.** A POSIX login shell receives the script on standard input. Any other login
   shell gets `sh` after sourcing `~/.profile`. This keeps F-2508's login environment and works on fish and bash-less
   hosts (F-2703 Q2, F-2704 Q1).
7. **Windows hosts.** PowerShell with a command line under 8192 characters and no WMI process query. A standard
   user is not failed on purpose (R-86, F-3908). The script is provisional (lab) until F-2701's capture runs
   (D-60).

## Options considered

| Option | For | Against |
|---|---|---|
| Our own scripts over the host channel (chosen) | Fits F-3902 rule 5 for every source; one installer for three transports; nothing to fetch but the server archive | Two scripts to write and test per platform; the result protocol is ours |
| The product's editor CLI as launcher (ADR-0005's first version) | Server management already written | No role under F-3902 rule 5; VSCodium has no Alpine or armhf CLI and follows only its own feed; withdrawn by ADR-0005/0006 as revised |
| A helper binary of ours on the host | Richer control | A binary per platform; contradicts the container view's "no agent of ours on any host" |

## Consequences

- The scripts are the largest piece of remote-side behaviour and need lab hosts per platform:
  - Debian glibc;
  - Alpine musl;
  - BusyBox without bash;
  - macOS;
  - Windows with an administrator and a standard user.
- The kit's `sshtarget` fixtures cover part of this list; the suite gaps are in the dossier §6.
- The result block makes failures classifiable without parsing free text.
- The commit rewrite touches only the unpacked `product.json`, pending the room's confirmation.

## Check

- Conformance cases F-3902.AC-1 to AC-18, plus the E24 and E27 acceptance criteria on lab hosts.
- Unit tests of the result-block parser and the install planner.
- A review rule: no script line may come from outside the specs, VS Code OSS or public OpenSSH and shell
  documentation.
