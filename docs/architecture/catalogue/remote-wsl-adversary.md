# remote-wsl catalogue: adversarial second read

Rows checked: remote-wsl-32.json, remote-wsl-33.json (13 rows). Issues read: #11, #12, #13, #14, #20, #22, #23, #24, #27, #28, #30, #32, #36 (gh issue view, 2026-10-06). Only problems are listed.

## 1. Missing

None. All 13 issues have exactly one row; ids, issue numbers, titles, epics and labels match. acCount matches every spec (F-6401: 36 AC ids, AC-22 removed, 35 matches the row).

## 2. Wrong or thin rows

Surfaces left out of the rows (the spec declares them in 3.1/3.2 or in section 10, Configuration inputs):

| Row | Left out |
|---|---|
| F-6001 | commands: the spec's 3.1 table gives when-clauses for 7 more ids: `remote-wsl.connectInNewWindow`, `connectUsingDistro`, `connectUsingDistroInNewWindow`, `getHelp`, `provideFeedback`, `reportIssue`, `reopenInWindows`. Settings is empty, but section 10 lists `security.workspace.trust.enabled`, `extensions.supportUntrustedWorkspaces`, `extensions.supportVirtualWorkspaces`, `extensions.webWorker`, `remote.extensionKind`, `terminal.integrated.allowInUntrustedWorkspace` |
| F-6001 | proposedApi lists `telemetry` as needed, but the spec says it is not needed (R-28). It belongs in the manifest inventory only |
| F-6002 | settings: `terminal.integrated.allowInUntrustedWorkspace` (section 10) |
| F-6201 | settings is empty, but section 10 lists `remote.WSL.debug`, `remote.WSL.downloadInBackground`, `remote.WSL.experimental.scriptLessStartup`, `remote.WSL.useShellEnvironment`, `remote.WSL1.connectionMethod`, `remote.WSL2.connectionMethod` (the last two deprecated, no effect: these should still be recorded so the clean side knows to ignore them). Commands: `remote-wsl.showLog` is reached from the progress title (AC-3) |
| F-6203 | settings is empty; section 10 lists `security.allowedUNCHosts`, `window.openFoldersInNewWindow`, `files.simpleDialog.enable`, `window.dialogStyle`. The UNC shares are filed under `network`; they are local file-system paths and belong in localFiles |
| F-6204 | settings is empty; section 10 lists `security.allowedUNCHosts`, `security.restrictUNCAccess`, `window.openFoldersInNewWindow`. Also `remote-containers.reopenInWSL` (F-0406 boundary) is not recorded as an external command dependency |
| F-6205 | settings is empty; section 10 lists `window.title`, `window.titleSeparator` |
| F-6208 | settings is empty; section 10 lists `remote.WSL.debug`, `remote.WSL.downloadInBackground`, `remote.WSL.experimental.scriptLessStartup`, `window.dialogStyle`. Commands: `remote-wsl.showLog` |
| F-6301 | settings: `http.proxy`, `http.proxyStrictSSL`, `remote.WSL.experimental.scriptLessStartup`. Env inputs `http_proxy`, `https_proxy`, `NODE_EXTRA_CA_CERTS` are missing from external. Commands: `remote-wsl.showLog` |
| F-6303 | settings: `terminal.integrated.inheritEnv`, `terminal.integrated.env.linux`, `application.shellEnvironmentResolutionTimeout`. Commands: `remote-wsl.showLog` |
| F-6401 | env inputs `VSCODE_APPDATA`, `VSCODE_EXTENSIONS`, `WSLENV`, `PATH` and the `wsl.conf` key `[interop] appendWindowsPath` (section 10) are left out. stableApi is empty although the row's proposedApi and processes imply extension-host code. Check whether that is right |
| F-6503 | settings: `security.allowedUNCHosts` (used in the VS setup) |

Error paths: no row undercounts by more than 2. F-6401 (8 against 9 in the spec) and F-6503 (4 against 5) are each 1 short.

Cites the spec makes that the row leaves out:

| Row | Leaves out |
|---|---|
| F-6002 | F-6204, remote-containers#F-1403 |
| F-6003 | F-6201 |
| F-6201 | remote-containers#F-0109. The row also cites F-6002, which the spec never names by id |
| F-6203 | remote-containers#F-1403 |
| F-6204 | F-6301, remote-containers#F-1403 |
| F-6205 | remote-containers#F-1403 |
| F-6208 | F-6001, F-6202, F-6701, remote-containers#F-1403 |
| F-6301 | F-6001, F-6202, F-6205, remote-containers#F-1403 |
| F-6303 | F-6001, F-6206, remote-containers#F-1403, remote-containers#F-0109 |

Lab-note citations: only F-6208 and F-6401 record "spec cites material not for the clean side". These specs also cite observations/ lab notes and their rows do not flag it: F-6001 (#12), F-6003 (#14), F-6201 (#20), F-6203 (#22), F-6204 (#23), F-6301 (#28), F-6503 (#36). F-6401 also quotes a reference helper script path in its user-visible text table.

## 3. Component doubts

- **F-6208 to lib-standdown**: failure dialog, Retry and watchdog are not stand-down behaviour. Matching rows elsewhere are ssh F-2601 `ssh.failure-dialog` (lib-authority) and containers F-0410 `containers.recovery-handler` (lib-standdown). Proposal: one `lib-failure` (or fold into lib-server) for all three.
- **Label formatter in two rows**: F-6201.other has "static label formatter wsl+*" and F-6205.other has "static resourceLabelFormatter wsl+*". Proposal: F-6205 owns it; drop it from F-6201.
- **Global state keys in two rows**: F-6201 and F-6301 both list `wsl.downloadInProgress`, `wsl.lastUpdateCheck`, `wsl.usageTime.<platform>`. Proposal: F-6301 owns the download keys; F-6201 keeps only `extensionUsed` if it owns that one.
- **server-env-setup in three rows**: F-6201, F-6208 and F-6303 all list `~/.vscode-server/server-env-setup`. Proposal: F-6303 owns it; the others only cite it.
- **Two server download paths**: F-6401 (`wsl.shell-handoff`) has its own in-distro wget download and progress lines, and F-6301 (`wsl.server-installer`) has a wget fallback. Proposal: one installer component used by both. F-6401 coreUi true looks wrong (it is a distro shell flow); set it to false.
- **UNC to wsl+ mapping done twice**: F-6203 (`wsl.open-folder`, UNC to wsl+ URI) and F-6204 (`wsl.reopen-translate`, wslpath plus UNC share) both have library none. F-6503 also does case-insensitive distro matching. Proposal: one `wsl.path-mapping` helper shared by the three.
- **Distro listing in four rows**: `wsl.exe --list --verbose` is listed in F-6201, F-6203, F-6205 and F-6204 (the picker taken from F-6202). Proposal: one `wsl.distro-list` component, owned by F-6202 (no row in this batch).
- **F-6003 to lib-identifiers**: the help block is a manifest template plus URL opening, not identifiers. containers F-0105 `containers.help-commands` uses none. Proposal: lib-help, or none for both.
- **F-6301 product.json derivation**: done inside the installer. containers F-1402 and ssh F-3902 split this out as `*.server-source-resolver`. Proposal: split it out the same way, into lib-product or lib-server.

## 4. Dangling citations

- F-6001 and F-6201 cite `remote-wsl#F-1403`. remote-wsl has no F-1403; the id is remote-containers#F-1403.
- F-6301 cites `remote-ssh#server-install (remote-ssh room)`, which is not an id. Likely target: remote-ssh#F-2403 (`ssh.server-installer`), or F-3902.
- The prefix `containers#` is used in F-6001, F-6003, F-6204 and F-6208 (F-0109, F-0406). The repo is remote-containers, and other rows use `remote-containers#`. The ids exist, but the prefix does not resolve to a repo.

## 5. Shared-behaviour candidates

- **Server install cache and layout**: `~/.vscode-server/bin/<commit>` appears in containers F-0419, ssh F-2409/F-2413 and wsl F-6201/F-6301/F-6401. `~/.wgetrc` appears in ssh F-2403 and wsl F-6301. All should use one lib-server installer.
- **http.proxy handling**: containers F-0801/F-0804/F-0806, ssh F-2404/F-2405, and wsl F-6301 (missing from that row). One proxy-config helper.
- **Workspace trust, virtual workspaces and extensionKind gates**: `security.workspace.trust.enabled`, `extensions.supportUntrustedWorkspaces`, `remote.extensionKind` appear in ssh F-2001, ssh-edit F-4002, containers F-0106, explorer F-5902 and pack F-9103, and are missing from wsl F-6001. One manifest/stand-down helper (lib-standdown).
- **Failure dialog with Retry/Close, and the silence watchdog**: ssh F-2601, containers F-0410, wsl F-6208 (see section 3).
- **Log channel**: ssh F-2003, containers F-0104/F-0408, wsl F-6002, already under lib-log. Masking the token should be a single family rule.
- **Resource label formatter per authority**: ssh F-2502, containers F-0501, tunnels F-8103, wsl F-6205. lib-authority facility.
- **Help block and help commands**: containers F-0105, ssh F-3901, wsl F-6003. They sit in different libraries today (none / lib-identifiers); pick one.
- **Proposed-API enablement**: containers F-1403 and ssh F-3903 (lib-product). wsl has no own row and cites F-1403; confirm wsl reuses that component.
- **Reopen in X with path translation**: containers F-0406 (`remote-containers.reopenInWSL`) and wsl F-6204. Shared reopen helper, as F-6204's own question raises.
- **wsl.exe distro listing and command runner**: containers F-0207/F-0204/F-1301 and wsl F-6201/F-6203/F-6204/F-6205. One shared `wsl.exe` client library.
- **`/etc/wsl.conf` reading**: containers F-0204 and wsl F-6201/F-6204/F-6401.
