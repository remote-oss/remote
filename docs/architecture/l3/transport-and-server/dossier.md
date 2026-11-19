# Area A dossier: transport and server lifecycle

- Status: draft for the lead's review (deliverable 1). Boundaries are preliminary until the container view is stable.
- Date: 2026-10-06
- Author: `remote-architect-worker-1`; lead: `remote-architect`
- Inputs: the published spec issues of `remote-oss/remote-ssh` (#11–#85), `remote-oss/remote-server` (#7–#19) and the
  server-related issues of `remote-oss/remote-containers` (#34, #37, #39, #41, #57, #58, #92, #103); the
  remote-containers conformance suite; ADR-0002 to ADR-0006; the binding rulings; VS Code OSS and its `cli/` crate.

Feature ids are cited as `F-xxxx` with the issue (`ssh#20` is `remote-oss/remote-ssh#20`, `srv#` is remote-server,
`ctr#` is remote-containers). Decision issues bind components but are not traced as features.

## 1. Component candidates

Containers follow the layout candidates: `lib-ssh`, `lib-product`, `lib-server`, `lib-forwarding`, and a new
`lib-tunnels` for the Remote - Tunnels client side. Every component is UI-free except where marked (prompts, login
terminal), and reaches the editor through narrow adapters (ADR-0002 rule 7).

| Component | Container | Responsibility | Features owned |
|---|---|---|---|
| A1 ssh-client | lib-ssh | Find and check the local `ssh` and `scp` (`remote.SSH.path`, PATH, Git for Windows), the Windows warning | F-2101 (ssh#19) |
| A2 ssh-session | lib-ssh | Build the argument list and spawn `ssh` (`-F`, `-T`, `ConnectTimeout`, `RemoteCommand` override), pass every other keyword through, host and user name checks before spawn, connect timeouts, jump hosts | F-2105 (ssh#23), F-2106 (ssh#24), F-2107 (ssh#25), F-2109 (ssh#27), F-2205 (ssh#32), F-2310 (ssh#43) |
| A3 connection-server | lib-ssh | The detached local helper that holds one `ssh` per host string, shared by windows and reloads; per-host records; Kill Local Connection Server | F-2102 (ssh#20) |
| A4 ssh-prompts (UI) | lib-ssh | Askpass relay, prompt classification and inputs, cross-window prompt hand-over, the hidden login terminal of terminal mode, external askpass | F-2305 (ssh#38), F-2306 (ssh#39), F-2307 (ssh#40), F-2308 (ssh#41), F-2309 (ssh#42) |
| A5 ssh-config-model | lib-ssh | Which config files are in effect, the host list (Host, Match, Include), the Add New SSH Host parser and Host-block writer | F-2201 (ssh#28), F-2202 (ssh#29), F-2204 (ssh#31) |
| A6 connection-pipeline | remote-ssh package | The ordered connect run behind B's resolver: validate, pre-connection script, client lookup, session, platform, install, start, tunnel, result; phase events | F-2108 (ssh#26), F-2206 (ssh#33) |
| A7 product-profile | lib-product | The running editor's `product.json` as one profile; archive URL resolution (override, product template, built-in table, no-default dialog); placeholder expansion | none directly; implements F-3902 rules 1–4, F-1402 rule 4 |
| A8 host-bootstrap | lib-server | Our own remote-side step: a POSIX `sh` script and a PowerShell script, shipped as text, run over A2; platform and prerequisite detection, required tools, status codes | F-2401 (ssh#46), F-2402 (ssh#47), F-2701 (ssh#74), F-2702 (ssh#75), F-2703 (ssh#76), F-2704 (ssh#77) |
| A9 server-install | lib-server | Download on the host or the client, scp copy, manual bootstrap, install path, locks, server identity rewrite, licence gate (R-68), caches (R-58) | F-2403 (ssh#48), F-2404 (ssh#49), F-2405 (ssh#50), F-2406 (ssh#51), F-2407 (ssh#52), F-2408 (ssh#53), F-2103 (ssh#21) |
| A10 server-runtime | lib-server | Start, reuse, socket mode, kill, uninstall, lifetime and grace time, old-version clean-up, default extensions, remote environment fix-ups (agent socket, DISPLAY) | F-2409 (ssh#54), F-2410 (ssh#55), F-2411 (ssh#56), F-2412 (ssh#57), F-2413 (ssh#58), F-2506 (ssh#64), F-2508 (ssh#66), F-2311 (ssh#44), F-2312 (ssh#45), F-2008 (ssh#18) |
| A11 forwarding | lib-forwarding | The window tunnel to the server (SOCKS relay, second-ssh, socket forward), local port range search, the resolver's tunnel factory, default and static forwards | F-2104 (ssh#22), F-2507 (ssh#65), F-8202 (srv#15), F-1102 (ctr#58) |
| A12 ssh-diagnostics | lib-ssh | The ssh stderr classification into error kinds and reason texts, the hint store and the session troubleshooting terminal, the Remote - SSH log channel content | F-2003 (ssh#13), F-2601 reason part only (see B), F-2603 (ssh#70), F-2604 (ssh#71), F-2605 (ssh#72) |
| A13 tunnel-client | lib-tunnels | Dev tunnels service calls (list, connect, unregister, limits) through the MIT client library, sign-in through `vscode.authentication`, the tunnel picker, the `tunnel` connect run | F-8101 (srv#10), F-8102 (srv#11), F-8103 (srv#12), F-8104 (srv#13), F-8203 (srv#16) |

Not area A, suggested area B (resolvers, windows, Remote Explorer, identifiers, stand-down): F-2001, F-2002, F-2004,
F-2005, F-2006, F-2007, F-2203, F-2301, F-2302, F-2303, F-2304 (B renders A's phase events), F-2501, F-2502,
F-2503, F-2504, F-2505 (A obligations: a fresh connection per attempt), F-2509, F-2601 (dialog contract), F-2602,
F-2606 (not built, F-3907); F-8001, F-8002, F-8201 (data from A13), F-8301, F-8302; F-0502.

Routed later by the lead: F-0503 (ctr#34) and F-0419 (ctr#92) fit A9 (install into a container through a
`docker exec` transport, the shared `vscode` volume, R-58 cache folders); F-0505 (ctr#37) fits A10 (list handed to a
starting server). F-1302 (ctr#103) is undecided: the hop is B, the remote helper placement is A9.

Decision issues and the components they bind: F-3902 → A7, A9, A10; F-3903 → B (owner F-2001), binds A2, A4, A11;
F-3905 → every component (no telemetry, no payload lines in logs); F-3908 → A8, A10; F-8902 → A13; F-1402 → A7, A9;
F-1403 → B. F-3901, F-3904, F-3906, F-3907, F-8901 are B's.

## 2. Interfaces across the area boundary

Agreed with `remote-architect-worker-2` on 2026-10-06, with the lead's rulings of the same day: B owns everything
the editor sees of a connection, including the authority codecs, the progress rendering of F-2304 and the failure
notification and picker of F-2601 and F-2602; A owns everything that touches the remote side and the classification
of failures. A calls no resolver, window, indicator or label API; the prompts of A4 go through A's own narrow UI
adapter and are the one exception. The decoded target type is defined in B's contract.

Provided by A:

| Operation | Inputs | Output | Failure states |
|---|---|---|---|
| `connect` | decoded target (alias, or host name with optional user and port; hop list), the host string as written, core attempt number and reconnection flag, window identity, phase sink, cancellation | Connected: local address (127.0.0.1 and port) or a managed socket factory, connection token, extension-host environment, environment tunnels, tunnel factory, remote platform, server commit | Failed with a kind, the exact reason text, a retryable flag, a "user already notified" flag, hints (message, status, mitigations, resources) and diagnostics (log channel and line range); kinds: unreachable, authentication, hostKeyRejected, hostKeyChanged, timeout, forwardingDisabled, unsupportedPlatform, prerequisiteMissing, noServerSource, invalidServerTemplate, licenceDeclined, serverDownload, serverInstall, serverStart, invalidSetting, preconnectFailed, lockTimeout, retriesExhausted, cancelled |
| `transportEvents` | connection | `transportLost`, `transportClosed` (ssh or relay exit, server gone); core-side reconnection state is B's | none |
| `cancel` | connection | the run stops at its next step; a running host-side download is not stopped (F-2304 BR-8) | none |
| `revealDetails` | connection | shows the log channel or the login terminal | none |
| `listConfiguredHosts` | none (reads settings live) | host entries in F-2202's order, read fresh | parse error with file and reason |
| `configFilesInEffect` | none | candidate files with existence and creation mode | none |
| `addHostFromCommandLine` | command text, target file | the written block | one of four parse errors (F-2204) |
| `listTunnels`, `unregisterTunnel` | account | reached by the explorer only through the `remote-tunnels.internal.*` companion commands of remote-oss.remote-server (F-5902 §5) | sign-in refused, service error |
| `killLocalConnectionServer` | host string | done, silently | none (F-2102 BR-7) |
| `killServer`, `uninstallServer` | target | done, or the ssh failure | ssh failure kinds above |
| `productProfile` | none | names, folders, URL templates, scheme, gallery, licence fields (ADR-0006) | none |
| `usageLimits` | account | limit rows (F-8203) | sign-in refused, service error |

Needed by A:

| Operation | From | Purpose |
|---|---|---|
| decoded target and raw host string | B, lib-authority | A never parses authorities |
| resolver wrapper that maps Failed to `RemoteAuthorityResolverError` (handled, temporary) | B | A raises no editor errors |
| phase rendering (F-2304) and the failure dialog and picker (F-2601, F-2602) | B | A emits events and hints only |
| identifier table (setting keys, string ids) | B, lib-identifiers | A reads its settings by key from one table |
| stand-down gate | B, lib-standdown | A components are wired only after the gate |
| a log channel per extension | lead, lib-log | A writes the information the specs list, never prompt answers or tokens |

## 3. External dependencies

- **Proposed API.** `resolvers` (ResolvedAuthority and ManagedResolvedAuthority results, RemoteAuthorityResolverError,
  `env.appCommit` and `env.appQuality`, the tunnel factory); `tunnels` (`workspace.openTunnel` for default forwards,
  F-2507 and F-3903 C-3); `terminalDataWriteEvent` (login terminal prompts, F-2308). [oss]
  `src/vscode-dts/vscode.proposed.resolvers.d.ts`, `vscode.proposed.tunnels.d.ts`. A never declares
  `terminalRemoteResolver` (F-3903 rule 1).
- **Stable API.** `window.withProgress`, `createInputBox`, `createQuickPick`, `createTerminal` with `hideFromUser`,
  `ExtensionContext.globalState`, `globalStorageUri`, `environmentVariableCollection`, `authentication.getSession`,
  `env.appRoot` (to read `product.json`).
- **Local processes.** `ssh` and `scp` (ADR-0004); the local connection server as a detached Node child of the
  extension host; the user's pre-connection script (F-2108); for Tunnels the local relay that F-8103 observes as the
  editor CLI (open question 4).
- **Network.** Server archives at the resolved URL: VSCodium's GitHub releases by default, a user template, Microsoft's
  update service only through the user's setting behind R-68. The dev tunnels service through its MIT client library;
  the GitHub and Microsoft account providers through the editor.
- **Remote files (names only).** `<install root>/<serverDataFolderName>/bin/<client commit>/` with
  `vscode-remote-lock.<user>.<commit>`, `.<commit>.log`, `.<commit>.pid`, `.<commit>.token`, `data/`, `extensions/`;
  the reused CLI layout `cli/servers/Stable-<commit>/server/` (F-3902 rule 10); `/tmp/vscode-ssh-auth-sock-<n>`.
- **Client files (names only).** A per-host record in global storage, an install lock in the editor's temp folder,
  askpass sockets in the user runtime folder (named pipes on Windows), a temporary download folder.

## 4. How ADR-0004, ADR-0005 and ADR-0006 apply

- **ADR-0004.** `ssh` is spawned in one place, A2, and only through it: by A3 for the shared connection, by A11 for a
  second-ssh tunnel or socket forward, by A9 and A10 for scp, kill and uninstall. A2 passes the user's configuration to
  `ssh` and never interprets options. Where a spec needs an effective option value (F-2105 per-host `ConnectTimeout`,
  F-2107 `RemoteCommand`, F-2202 BR-21 match-back), A5 asks OpenSSH itself with `ssh -G`. F-2202 BR-21 describes a
  match-back that diverges from OpenSSH; that conflict goes to the spec (question 5).
- **ADR-0005.** For Remote-SSH the editor CLI is not used. F-3902 rule 5 says every templated source installs one
  server archive directly. All of our sources are templated: the setting, the product template, or the built-in
  table. So exec-server mode (F-2103) never runs in the conformant build. `remote.SSH.useExecServer` is logged as
  not applied, and a reference CLI layout found on the host is reused by starting its server directly (rule 10).
  VSCodium publishes no CLI for Alpine or armhf and its CLI follows only VSCodium's own feed (F-3902 §3), which
  confirms the rule. **Conflict:** ADR-0005 decision 2 names the CLI as the launcher candidate for Remote-SSH, and
  ADR-0006 decision 3 defines `cliDownloadUrlTemplate`. The SSH spec leaves neither a role. The CLI stays relevant to
  Tunnels only, and there the host side is core's (F-8902), so the open point is the local relay (question 4).
- **ADR-0006.** The profile is read once per session in A7, and nothing else in area A reads `product.json`.
  Data folder, launcher and terminal command come from it (F-3902 rule 7). Three differences from the specs:
  1. ADR-0006 lists the placeholder `${applicationName}` and not `${release}`. F-3902 rule 3 and F-1402 list
     `${release}` and not `${applicationName}`.
  2. ADR-0006 makes every unknown placeholder an error. F-3902 rule 3 skips a bad product template with a log line
     and shows a dialog only for the setting.
  3. The override settings differ by extension. Dev Containers uses `remote.serverDownloadBaseUrl`, in any layer and
     either a base URL or a template. Remote-SSH uses `remote.SSH.serverDownloadUrlTemplate`, in the user layer only.
  A7 therefore takes a per-extension override policy, not one table entry.
- **Licence gate.** One gate in A9 serves every extension, but the specs define "Microsoft-licensed" in two ways.
  F-1402 rule 5 asks whether the client's `serverLicense` is non-empty. F-3902 rule 11 decides by the source URL's
  host plus three cases. The gate needs one rule from the register (question 2).

## 5. Open questions (batched for the lead; none asked on an issue yet)

1. **ADR-0005/0006 vs F-3902 rule 5 (register).** Accept that Remote-SSH never uses the editor CLI. Then mark
   ADR-0005 decision 2 and ADR-0006 decision 3 as Tunnels-only or withdrawn.
2. **Licence test (register, R-68).** F-1402 rule 5 tests the client's `serverLicense`, while F-3902 rule 11 tests
   the source host. Which test binds the shared gate?
3. **Placeholders and override semantics (ADR-0006 revision).** Adopt `${release}`, keep `${applicationName}`, and
   allow the per-extension override policies of section 4.
4. **Tunnels relay (srv#12 F-8103, srv#19 F-8902).** The reference's relay is the editor CLI running locally. One
   option is the editor CLI under ADR-0005, fetched per R-47. The other is the MIT dev-tunnels client in the
   extension host with a `ManagedResolvedAuthority`, which needs no binary. I recommend the second. F-8902 is still
   proposed, so A13 waits.
5. **ssh#29 F-2202 BR-21.** Must the host match-back reproduce its divergence from OpenSSH? Or may A5 use `ssh -G`?
6. **ssh#20 F-2102 Q1, ssh#38–#40 Q1 (Windows clients).** Named pipes for askpass and prompt hand-over, and no
   ControlMaster. These need a Windows run before A3 and A4 contracts are final.
7. **Reference hangs.** These specs record a hang and offer a fix: ssh#22 F-2104 Q1, ssh#21 F-2103 Q1, ssh#37
   F-2304 Q2, ssh#41 F-2308 Q3 and Q4, ssh#50 F-2405 Q3, ssh#53 F-2408 Q1. I propose one family rule: end with
   F-2601's dialog after a bound wait. Each spec still needs its decision.
8. **ssh#26 F-2108.** The pre-connection script sits in E21, but it is a pre-step with a modal confirmation. I placed
   it in A6. Confirm, or move it to B.
9. **ssh#30 F-2203 and ssh#31 F-2204 are split features.** B owns the pickers, the input box, the tab-scoped save
   watch and the `remote-internal.sshHostsChanged` signal; A owns the file list, the parser and the Host-block
   writer. For the one-owner rule I traced F-2203 to B and F-2204 to A5. Confirm, or allow a split row in the
   traceability matrix.
10. **ssh#76 F-2703 Q2 and ssh#77 F-2704 Q1 (bootstrap shell).** Our build always installs directly, which is the
    reference's legacy path, and that path needs `bash` (F-2703 7.E1) and times out under a fish login shell. I
    recommend that A8's POSIX script runs under `sh` started explicitly, so BusyBox, ash, dash and fish hosts work
    as in the reference's default mode. This needs the spec's decision.
11. **ctr#103 F-1302.** Where the server download runs for containers over SSH: on the client and copied, or on the
    remote host.

## 6. The conformance picture

- **remote-ssh and remote-server have no suite yet.** Their acceptance criteria assume channels the runner lacks:
  sshd logs, host file listings, host process lists, client process lists and listening ports, the extension's log.
- **remote-containers** has a suite, but among area A features only F-0419 has cases (66). F-0503, F-0505, F-0502,
  F-1102 and F-1302 have none. The runner is black-box. It observes the UI (titles, dialogs, notifications, the
  status bar, quick picks, views) and Docker state, and nothing else: no log, process or in-container file channel.
- **Profiles.** All 44 profiles are VS Code 1.139.1 on linux/arm64 with a local engine. There is no VSCodium or
  synthetic-product profile, which ADR-0006 decision 6 requires, and the README does not say how the runner enables
  proposed API.
- **What a build must expose.** A VSIX with the verbatim command titles, dialog texts and button order. The identity
  values in the runner's `identity.yaml`. Status bar items whose ids contain the extension id. The same Docker objects
  and labels.
- **Area A needs from the suite owner.** Before A's features can be "done", the suite needs:
  1. an `sshtarget` host profile with host-side observations: files under the data folder, processes by name, the
     sshd log;
  2. a client-side observation of listening ports and child processes;
  3. product profiles for VSCodium and a synthetic product;
  4. the proposed-API enablement in the editor fixture.
  No test hooks are needed in the build: every A contract above is observable from those channels.
