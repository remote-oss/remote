# Task card tooling-37: small harness items (slow and CVE servers, per-case download tools, a late agent, an earlier archive)

Issue: #720. Release 0.2, harness gap H6 of the gate's class-"b" ACs. Size: S per part, about M in all. Builder:
assigned by hermes (task:claude). The four parts are independent. One PR may carry them all, or each part its own PR,
named `(card tooling-37 part <n>, #720)`.

These items were in H6 too, but D-65's recorded cases cover them (hermes, 2026-10-14), so they're not here:
- F-2601 AC-21, AC-22;
- F-2304 AC-12, AC-33;
- F-2409 AC-1, AC-24.

## 1. Part 1: a slow-starting server and the CVE stand-in on the download host (F-2409 AC-26, AC-30)

**Why:** the VSCodium run's download host serves only the real Alpine server. A row of the VSCodium run can't yet see:
- a healthy server that takes more than 20 s to report its port (AC-26, legacy mode, S135);
- a server that ends for CVE-2020-1416 (AC-30, S136).

connect-26's real-shell rows already prove both causes with the stand-in, without the editor.

**Changes (`tools/acceptance-downloads.ts`):**
- **Segment `slow-start`:** the server archive repacked once, when the download host starts, into the run folder (with
  the system `tar`). The archive's launcher script gets `sleep 25` as its first command after the `#!` line. Find the
  launcher from the archive's listing, and name it in the PR. It's answered like `ok`.
- **Segment `standin-cve`:** the stand-in archive of `tests/acceptance/server/stand-in-server.ts` with behaviour
  `cveTerminated`, built at the download host's start. Its launcher is at the path the VSCodium profile's install
  starts, not `STAND_IN_LAUNCHER`. Give the archive builder a `launcher` parameter (default `STAND_IN_LAUNCHER`, so its
  existing callers are unchanged), and read the path from the profile as the install plan does.
- The README's segment table gains both lines.

**Rows:**

| Cite | Where | Given | Expected |
|---|---|---|---|
| F-2409 AC-30 | `suite-install/cases.json`, case `standin-cve` | template `${HARNESS_DOWNLOADS_HTTP}/standin-cve/${os}-${arch}/${commit}` | `outcome: dialog`, `Could not establish connection to "harness": The VS Code Server terminated due to presence of CVE-2020-1416. Check the Remote-SSH output channel for more details.` |
| F-2409 AC-26 | a plain launch `slow-start` (suite `slow-start`) | settings `useExecServer: false`, template `…/slow-start/${os}-${arch}/${commit}`; `hostSetup` `pkill -f vscodium-server` and `rm -rf /home/harness/.vscodium-server-insiders`; window `w26` on `harness`; script `failureDialog` held with `after: 'listening'` → `{button: 'Retry'}` | the held line's `failureDialog` text is S135's dialog; the line comes 20 to 23 s after the connect's `Starting VS Code Server` progress line. The row polls `onHost('netstat', '-ltn')` until the server's port listens, then runs `signal('listening')`. `w26` is then connected, and `onHost` shows one server process, the one started first |

`slow-start` goes in `tsconfig.json`, `knip.jsonc` and the README.

## 2. Part 2: per-case download tools on the VSCodium run's host (F-2403 AC-16, AC-23)

**Why:** the run's host keeps BusyBox `wget` only (`HOST_FETCH`, fixed per container). F-2403 AC-23 needs a host with
both tools, a host with curl only, and a failed wget with no curl attempt. AC-16 needs GNU wget or curl reading their
own configuration files.

**Changes:**
- **`tests/acceptance/host/harness-fetch`** (new, POSIX sh, installed as `/usr/local/bin/harness-fetch`), taking one of
  `busybox-wget`, `gnu-wget`, `curl`, `none` or `wget-and-curl`:
  - the Dockerfile copies `/usr/bin/curl` and GNU `/usr/bin/wget` to `/opt/fetch-tools/` at build time;
  - `harness-fetch` puts back exactly the variant's tools as `/usr/bin/curl` and `/usr/bin/wget`: copies from
    `/opt/fetch-tools/`, and BusyBox's link for `busybox-wget`;
  - `start-sshd`'s `case` becomes `harness-fetch "${HOST_FETCH:-busybox-wget}"`, with the same exit for an unknown name.
- **`tools/acceptance-launches.ts`:** `hostSetupOf` starts every host case's setup with `harness-fetch busybox-wget`,
  the run's default. A case's own `setup` line may choose another tool for that case alone.
- **The variants run:** `wget-and-curl` isn't added to `FETCH_VARIANTS`, so the variants run is unchanged.
- **`suite-install`:** `requests` gains `agent`, a prefix that every logged request's user agent must start with (the
  download host already logs it).

**Rows** (`suite-install/cases.json`, `localServerDownload: off` where the AC says local download off):

| Case | Setup; settings | Expected | Cite |
|---|---|---|---|
| `fetch-both` | `harness-fetch wget-and-curl`; template `ok` | connected; `requests` count 1, agent `Wget/` | F-2403 AC-23 |
| `fetch-curl` | `harness-fetch curl`; template `ok` | connected; count 1, agent `curl/` | F-2403 AC-23 |
| `fetch-wget-fails` | `harness-fetch wget-and-curl`; template `missing`, `localServerDownload: off` | AC-9's dialog; count 1, agent `Wget/` | F-2403 AC-23 |
| `wgetrc-proxy-used` | `harness-fetch gnu-wget`; `/home/harness/.wgetrc` with `use_proxy = on` and `http_proxy = http://127.0.0.1:9/`, owned by `harness`; `useCurlAndWgetConfigurationFiles: true`, `localServerDownload: off`, template `ok` | AC-9's dialog; count 0 | F-2403 AC-16 |
| `curlrc-proxy-used` | `harness-fetch curl`; `/home/harness/.curlrc` with `proxy = "http://127.0.0.1:9"`; the same settings | AC-9's dialog; count 0 | F-2403 AC-16 |

**The existing `wgetrc-proxy` case** keeps its own `.wgetrc` setup. It now gets BusyBox `wget` first, as the run did
before, so its outcome is unchanged.

## 3. Part 3: an agent started after the editor (F-2307 AC-29)

**Changes:**
- **`harnessSshConfig`:** a block `Host late-agent`:
  - `HostName 127.0.0.1`, the port, `User harness`;
  - the run's `IdentityFile`, `IdentitiesOnly yes`, `BatchMode yes`;
  - `AddKeysToAgent yes`, `StrictHostKeyChecking accept-new`;
  - `UserKnownHostsFile <run>/known_hosts_late_agent`.

  It has no `IdentityAgent` line, so ssh uses `SSH_AUTH_SOCK`. It's not an `accountAlias`, whose `IdentityAgent none`
  would hide the agent.
- **A plain launch `late-agent`** (suite `late-agent`), with `environment: {SSH_AUTH_SOCK: '<run>/late-agent.sock',
  HARNESS_AGENT_SOCKET: '<run>/late-agent.sock'}`. The socket doesn't exist when the editor starts.
- **`windows/harness.ts`:** `startAgentAt(socket)` runs `ssh-agent -a <socket> -s` and returns a stop function, which
  kills its `SSH_AGENT_PID`.

**Row** (`late-agent/late-agent.test.ts`): `startAgentAt('<run>/late-agent.sock')`, then `openWindow('late-agent',
'la1')`. Expected:
- `la1` connected;
- `agentKeys()` holds `fingerprintOf('<run>/id_ed25519')`.

The `after` hook stops the agent.

## 4. Part 4: an earlier release's archive (F-3902 AC-16)

**Changes:**
- **`EARLIER_SERVER_ARCHIVE`** in `tools/acceptance-downloads.ts` (tag, repository and sha256 by `alpine-<arch>`): the
  newest VSCodium Insiders release older than `SERVER_ARCHIVE.tagName` that has both Alpine assets. Its other commit is
  the point of the AC. The builder downloads each asset once and writes the sha256s. `serverArchiveOf` takes the release
  record, and its cache is shared with the current archive.
- **Segment `earlier`:** it serves that archive for this machine's architecture, whatever the rest of the path is.

**Row:** a case `install-earlier` in `suite-install/cases.json`:
- the setting is a literal URL with no placeholder, `${HARNESS_DOWNLOADS_HTTP}/earlier/vscodium-reh.tar.gz`. The run
  replaces the harness base, so the product sees a literal URL;
- expected:
  - connected;
  - the server unpacked in `/home/harness/.vscodium-server-insiders/bin/<client commit>/`;
  - its `--version`, run by `onHost`, prints the earlier version with the client's commit;
  - the connect log names both commits.

Cite `F-3902 AC-16 (install-earlier)`.

## 5. Catalogue, gates and review

The six ACs go from `todo` to `acceptance` with their parts. All gates, shellcheck on `harness-fetch`, the changed tools
files at 100 %, the variants run, and the full VSCodium run green. Paste the new cases' and launches' summaries. PR title
`tests: small harness items for the 0.2 gate (card tooling-37, #720)`, or the part's title. themis or triton reviews;
athena gives the tag check.

## 6. Open rows (stop and report on #720)

1. **The slow server** isn't found by the retry, so a second server starts. Report the connect log. That's a product
   question for F-2409 7.E12, not a harness fix.
2. **The CVE stand-in** fails before its start, at install or validation. Report where. The install may check a file
   that only a real server has.
3. **The `late-agent` connect** never offers the key to the agent: `SSH_AUTH_SOCK` doesn't reach ssh. Report how the
   product builds ssh's environment.
4. **F-3902 AC-16's `--version`** prints the earlier commit, not the client's. Report its output against rule 9, and
   don't change the row.
