# Task card server-20: the host architecture comes from the variant's builds

Issue: #670. High priority, not 0.2-gating. Ruled by athena (decisions.md, 2026-10-13). Size: M. Builder: hestia,
after server-19.

**Spec:** F-2401 7.E2 as amended on remote-oss/remote-ssh#46 (F-2401, F-3902 and F-2403 republished 2026-10-13):
- case (a): a machine name with no token;
- case (b): a built-in source's 404 for the server archive;
- the new AC-20 and AC-21.

## 1. The defect

A user's linux ppc64le host stopped with "Unsupported architecture", but VSCodium publishes REH packages for ppc64le,
s390x, riscv64 and loong64. Three places decide by a fixed list:
- **The probe** (`packages/lib-server/src/scripts/bootstrap.ts`, the `uname -m` case): `x86_64`, `aarch64 | arm64` and
  `armv7l | armv8l` only. Anything else ends `UnsupportedArch`.
- **`ProbedHost.architecture`** (`lib-server/src/lifecycle/probe.ts`) is `'x64' | 'arm64' | 'armhf'`, checked against
  `ARCHITECTURES`.
- **lib-product's base-URL form** (`lib-product/src/resolve.ts`, `BASE_URL_PLATFORMS`) maps five `os-arch` pairs to
  update-service platform names, and gives `unsupportedPlatform` for any other pair.

## 2. The rules (athena)

- **R1.** The probe maps the machine name to Code - OSS's architecture token:

  | `uname -m` | Token |
  |---|---|
  | `x86_64` | `x64` |
  | `aarch64`, `arm64` | `arm64` |
  | `armv7l`, `armv8l` | `armhf` |
  | `ppc64le` | `ppc64le` |
  | `riscv64` | `riscv64` |
  | `loongarch64` | `loong64` |
  | `s390x` | `s390x` |

  Any other machine name (for example `i686`, `armv6l`, `aarch64_be`, `ppc64`) has no token. The probe ends
  `UnsupportedArch` with `host.arch` the name as reported, as today, and the connect fails at once with S146, with no
  download.
- **R2.** A host with a token is tried against the variant's source. Nothing keeps a per-variant list of the platforms
  it publishes.
- **R3** (7.E2 case (b), AC-20): a request for the **server** archive that answers **404**, or an equivalent "no such
  file" status:
  - from a built-in source (F-3902 rules 2 and 4: resolution step `productTemplate` or `builtInTable`) means the variant
    has no build for the token. It gives S146 after the failed download attempt, with
    `no server build for <token> at <url>` in the log (the log names the token);
  - from the user's own template (step `override`) stays S043, as F-2403 AC-10 says.

  Every other download failure, a 503 included, is unchanged: S043.
- **R4** (F-3902 rule 5): a 404 for the **CLI** archive is **not** S146. The CLI path fails, and the connect falls back
  to the direct install, as it does for any CLI-path failure today (`connect.ts`: "the CLI path failed (…); installing
  the server directly"). The direct install's server download then follows R3.
- **R6** (AC-21): a host with a token whose built-in source has the server archive shows no S146. The outcome is the
  download's and the start's.
- **R5.** S146 is "The remote host's architecture is not supported" (F-2401 §3.4), the reason of F-2601's dialog:
  `Could not establish connection to "<alias>": The remote host's architecture is not supported.`.

## 3. Changes

1. **`bootstrap.ts`:** the `uname -m` case of R1. `host.arch` reports the token, or, for `UnsupportedArch`, the
   machine name.
2. **`lib-server/src/lifecycle/probe.ts`:**
   - `ProbedHost.architecture` becomes the exported type
     `HostArchitecture = 'x64' | 'arm64' | 'armhf' | 'ppc64le' | 'riscv64' | 'loong64' | 's390x'`;
   - `ARCHITECTURES` lists the seven. A fact outside them is `unsupportedArch` with `reported`, as today.
3. **`lib-product/src/resolve.ts`:** the base-URL form computes the platform name instead of looking it up:
   - `alpine-x64` → `linux-alpine`;
   - `alpine-<arch>` → `alpine-<arch>`;
   - `linux-<arch>` → `linux-<arch>`;
   - `darwin-<arch>` → `darwin-<arch>`.

   `BASE_URL_PLATFORMS` and its `unsupportedPlatform` problem go. Any type or row that only existed for them goes with
   them, with knip's agreement.
4. **Host-side download status** (`posix-script.ts`, `fetch_archive`):
   - capture the downloader's stderr instead of discarding it, keeping `-q`, `-s` and the other flags. For curl, add
     `-S`, so `-fsS` prints its error;
   - when the fetch fails and the text shows an HTTP 404, report `fact server.downloadStatus 404`. The patterns are
     GNU wget's `ERROR 404`, BusyBox wget's `server returned error: HTTP/1.1 404` and curl's `error: 404`;
   - the status word stays `ServerDownloadFailed`.
5. **Client-side download** (`lib-server/src/transfer/`): the client download knows the HTTP status. `localDownload`
   gains `status?: number`, set for an HTTP error answer.
6. **lib-server failure types:** `TransferFailure`'s `serverDownload` gains `status?: number`, from
   `server.downloadStatus`. The CLI path needs no status: R4 keeps its existing fall-back. Add only the row below.
7. **remote-ssh** (`pipeline/failure.ts`, and `server-steps.ts` where the resolution's `step` is known):
   - `ofProbe`'s `unsupportedArch` gives `logged('unsupportedPlatform', 'reported: <name>', {id: 'S146'})`;
   - a **server** download failure with status 404 and a step other than `override` gives
     `logged('unsupportedPlatform', 'no server build for <token> at <url>', {id: 'S146'})`;
   - with step `override`, it stays S043. The mapping needs the step: pass it with the failure from where
     `server-steps.ts` already holds `resolution.step`.
8. **Strings:** S146 joins `surfaces/failure-strings.ts` and every `l10n/bundle.l10n*.json`, in English for now, as
   S075 is. `pnpm check-string-tables` passes.

## 4. Rows

**Script rows** (real `sh`, with a fake `uname` first on `PATH`, as the existing probe script rows stub commands):

| Cite | Given | Expected |
|---|---|---|
| #670 R1 | (each) `uname -m` printing `x86_64`, `aarch64`, `arm64`, `armv7l`, `armv8l`, `ppc64le`, `riscv64`, `loongarch64`, `s390x` | `host.arch` `x64`, `arm64`, `arm64`, `armhf`, `armhf`, `ppc64le`, `riscv64`, `loong64`, `s390x` |
| #670 R1 | (each) `i686`, `armv6l`, `aarch64_be`, `ppc64` | status `UnsupportedArch`, `host.arch` the name |
| #670 R3 | `fetch_archive` against the download host's `missing` path (404), with each downloader variant of `fetch-tools.test.ts` | the install ends `ServerDownloadFailed` with `server.downloadStatus` `404` |
| #670 R3 | the same against a 503 path, if the download host has one; else a refused port | no `server.downloadStatus` |
| F-3902 rule 5 | the CLI install body against the download host's `missing` path | the CLI step fails as today, and the connect logs "installing the server directly" (a connect-level unit row is enough if the real-shell CLI rows need the archive) |

**Unit rows:**
- **lib-server:** `ProbedHost` takes each of the seven tokens; `x86` is `unsupportedArch`. The client download's 404
  gives `localDownload` with `status: 404`. A block with `downloadStatus 404` gives `serverDownload` with `status:
  404`.
- **lib-product:** the computed base-URL platform for `linux-ppc64le`, `linux-x64`, `alpine-x64`, `alpine-arm64` and
  `darwin-arm64`: `server-linux-ppc64le`, `server-linux-x64`, `server-linux-alpine`, `server-alpine-arm64`,
  `server-darwin-arm64`. The existing five give the same URLs as before.
- **remote-ssh:**
  - `unsupportedArch` gives S146 with `reported: i686`;
  - (F-2401.AC-20) a server-archive 404 with step `productTemplate` gives S146, with `builtInTable` S146, and the log
    detail names the token; with `override`, S043;
  - a 503, and any non-404 failure, with a built-in step gives S043;
  - (F-2401.AC-21) a connect over the pipeline fixture whose host reports `ppc64le` and whose server download succeeds:
    the connect proceeds to the start step, and no failure with S146 is produced (a unit row in `connect.test.ts`);
  - (F-2401.AC-20) the same connect with the server download failing 404 from step `builtInTable`: the failure has
    reason S146, the start step never runs, and the log detail names `ppc64le`;
  - (F-3902 rule 5) a CLI-path failure caused by a CLI-archive 404 falls back to the direct install.

**Acceptance row** (the VSCodium failure cases):
- a host account `harness-i686`, like `harness`, whose `~/.profile` puts a folder first on `PATH` with an executable
  `uname` that prints `i686` for `-m` and calls `/bin/uname` for everything else;
- alias `i686` in the run's `ssh_config`;
- a failing connect in `suite-failure/cases.json`: the dialog `Could not establish connection to "i686": The remote
  host's architecture is not supported.`, ended within 10 s of the first progress line, with no download host request
  (the download host's log, if it keeps one; otherwise no `server.` fact past the probe in the log).

Check first that the probe runs `uname` through the login shell's `PATH`. If it calls `/bin/uname` directly, the stub
can't work: stop and report (§6). The 404 cases stay at script and unit level, since the run has no built-in source
reachable offline.

## 5. Gates and review

All gates, shellcheck, the changed files at 100 %, `check-string-tables`, the VSCodium run green, and the fetch-tools
variants run (`pnpm test:acceptance:variants`). PR title
`lib-server, lib-product, remote-ssh: the host architecture comes from the variant's builds (card server-20, #670)`.
themis or triton reviews; athena gives the design check.

## 6. Open rows (stop and report on #670)

1. The republished F-2401, F-3902 or F-2403 says anything other than §2.
2. The probe doesn't take `uname` from `PATH`, so the acceptance row's stub can't reach it.
3. A downloader prints no recognisable 404 text with the flags kept (for example BusyBox wget without `-S`). Report its
   exact stderr, and don't add `-S` to wget by guess.
