# Component doubts

Source: the section 3 lists of the seven adversary files, 2026-10-06. Nothing here has been applied to candidateComponent, candidateLibrary or area. Format: id | current component / library / area | proposal | reason.


## remote-ssh

- F-2503 | ssh.history-service / lib-identifiers / B | one component ssh.companion-bridge in lib-companion; F-2503 keeps history store as sub-part; F-2001 cites it | same remote-internal.* commands listed under three names
- F-3906 | ssh.companion-bridge / lib-companion / B | one component ssh.companion-bridge in lib-companion; F-2503 keeps history store as sub-part; F-2001 cites it | same remote-internal.* commands listed under three names
- F-2001 | ssh.activation-manifest / lib-standdown / A | one component ssh.companion-bridge in lib-companion; F-2503 keeps history store as sub-part; F-2001 cites it | same remote-internal.* commands listed under three names
- F-2606 | ssh.chat-participant / none / B | one component decided by F-3907; F-2606 not a build target until then | both own remote.SSH.experimental.chat
- F-3907 | ssh.no-chat-surface / none / B | one component decided by F-3907; F-2606 not a build target until then | both own remote.SSH.experimental.chat
- F-2104 | ssh.tunnel-manager / lib-forwarding / A | one tunnel component: F-2104 transport, F-2507 core Ports integration on top | both claim the tunnel factory
- F-2507 | ssh.tunnel-factory / lib-forwarding / A | one tunnel component: F-2104 transport, F-2507 core Ports integration on top | both claim the tunnel factory
- F-2310 | ssh.hop-prompt-relay / lib-ssh / A | rename to ssh.prompt-relay (jump hosts) | same relay as F-2305..F-2307 with a hop prefix
- F-2603 | ssh.error-classifier.network / lib-ssh / A | one diagnostics library (e.g. lib-diagnostics) for F-2601..F-2605 | one classifier table split over lib-ssh, lib-forwarding, lib-authority, lib-log
- F-2604 | ssh.error-classifier.forwarding / lib-forwarding / A | one diagnostics library (e.g. lib-diagnostics) for F-2601..F-2605 | one classifier table split over lib-ssh, lib-forwarding, lib-authority, lib-log
- F-2601 | ssh.failure-dialog / lib-authority / B | one diagnostics library (e.g. lib-diagnostics) for F-2601..F-2605 | one classifier table split over lib-ssh, lib-forwarding, lib-authority, lib-log
- F-2602 | ssh.mitigation-picker / lib-authority / B | one diagnostics library (e.g. lib-diagnostics) for F-2601..F-2605 | one classifier table split over lib-ssh, lib-forwarding, lib-authority, lib-log
- F-2605 | ssh.session-hints / lib-log / A | one diagnostics library (e.g. lib-diagnostics) for F-2601..F-2605 | one classifier table split over lib-ssh, lib-forwarding, lib-authority, lib-log
- F-2001 | ssh.activation-manifest / lib-standdown / A | stand-down in lib-standdown only; F-3901 keeps identifiers | stand-down split across two libraries
- F-2006 | ssh.command-catalogue / lib-standdown / B | stand-down in lib-standdown only; F-3901 keeps identifiers | stand-down split across two libraries
- F-3901 | ssh.identity-and-standdown / lib-identifiers / B | stand-down in lib-standdown only; F-3901 keeps identifiers | stand-down split across two libraries
- F-2205 | ssh.name-validator / lib-identifiers / A | move to lib-ssh | host and user validation feeds config and connect flows, not product ids
- F-2304 | ssh.connect-progress / lib-log / A | move to lib-authority or the diagnostics library | progress and cancel drive the connection, not the log

## remote-containers

- F-0101 | containers.activation-and-identity / lib-product / C | fold F-1401 into F-1406's component; one library for all three | one identity decision; F-1406 supersedes F-1401
- F-1401 | containers.identity-and-authority-names / lib-identifiers / A | fold F-1401 into F-1406's component; one library for all three | one identity decision; F-1406 supersedes F-1401
- F-1406 | containers.identifiers-and-standdown / lib-standdown / A | fold F-1401 into F-1406's component; one library for all three | one identity decision; F-1406 supersedes F-1401
- F-0101 | containers.activation-and-identity / lib-product / C | F-1403 owns the proposed-API probe; F-0101 and F-1102 consume it | same behaviour under two names
- F-1403 | containers.proposed-api-gate / lib-product / A | F-1403 owns the proposed-API probe; F-0101 and F-1102 consume it | same behaviour under two names
- F-1102 | containers.tunnels-declaration / lib-forwarding / A | F-1403 owns the proposed-API probe; F-0101 and F-1102 consume it | same behaviour under two names
- F-0701 | containers.clone-volume-flow / none / C | one containers.clone-volume component, three entry points; F-0704 bootstrap | one clone pipeline, different inputs
- F-0702 | containers.clone-named-volume / none / C | one containers.clone-volume component, three entry points; F-0704 bootstrap | one clone pipeline, different inputs
- F-0703 | containers.clone-pr-volume / none / C | one containers.clone-volume component, three entry points; F-0704 bootstrap | one clone pipeline, different inputs
- F-0704 | containers.bootstrap-container / none / C | one containers.clone-volume component, three entry points; F-0704 bootstrap | one clone pipeline, different inputs
- F-0705 | containers.volume-explorer / none / C | F-0902 owns inspectDockerResource and removeRecentFolder; others mark referenced | two owners for two commands
- F-0902 | containers.row-actions / none / C | F-0902 owns inspectDockerResource and removeRecentFolder; others mark referenced | two owners for two commands
- F-0403 | containers.open-folder-flow / none / C | F-0902 owns inspectDockerResource and removeRecentFolder; others mark referenced | two owners for two commands
- F-1302 | containers.remote-host-gating / lib-authority / undecided | add an owned/referenced split to surfaces.commands | commands list mixes owned and referenced ids
- F-1301 | containers.wsl-docker-selection / lib-authority / D | add an owned/referenced split to surfaces.commands | commands list mixes owned and referenced ids
- F-0106 | containers.trust-gate / none / C | add an owned/referenced split to surfaces.commands | commands list mixes owned and referenced ids
- F-0301 | containers.config-discovery / lib-identifiers / C | add an owned/referenced split to surfaces.commands | commands list mixes owned and referenced ids
- F-0302 | containers.external-config-store / none / C | add an owned/referenced split to surfaces.commands | commands list mixes owned and referenced ids
- F-0201 | containers.cli-preflight / none / C | one engine-endpoint component; F-0207 drops SSH/GPG/X11 claims (F-1003, F-1004, F-1008 own them) | endpoint selection spread over three libraries
- F-0202 | containers.daemon-guard / none / C | one engine-endpoint component; F-0207 drops SSH/GPG/X11 claims (F-1003, F-1004, F-1008 own them) | endpoint selection spread over three libraries
- F-0205 | containers.remote-engine-endpoint / lib-forwarding / C | one engine-endpoint component; F-0207 drops SSH/GPG/X11 claims (F-1003, F-1004, F-1008 own them) | endpoint selection spread over three libraries
- F-0207 | containers.wsl-bridge / lib-forwarding / D | one engine-endpoint component; F-0207 drops SSH/GPG/X11 claims (F-1003, F-1004, F-1008 own them) | endpoint selection spread over three libraries
- F-1301 | containers.wsl-docker-selection / lib-authority / D | one engine-endpoint component; F-0207 drops SSH/GPG/X11 claims (F-1003, F-1004, F-1008 own them) | endpoint selection spread over three libraries
- F-0410 | containers.recovery-handler / lib-standdown / C | lib-authority or none instead of lib-standdown | recovery container is not coexistence
- F-1001 | containers.gitconfig-copier / lib-identifiers / C | no better library; revisit | lib-identifiers does not fit
- F-1202 | containers.connection-probe / lib-log / C | lib-authority instead of lib-log | it is a connection probe
- F-0603 | containers.partner-menus / none / C | lib-companion (as F-1404) | partner menus currently none
- F-0108 | containers.ui-vocabulary / undecided / C | decide library and area | both undecided
- F-1302 | containers.remote-host-gating / lib-authority / undecided | decide library and area | both undecided
- F-1405 | containers.no-telemetry / none / C | area A like the other decision rows | only decision row in area C
- F-0811 | containers.copilot-config-command / none / C | clean the reuse field | holds a command id, an undecided note, and openssh-none
- F-0604 | containers.k8s-attach / lib-authority / C | clean the reuse field | holds a command id, an undecided note, and openssh-none
- F-0502 | containers.resolver / lib-authority / C | clean the reuse field | holds a command id, an undecided note, and openssh-none

## remote-explorer

- F-5901 | explorer.identity-and-standdown / lib-standdown / B | merge into one component; stand-down step in lib-standdown; name key remote-explorer.serving in F-5901 | same package/activation/stand-down behaviour, libraries disagree
- F-5001 | explorer.package-and-activation / lib-identifiers / B | merge into one component; stand-down step in lib-standdown; name key remote-explorer.serving in F-5901 | same package/activation/stand-down behaviour, libraries disagree
- F-5002 | explorer.command-catalogue / lib-identifiers / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5101 | explorer.targets-view / none / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5102 | explorer.ssh-host-list / lib-ssh / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5103 | explorer.connect-actions / lib-authority / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5104 | explorer.recent-folders / lib-authority / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5201 | explorer.tunnels-signin-group / none / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5202 | explorer.tunnel-machines / lib-companion / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5001 | explorer.package-and-activation / lib-identifiers / B | one shared no-row command-guard helper reused by all 13 handlers; F-5002 library is not lib-identifiers | R-46 guard repeated in 7 rows
- F-5102 | explorer.ssh-host-list / lib-ssh / B | lib-companion; drop remote-ssh-config-parser reuse | hosts come from the companion, no file reading
- F-5201 | explorer.tunnels-signin-group / none / B | lib-companion; doubt about core-authentication reuse | sign-in state lookup is part of the companion contract
- F-5104 | explorer.recent-folders / lib-authority / B | add lib-companion beside lib-authority | history read and delete go through the companion
- F-5103 | explorer.connect-actions / lib-authority / B | drop editor-cli from reuse | neither issue uses the CLI
- F-5104 | explorer.recent-folders / lib-authority / B | drop editor-cli from reuse | neither issue uses the CLI
- F-5301 | explorer.family-matrix / none / B | mark as test target, no component | integration matrix, not runtime
- F-5202 | explorer.tunnel-machines / lib-companion / B | companions belong in reuse (processes already emptied) | they are not processes

## remote-extensionpack

- F-9001 | pack.manifest-data / none / B | manifest-data alone owns link values; readme-listing consumes | both own repository and bugs links
- F-9002 | pack.readme-listing / none / B | manifest-data alone owns link values; readme-listing consumes | both own repository and bugs links
- F-9001 | pack.manifest-data / none / B | engine floor only in pack.manifest-data | both state engines.vscode
- F-9101 | pack.member-list / none / B | engine floor only in pack.manifest-data | both state engines.vscode
- F-9102 | pack.lifecycle-conformance / none / B | fold extensionKind field into manifest-data; merge into one pack.core-conformance | core behaviour, no owned code
- F-9103 | pack.extension-kind / none / B | fold extensionKind field into manifest-data; merge into one pack.core-conformance | core behaviour, no owned code
- F-9101 | pack.member-list / none / B | one member-id source in lib-identifiers | both hold four ordered member ids
- F-9901 | pack.identity / lib-identifiers / B | one member-id source in lib-identifiers | both hold four ordered member ids
- F-9001 | pack.manifest-data / none / B | flag R-46 error paths as outside the error budget | pack has no commands
- F-9101 | pack.member-list / none / B | flag R-46 error paths as outside the error budget | pack has no commands
- F-9102 | pack.lifecycle-conformance / none / B | flag R-46 error paths as outside the error budget | pack has no commands

## remote-server

- F-8001 | tunnels.extension-shell / lib-product / A | one lib-standdown component; F-8901 decides, F-8001 consumes | stand-down split across rows
- F-8901 | server.identity-and-standdown / lib-identifiers / B | one lib-standdown component; F-8901 decides, F-8001 consumes | stand-down split across rows
- F-8101 | tunnels.connect-picker / lib-server / A | all depend on tunnels.account-session; F-8102 to lib-server, not lib-authority | same account question under four names
- F-8102 | tunnels.account-session / lib-authority / A | all depend on tunnels.account-session; F-8102 to lib-server, not lib-authority | same account question under four names
- F-8103 | tunnels.resolver-relay / lib-forwarding / A | all depend on tunnels.account-session; F-8102 to lib-server, not lib-authority | same account question under four names
- F-8203 | tunnels.usage-limits / lib-server / A | all depend on tunnels.account-session; F-8102 to lib-server, not lib-authority | same account question under four names
- F-8103 | tunnels.resolver-relay / lib-forwarding / A | move to lib-authority; local relay stays in lib-forwarding | sibling resolvers live in lib-authority
- F-8301 | server.web-handoff / lib-authority / A | one server.web-entry component, one library | both web-only, same scheme
- F-8302 | server.web-welcome / lib-product / A | one server.web-entry component, one library | both web-only, same scheme
- F-8001 | tunnels.extension-shell / lib-product / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8002 | tunnels.help-commands / lib-product / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8101 | tunnels.connect-picker / lib-server / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8102 | tunnels.account-session / lib-authority / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8103 | tunnels.resolver-relay / lib-forwarding / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8104 | tunnels.host-software / lib-server / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8201 | tunnels.explorer-data-api / lib-companion / B | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8202 | tunnels.port-forwarder / lib-forwarding / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8203 | tunnels.usage-limits / lib-server / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8301 | server.web-handoff / lib-authority / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8302 | server.web-welcome / lib-product / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8901 | server.identity-and-standdown / lib-identifiers / B | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8902 | server.tunnel-service-client / lib-server / A | pick one prefix, tunnels.* or server.* | mixed prefixes for one extension
- F-8001 | tunnels.extension-shell / lib-product / A | record that R-46 contract has no owner here; one component owns it | no catalogue issue in this repo
- F-8101 | tunnels.connect-picker / lib-server / A | record that R-46 contract has no owner here; one component owns it | no catalogue issue in this repo
- F-8201 | tunnels.explorer-data-api / lib-companion / B | record that R-46 contract has no owner here; one component owns it | no catalogue issue in this repo
- F-8301 | server.web-handoff / lib-authority / A | record that R-46 contract has no owner here; one component owns it | no catalogue issue in this repo

## remote-ssh-edit

- F-4002 | ssh-edit.activation / none / B | merge manifest identity data into one ssh-edit.manifest; F-4901 stays a decision row | three names for one identity data set (F-4002 and F-4003 rows already renamed to ssh-edit.*)
- F-4003 | ssh-edit.package-identity / lib-identifiers / B | merge manifest identity data into one ssh-edit.manifest; F-4901 stays a decision row | three names for one identity data set (F-4002 and F-4003 rows already renamed to ssh-edit.*)
- F-4001 | ssh-edit.language-registration / lib-identifiers / B | merge manifest identity data into one ssh-edit.manifest; F-4901 stays a decision row | three names for one identity data set (F-4002 and F-4003 rows already renamed to ssh-edit.*)
- F-4901 | ssh-edit.identity-manifest / lib-identifiers / B | merge manifest identity data into one ssh-edit.manifest; F-4901 stays a decision row | three names for one identity data set (F-4002 and F-4003 rows already renamed to ssh-edit.*)
- F-4201 | ssh-edit.keyword-completion / lib-identifiers / B | one ssh-edit.completion component with a keyword-table module | four names for one completion provider
- F-4202 | ssh-edit.tunnel-snippet / lib-identifiers / B | one ssh-edit.completion component with a keyword-table module | four names for one completion provider
- F-4203 | ssh-edit.completion-positions / lib-identifiers / B | one ssh-edit.completion component with a keyword-table module | four names for one completion provider
- F-4902 | ssh-edit.keyword-catalogue / none / B | one ssh-edit.completion component with a keyword-table module | four names for one completion provider
- F-4201 | ssh-edit.keyword-completion / lib-identifiers / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4902 | ssh-edit.keyword-catalogue / none / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4101 | ssh-edit.grammar / lib-identifiers / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4102 | ssh-edit.language-configuration / lib-identifiers / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4202 | ssh-edit.tunnel-snippet / lib-identifiers / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4203 | ssh-edit.completion-positions / lib-identifiers / B | library none or an ssh_config keyword library, not lib-identifiers | not identifiers; F-4201 and F-4902 disagree
- F-4204 | ssh-edit.no-aids-contract / none / B | mark none | conformance tests only

## remote-wsl

- F-6208 | wsl.failure-dialog / lib-standdown / A | lib-failure (or lib-server) shared with F-2601 and F-0410 | failure dialog and watchdog are not stand-down
- F-6201 | wsl.resolver / lib-authority / A | F-6205 owns label formatter; drop from F-6201 | same formatter in two rows
- F-6205 | wsl.label-formatters / lib-authority / D | F-6205 owns label formatter; drop from F-6201 | same formatter in two rows
- F-6201 | wsl.resolver / lib-authority / A | F-6301 owns download state keys | same global-state keys in both
- F-6301 | wsl.server-installer / lib-server / A | F-6301 owns download state keys | same global-state keys in both
- F-6201 | wsl.resolver / lib-authority / A | F-6303 owns server-env-setup; others cite | same file in three rows
- F-6208 | wsl.failure-dialog / lib-standdown / A | F-6303 owns server-env-setup; others cite | same file in three rows
- F-6303 | wsl.server-env / lib-server / A | F-6303 owns server-env-setup; others cite | same file in three rows
- F-6401 | wsl.shell-handoff / lib-server / D | one installer component; set F-6401 coreUi false | two download paths; distro shell flow
- F-6301 | wsl.server-installer / lib-server / A | one installer component; set F-6401 coreUi false | two download paths; distro shell flow
- F-6203 | wsl.open-folder / none / D | one wsl.path-mapping helper | UNC to wsl+ mapping done three times
- F-6204 | wsl.reopen-translate / none / D | one wsl.path-mapping helper | UNC to wsl+ mapping done three times
- F-6503 | wsl.explorer-recent-folders / none / B | one wsl.path-mapping helper | UNC to wsl+ mapping done three times
- F-6201 | wsl.resolver / lib-authority / A | one wsl.distro-list component owned by F-6202 (no row yet) | wsl.exe listing in four rows
- F-6203 | wsl.open-folder / none / D | one wsl.distro-list component owned by F-6202 (no row yet) | wsl.exe listing in four rows
- F-6205 | wsl.label-formatters / lib-authority / D | one wsl.distro-list component owned by F-6202 (no row yet) | wsl.exe listing in four rows
- F-6204 | wsl.reopen-translate / none / D | one wsl.distro-list component owned by F-6202 (no row yet) | wsl.exe listing in four rows
- F-6003 | wsl.help-contrib / lib-identifiers / B | lib-help or none (same as F-0105) | help block is not identifiers
- F-6301 | wsl.server-installer / lib-server / A | split product.json derivation into a server-source resolver like F-1402 and F-3902 | resolver done inside installer

## Conventions chosen while applying the corrections

- surfaces.settings now means keys the feature owns or reads (F-2411, F-2501, F-8002 and others list read keys, tagged where it matters).
- Resolvers proposal: every A-area connection row named by the ssh adversary got `resolvers` in proposedApi, applied to all 21 rows alike.
- Cites are normalised to the repo that holds the id by its epic range; self-cites dropped; malformed `remote-containers#906` style cites turned into `F-0906` ids.
- Cites naming ids with no row (remote-wsl F-6004, F-6101, F-6202, F-6206 and similar) stay: the wsl catalogue has 13 rows only.

## Adversary claims rejected (checked against the issue)

- containers F-0705 acCount: row 37, issue has 37 distinct AC ids; adversary said 40. Left.
- ssh-edit F-4203 acCount: row 24, issue shows 24 distinct AC ids (last is AC-24); adversary said 25. Left; only the numbering note is open.
- wsl F-6401 acCount: adversary agreed the row (35) matches; the issue shows 36 distinct ids with AC-22 removed. Left, flagged here.

## Not applied (judgement or no concrete fix)

- Error-path overcounts (verified in the issues): containers F-0410 8 vs 5, F-0601 12 vs 8, F-0801 16 vs 12, F-0901 7 vs 4, F-0902 9 vs 6; decision rows F-1401..F-1406 carry 1-4 paths with no 7.E section; ssh F-2205, F-2402, F-2703 over by 1-2. Only undercounts were fixed (wsl F-6401, F-6503).
- containers F-0102: the 29 dev.containers.* keys stay listed; adversary says they belong to other features.
- explorer F-5102: localFiles and workspace.fs left, pending the companion-only decision above.
- wsl F-6401: empty stableApi left, adversary only asks to check.
- containers F-0107: command list still partial (about 20 view-row ids, explorer*Refresh and similar, not enumerated).
- pack F-9001, F-9101 inherited cites: kept and marked in notes, not removed.
- Cites with no support in the issue body were removed after checking: ssh F-2104 (F-2507), F-2310 (F-3903), F-2403 (F-2103), F-3904 (F-3905), containers F-0407 (F-0505), F-0808 (F-0207).
