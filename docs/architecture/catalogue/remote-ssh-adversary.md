# remote-ssh catalogue: adversarial second read

Inputs: rows in remote-ssh-22.json to remote-ssh-31.json (75 rows), issues remote-oss/remote-ssh #11 to #85 (75 issues), read 2026-10-06. Only problems are listed. Checks were scripted (section 3.1/3.2/10/16 identifiers, owned atoms, metadata Depends on/Related, 7.E headings) and the hits then checked by hand.

## 1. Missing

| Problem | Detail | Fix |
|---|---|---|
| Issue with no row | #14 is F-2004 (help, get started, feedback, settings commands; remoteHelp). No F-2004 row exists. | Write an F-2004 row: commands opensshremotes.getHelp, .getStarted, .settings, .provideFeedback; atom HELP:remoteHelp; proposed contribRemoteHelp; context keys remoteName, remoteConnectionState, virtualWorkspace (when clauses); stable env.openExternal; 3 error paths (7.E1 to 7.E3); cites F-2001, F-3901, F-3903, F-2003, F-2005, F-2006, F-2007, F-3904, remote-containers#F-1403. |
| Row with no issue | Row F-4102 (issue 14, epic E41, label spec:reviewed) describes a remote-ssh-edit feature. remote-ssh#14 is F-2004, spec:draft. F-4102 already has its own row in the remote-ssh-edit files. | Delete the F-4102 row from remote-ssh-22.json. Its questions ("where does F-2004 live") are answered: #14. |
| Id disagrees with title | Row id F-4102 against issue #14 titled F-2004. No other mismatch in the 75 rows. | Same fix. |

## 2. Wrong or thin rows

Surfaces the rows do declare match the owned atoms of every issue except #14 (above) and F-3905. The gaps are in externals, settings that are read, and cites.

| Row | Gap | Fix |
|---|---|---|
| F-3905 | Owned atoms TEL:resolver, TEL:copilotChat, TEL:extraInfo are not in the row. | Add them to surfaces.other. |
| F-2501 | settings is empty, but section 10 reads 8 keys: configFile, connectTimeout, maxReconnectionAttempts, preconnect, reconnectionGraceTime, remotePlatform, remoteServerListenOnSocket, useLocalServer. proposedApi has only resolvers, but section 16 also names tunnels and tunnelFactory. stableApi is empty. | Add the read keys, tunnels and tunnelFactory, and the stable calls. |
| F-2507 | proposedApi lacks tunnels (named in section 16). stableApi is empty, but section 16 names workspace.openTunnel and workspace.getConfiguration. | Add them. |
| F-2505 | proposedApi is empty, but section 16 says reconnection runs through the resolvers proposal. stableApi is empty (workspace.getConfiguration is named). | Add resolvers and the stable call. |
| F-2301, F-2302, F-2303, F-2401, F-2402, F-2403, F-2404, F-2406, F-2407, F-2408, F-2504, F-2506, F-2508, F-2601, F-2603, F-2604, F-2701, F-2702, F-2703, F-2704, F-2008 (21 rows) | Section 16 names the resolvers proposal (most also name workspace.registerRemoteAuthorityResolver). proposedApi is empty in every one. | Either add resolvers to each row or record one rule: A-area connection rows inherit resolvers from F-2501. Pick one and apply it to all rows, not some. |
| F-2001 | stableApi lacks window.registerUriHandler, workspace.isTrusted, workspace.onDidGrantWorkspaceTrust (section 16). | Add them. |
| F-2504 | Owns ACT:onUri, but stableApi lacks window.registerUriHandler. | Add it. |
| F-2606 | stableApi lacks lm.selectChatModels, window.registerTerminalLinkProvider, window.createTerminal, window.showErrorMessage (section 16). | Add them. |
| F-2603, F-2604 | stableApi leaves out 3 to 5 calls that section 16 names (output channel, error message, quick pick or terminal, progress). | Add them. |
| F-2008 | Section 16 names 4 core chat.remoteAgentHost* settings. The row has none of them. | Add them as core settings that are read. |
| F-2411 | settings is empty, but section 10 reads 9 keys (configFile, connectTimeout, httpProxy, httpsProxy, path, remotePlatform, remoteServerListenOnSocket, useExecServer, useLocalServer). | Add them. The rows disagree on whether settings means owned keys or read keys (F-2413 lists keys it reads, F-2411 and F-2501 list none). Choose one meaning for all rows. |
| Error paths | No row undercounts by more than 2. Small differences: F-2205 row 12 vs 11, F-2402 row 8 vs 6, F-2703 row 7 vs 6 (all overcounts). | None needed. |
| Cites missing (metadata Depends on/Related not in cites) | F-2602: 12 ids (F-2006, F-2206, F-2403, F-2404, F-2405, F-2406, F-2407, F-2603, F-2604, F-2606, F-3901, F-3908). F-2601: 9 (F-2006, F-2101, F-2301, F-2302, F-2306, F-2401, F-2403, F-2502, F-3907). F-2603: 9 (F-2003, F-2201, F-2206, F-2304, F-2602, F-2604, F-2606, F-3901, F-3907). F-2501: 7 (F-2206, F-2503, F-2504, F-2506, F-2507, F-2508, F-3901). F-2604: 7 (F-2102, F-2103, F-2304, F-2603, F-2606, F-3901, F-3907). F-2409: 6 (F-2304, F-2401, F-2407, F-2408, F-2701, F-2702). F-2206: 3 (F-2006, F-3901, F-3908). F-2701: 3 (F-2006, F-2602, F-3903). F-2002: F-2001, F-2003. F-2605: F-3901, F-3907. F-2502 and F-2504: remote-containers#F-1403. One each: F-2103, F-2107, F-2109 (F-2006); F-2503 (F-2001); F-2702 (F-3901); F-2703 (F-2003). | Add them. |
| Cites with no support in the spec | F-2104 cites F-2507, F-2310 cites F-3903, F-2403 cites F-2103, F-3904 cites F-3905. None of these ids appears anywhere in the issue body. | Remove them, or note why they are kept. |

## 3. Component doubts

| Rows | Doubt | Proposed fix |
|---|---|---|
| F-2503 ssh.history-service (lib-identifiers) and F-3906 ssh.companion-bridge (lib-companion) | Both list the same remote-internal.* commands for the Remotes view, under two names in two libraries. F-2001 lists them a third time. | One component, ssh.companion-bridge in lib-companion. F-2503 keeps the folder-history store as a sub-part. F-2001 cites it and drops the command list. |
| F-2606 ssh.chat-participant and F-3907 ssh.no-chat-surface | Both own SET remote.SSH.experimental.chat and describe one behaviour (two outcomes of one decision). | One component, decided by F-3907. F-2606 should not become a separate build target until F-3907 is settled. |
| F-2104 ssh.tunnel-manager and F-2507 ssh.tunnel-factory (both lib-forwarding) | Both claim the resolver's tunnel factory (both proposedApi notes say so). | One tunnel component. F-2104 is the transport, F-2507 is the core Ports integration on top of it. |
| F-2310 ssh.hop-prompt-relay | F-2305, F-2306 and F-2307 share ssh.prompt-relay. Jump-host prompts are the same relay with a hop prefix. | Rename to ssh.prompt-relay (jump hosts). |
| F-2603 error-classifier.network (lib-ssh) and F-2604 error-classifier.forwarding (lib-forwarding) | One classifier split across two libraries. F-2601 and F-2602 (failure dialog and mitigation picker) sit in lib-authority, F-2605 in lib-log. | Put F-2601 to F-2605 in one diagnostics library (for example lib-diagnostics). The classifiers then feed one table. |
| F-2001 and F-2006 (lib-standdown) and F-3901 ssh.identity-and-standdown (lib-identifiers) | Stand-down is split across two libraries. | Stand-down lives in lib-standdown. F-3901 keeps only identifiers. |
| F-2205 ssh.name-validator (lib-identifiers) | Host and user validation feeds the config and connect flows (F-2201, F-2204, F-2301). It is not about product identifiers. | Move to lib-ssh. |
| F-2304 ssh.connect-progress (lib-log) | The progress and cancel UI drives the connection, not the log. | Move to lib-authority (next to the host picker and resolver), or to the diagnostics library above. |

## 4. Dangling citations

No cited id is missing from all seven repos. But 37 cites name a repo that does not hold the id:

- `remote-development#…` (19 cites): F-3901, F-3902, F-3903, F-3904, F-3905, F-3906 and F-3907 are remote-ssh ids. F-4901 is a remote-ssh-edit id. F-5901 is a remote-explorer id. remote-development holds orchestration records, not specs. Rows: F-2001, F-2002, F-2003, F-2005, F-2006, F-2007, F-2008 (and the stray F-4102).
- `unknown#…` (8 cites): F-2305, F-2306, F-2307 and F-2308 cite F-3901, F-3903 and F-3905 (all remote-ssh) and F-0109 (remote-containers).
- `remote-ssh#F-1403`, `remote-ssh#F-1406`, `remote-ssh#F-0109` (8 cites, in F-2205, F-2310, F-2311, F-2312, F-2406, F-2408, F-2504, F-3902): these are remote-containers ids.
- `remote-explorer#F-2503` (in F-2001 and F-2007): this is a remote-ssh id.
- `remote-ssh#F-2004` (in F-2005, F-2006, F-2007, F-2505, F-3901, F-3903): the id is valid (issue #14), but no row has it until the F-2004 row is written.

Fix: rewrite the prefixes. The cites were probably built from a guessed repo. Make the row generator resolve each id against the epic map instead.

## 5. Shared-behaviour candidates

Found by searching sibling repos' issues for the same keys and flows.

| Behaviour | remote-ssh rows | Also in | Proposal |
|---|---|---|---|
| SSH config file discovery and parsing, remote.SSH.configFile | F-2201, F-2202, F-2203, F-2204 | remote-ssh-edit F-4001, F-4002, F-4201, F-4204; remote-explorer F-5001, F-5002, F-5101 to F-5104, F-5301; remote-containers F-0417, F-0708, F-1002 | One lib-ssh-config (file list, Include and Match, host list) used by ssh, ssh-edit and explorer. |
| remote-internal.* folder and host bridge | F-2202, F-2503, F-3906 | remote-explorer F-5901, F-5902 | One interface package that both sides import (lib-companion). |
| remote.SSH.remotePlatform per host | F-2206 | remote-wsl F-6701 | Shared platform-store helper. |
| Server download source, serverDownloadUrlTemplate | F-3902, F-2403 | remote-server F-8902; remote-wsl F-6301; remote-containers F-1402 | One lib-server-source. |
| Default extensions on the remote | F-2506 | remote-server F-8001 to F-8104; remote-containers F-0505, F-0102; remote-extensionpack F-9103 | One default-extensions installer. |
| Authority resolver and resource label formatter | F-2501, F-2502 | remote-wsl F-6201, F-6205, F-6402, F-6701; remote-server F-8001, F-8103; remote-containers F-0501, F-0504, F-0601, F-0701 | One lib-authority skeleton (resolver registration, label formatter, reconnect). |
| Proposed-API enablement route and setup notification | F-3903, F-2001 | every sibling (containers F-1403, wsl F-6001 to F-6003, server F-8001, explorer F-5101, extensionpack F-9901) | One lib-product gate. |
| Stand-down when the reference extension is present | F-2001, F-2006, F-3901 | remote-explorer F-5001, F-5901; remote-server F-8001, F-8101, F-8901; remote-containers F-1406; remote-extensionpack F-9002, F-9901 | One lib-standdown. |
| l10n bundles and package.nls | F-2002 | all six siblings | One l10n build step. |
| Agent forwarding into the remote | F-2311 | remote-containers F-1003 (also F-1001, F-1004, F-1006, F-1007) | Shared agent-socket forwarder. |
| HTTP(S) proxy environment for server install | F-2404 | remote-containers F-0803 | Shared proxy-env helper. |
| Connection-token / server launch handshake | F-2409, F-2410 | remote-wsl F-6002, F-6201, F-6304; remote-containers F-0502, F-0503 | Shared server-launch library. |

Clean-side notes:
- No issue body looked like reference script text or lab transcripts. Several cite reference manifest paths and observation ids as provenance. F-3901 already records this in its row questions.
- To list sibling ids for section 4, the other catalogue JSON files in this folder were read for their id fields only.
