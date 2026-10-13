# Task card connect-38: remote.SSH.localServerDownload is read, and a failed client download shows S071

Issue: #672. Release 0.2 (F-2403 and F-2405 are in the D-65 gate's paths). Size: S–M. Builder: daedalus, before
coverage-17 (#581), whose `off` and `auto` rows need it.

## 1. The defect

**The setting does nothing:**
- `remote.SSH.localServerDownload` (`auto` | `always` | `off`, application scope, default `auto`) and the deprecated
  `remote.SSH.allowLocalServerDownload` (boolean, default `true`) are declared in `packages/remote-ssh/package.json`.
- Nothing reads them. `connect-ports.ts` hands the server steps the frozen `SSH_POLICY`
  (`packages/lib-server/src/policy/rows.ts`), whose `downloadPlacement` is always `{kind: 'hostFirst', mode: 'auto'}`.
- So `always` and `off` behave as `auto`.
- lib-server's planner already handles every mode (`install/plan.ts`, `placementOf`): `always` downloads on the client
  with no host attempt, `off` downloads on the host with no client fall-back, and `auto` does the host first, then the
  client.

**The wrong text on the same path:** a client download that fails (`TransferFailure` `localDownload`) is mapped to
S043, "Downloading VS Code Server failed. Please try again later." (`remote-ssh/src/pipeline/failure.ts`, `ofTransfer`).
F-2405 7.E3–7.E5 (AC-11–13) require S071, "Failed to download VS Code Server ({0})". The progress texts S044 and S029
already exist (`surfaces/progress-titles.ts`).

## 2. The rules (F-2405, remote-oss/remote-ssh#50)

- **R1** (BR-1, AC-5, AC-6, AC-7): the mode for a connect is read when the connect starts, from the settings as they
  are then:
  - `allowLocalServerDownload` `false` → `off`, whatever `localServerDownload` says;
  - otherwise `localServerDownload`'s value when it's `auto`, `always` or `off`;
  - any other value, or none → `auto`.
- **R2** (6.2, AC-3, AC-27): `always` gives `{kind: 'hostFirst', mode: 'always'}`. The host makes no download attempt
  of its own for the artifact. In exec mode, the client fetches only the CLI and the host then downloads the full
  server itself, which is the planner's behaviour today.
- **R3** (6.3, AC-4): `off` gives `mode: 'off'`. A host download failure ends in F-2403's S043, with no S044 or S029.
- **R4** (7.E3–7.E5, AC-11–13): a client download failure gives S071 with {0}:
  - `Failed to fetch` for a request that fails on the network (refused, closed mid-body, rejected by the network
    stack);
  - `Server returned <status>` for an HTTP error status, for example `Server returned 404` (English only, as the spec
    says);
  - the file system's error text for a temp folder the finished download can't be written to.

  No retry in any case (AC-12).
- **Out of scope:** S049 and S050 (AC-20) are stored mitigation hints that only F-2606's chat participant reads, and
  F-2606 isn't built (F-3907). Their criteria stay `deferred`.

**A question to athena before the build** (on #672): server-20 (#670) maps a built-in source's server-archive 404 to
S146 (F-2401 7.E2 (b), AC-20 "with local download off"). F-2405 AC-12 says a client download's 404 shows S071.
- **This card's reading:** S146 for the host-side download's 404, S071 for the client-side download's.
- **Check:** confirm that server-20 restricts S146 to the host-side download. The two cards must agree.

## 3. Changes

1. **lib-server** (`policy/rows.ts`): `SSH_POLICY` stays as the `auto` record. Add
   `sshPolicyFor(mode: 'auto' | 'always' | 'off'): ServerPolicyRecord`, the same frozen record with
   `downloadPlacement: {kind: 'hostFirst', mode}`. Export it beside `SSH_POLICY`.
2. **remote-ssh** (`pipeline/connect-settings.ts`): `localDownloadModeOf(settings)` applies R1 through the existing
   `valueOf` and `switchOf` helpers.
3. **remote-ssh** (`connect-ports.ts`): the server dependencies' `policy` becomes a function of the connect:
   `policy: () => sshPolicyFor(localDownloadModeOf(settings))`, and the server steps read it once per connect where
   they read `SSH_POLICY` today. The connect after a change of the setting uses the new mode, with no reload.
4. **remote-ssh** (`pipeline/failure.ts`): `ofTransfer`'s `localDownload` gives
   `logged('serverDownload', detail, {id: 'S071', values: [<{0} of R4>]})`. lib-server's `localDownload` carries what
   {0} needs:
   - `cause: 'network' | 'status' | 'clientFile'`;
   - `status?: number`;
   - `detail` (for `clientFile`, the file system's error text).

   `transfer/http-download.ts` and `transfer.ts` set them. Their `HTTP <n>` and error texts are today's sources. S071
   joins `surfaces/failure-strings.ts` and every `l10n/bundle.l10n*.json` (English for now), and
   `pnpm check-string-tables` passes.
5. If server-20 lands first and has added `status` to `localDownload`, reuse it and don't add a second field.

## 4. Rows

**Unit rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2405.AC-6 | (each) `localServerDownload` `auto`, `always`, `off`, with `allowLocalServerDownload` unset | `localDownloadModeOf` gives the same value |
| F-2405.AC-5 | (each) `allowLocalServerDownload` `false` with `auto`, `always`, `off` | `off` |
| F-2405.AC-7 | (each) `localServerDownload` `"bogus"`, `5`, absent | `auto` |
| F-2405.AC-3 | `sshPolicyFor('always')` | `downloadPlacement` `{kind: 'hostFirst', mode: 'always'}`; every other field equals `SSH_POLICY`'s |
| F-2405.AC-3 | the planner with `sshPolicyFor('always')` for a host that can download | a client download plan, no host attempt |
| F-2405.AC-4 | the planner with `sshPolicyFor('off')` | a host download plan with no client fall-back |
| F-2405.AC-11 | `ofTransfer` of `localDownload` `network` | S071 with `Failed to fetch` |
| F-2405.AC-12 | `localDownload` `status` 404 | S071 with `Server returned 404` |
| F-2405.AC-13 | `localDownload` `clientFile` with detail `EACCES: …/x` | S071 with that detail |
| F-2405 BR-1 | two connects with the setting changed between them (the settings fake) | the second connect's policy has the new mode |

**Acceptance rows** (VSCodium, failure cases or a launch of their own, with tooling-27's download host; `T(<segment>)`
is the template whose address is the download host's path, as coverage-17 writes it):

| Case | Settings | Expected | Cite |
|---|---|---|---|
| `local-always` | `serverDownloadUrlTemplate: T(ok, local)`, `localServerDownload: always` | connected; the record has a `progress` line `Downloading VS Code Server locally` and one `Copying VS Code Server to host with scp`; the download host saw no request from the host container's address (its request log, by peer address) | F-2405.AC-3 |
| `local-off` | `T(missing)` for the host and the client, `localServerDownload: off` | the S043 dialog; no `Downloading VS Code Server locally` line | F-2405.AC-4 |
| `local-allow-false` | the same as `local-off`, with `localServerDownload: always` and `allowLocalServerDownload: false` | as `local-off` | F-2405.AC-5 |
| `local-404` | the host can't download (`T(missing)` reachable only from the client, or the host's download tools removed), `localServerDownload: auto`, the client's request answered 404 | the dialog `…: Failed to download VS Code Server (Server returned 404).` | F-2405.AC-12 |

**Before writing the rows, measure** how the download host tells the host's requests from the client's: the peer
address on the bridge gateway versus loopback. If it can't, add a query parameter per side to the template, and keep the
paths. The download host is tooling-27's, and changing its request log is in scope here.

## 5. Gates and review

All gates, the changed files at 100 %, `check-string-tables`, and the full VSCodium run green. Paste the four cases.
PR title `remote-ssh, lib-server: remote.SSH.localServerDownload is read, and a failed client download shows S071 (card
connect-38, #672)`. themis or triton reviews; athena gives the design check.

## 6. Open rows (stop and report on #672)

1. athena's answer on §2's question differs from this card's reading.
2. The planner's `always` in exec mode doesn't match AC-27 (the CLI from the client, the server from the host).
   Report the plan you see.
