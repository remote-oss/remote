# remote-server catalogue: adversarial second read

Sources: rows in remote-server-18.json and remote-server-19.json, checked against issues #7 to #19 of remote-oss/remote-server (gh issue view, 2026-10-06). This file lists problems only.

## 1. Missing

- Every published issue has a row, and every row has an issue. All 13 ids match their issue titles and numbers.
- None found.

## 2. Wrong or thin rows

Metadata:

- Label drift. The issue says `spec:draft` but the row says `spec:needs-revision` for F-8001 (#8), F-8101 (#10), F-8102 (#11), F-8104 (#13) and F-8201 (#14).
- acCount is too low in three rows:
  - F-8102: the row says 24, the issue has AC-1..26.
  - F-8104: the row says 25, the issue has AC-1..30.
  - F-8201: the row says 26, the issue has AC-1..34.
- errorPaths: all rows match the 7.E counts in their issues. No row is off by more than 2.

Cites missing (the issue names the id, the row leaves it out):

| Row | Ids the row leaves out |
|---|---|
| F-8001 | remote-explorer#F-5201, #F-5202, #F-5902; remote-server#F-8104, #F-8203 |
| F-8002 | remote-explorer#F-5201, #F-5202; remote-server#F-8201, #F-8203, #F-8301 |
| F-8101 | remote-containers#F-1403; remote-server#F-8001 |
| F-8102 | remote-server#F-8001 |
| F-8103 | remote-server#F-8001 |
| F-8104 | remote-explorer#F-5201, #F-5202; remote-server#F-8001 |
| F-8201 | remote-containers#F-1403; remote-server#F-8001, #F-8104, #F-8902 |
| F-8202 | remote-containers#F-1403; remote-server#F-8902 |
| F-8203 | remote-server#F-8902 |
| F-8902 | remote-containers#F-1406 |

Surfaces and dependencies the rows leave out:

- **F-8001:** context key `remote-tunnels.entriesEnabled` is present, but the core command `workbench.extensions.search` is not listed under external. Neither is the core setting `security.workspace.trust.enabled`, which the Restricted Mode flow depends on. Menu group `remote_10_tunnel_0_remote@1` is also missing.
- **F-8002:** settings is empty. The Settings command exposes `remote.tunnels.alwaysUpdateCLI`, `remote.tunnels.defaultExtensions` and `remote.tunnels.tunnelCredentialCommand`, so list them as read-only references. The core command `workbench.action.openSettings` and the core setting `workbench.editor.useModal` are also missing.
- **F-8101:**
  - Context key `remote-tunnels.entriesEnabled` is missing, though the issue gates both menu entries on it.
  - `remote-tunnels.connectNewWindowToTunnel` is missing as a variant of the same flow.
  - Settings `remote.tunnels.tunnelCredentialCommand`, `remote.tunnels.alwaysUpdateCLI` and `remote.tunnels.defaultExtensions` are missing as inputs.
  - The optional core command `workbench.remoteTunnel.actions.turnOn` (7.E1 option a) is missing.
- **F-8103:** the core commands `workbench.action.remote.close` (Close Connection, option b) and `workbench.action.closeRemoteConnection` are missing. The second is the id the reference calls, which does not exist in core.
- **F-8104:** the core settings `remote.tunnels.access.hostNameOverride` and `remote.tunnels.access.preventSleep` are missing. They share the `remote.tunnels.*` namespace and the Settings search shows them alongside this feature's settings.
- **F-8201:**
  - Settings read through Remote Explorer are missing: `remote-explorer.foldersSortOrder`, `remote-explorer.collapseRecentFolders` and `workbench.iconTheme`.
  - The process `code tunnel unregister` is missing; Unregister is the equivalent of that host command.
  - The core setting `security.workspace.trust.enabled` is missing.
- **F-8202:**
  - Core port settings are missing: `remote.autoForwardPorts`, `remote.autoForwardPortsSource`, `remote.portsAttributes`, `remote.otherPortsAttributes` and `remote.restoreForwardedPorts`.
  - The core command `remote.tunnelsView.makePublic` (web flow 6.4) is missing.
  - Core global-storage keys `remote.tunnels.toRestore.*` and `remote.tunnels.toRestoreExpiration.*` are missing under localFiles.
- **F-8301:** the core setting `security.promptForRemoteFileProtocolHandling` and menu group `remote_10_tunnel_0_remote@1` are missing.
- **F-8302:** the view is given as `explorer`. The resolved view id `workbench.explorer.emptyView` is missing.
- **F-8901:**
  - The reserved core keys `remote.tunnels.access.hostNameOverride` and `remote.tunnels.access.preventSleep` are missing.
  - Product configuration keys are missing: `remoteExtensionTips.tunnel`, `tunnelApplicationConfig`, `extensionEnabledApiProposals` and `trustedExtensionAuthAccess`.
  - The core setting `workbench.remoteIndicator.showExtensionRecommendations` is missing.
  - The proposals `tunnels` and `contribViewsWelcome` appear as grants in the reference product configuration, and the 1.5.3 manifest requests only `resolvers`. The row should say this instead of listing them as requested.
- **F-8902:** "product configuration keys per build" is vague. Name `tunnelApplicationName` and `tunnelApplicationConfig`, and the `authenticationProviders` key inside it.

Clean-side flags missing:

- These rows do not raise "spec cites material not for the clean side", although their issues carry many lab observation ids (S-refs, more than 70 each): F-8002, F-8101, F-8102, F-8103, F-8201, F-8202 and F-8203. F-8104 mentions it only in notes.

## 3. Component doubts

1. **Stand-down is split across two rows.** F-8001 (lib-product) and F-8901 (lib-identifiers) both describe the R-54 stand-down, the gating key and startup activation.
   - Fix: one component, `lib-standdown`. F-8901 owns the decision and F-8001 consumes it. Remove the stand-down item from F-8001 `other`.
2. **The account question appears under several names.** F-8101 (connect-picker, lib-server), F-8103 (resolve, lib-forwarding) and F-8203 (usage-limits, lib-server) each run the same account-type question and session fetch that F-8102 specifies (account-session, lib-authority).
   - Fix: all four depend on `tunnels.account-session`, and F-8102's library should be `lib-server` or a tunnels auth library, not lib-authority.
3. **The resolver sits in the wrong library.** F-8103 is the `tunnel` authority resolver but is placed in lib-forwarding. Sibling resolvers (remote-ssh F-2501, remote-wsl F-6201, remote-containers F-0502) suggest lib-authority.
   - Fix: move it to lib-authority, and keep only the local relay in lib-forwarding.
4. **The web entry epic E83 is split.** F-8301 (server.web-handoff, lib-authority) and F-8302 (server.web-welcome, lib-product) are both web-only, small, and both handle the `vscode-remote` scheme.
   - Fix: one component, `server.web-entry`, with one library.
5. **Component prefixes are mixed.** Some rows use `tunnels.*` and others use `server.*` for the same extension.
   - Fix: pick one prefix.
6. **One command-catalogue contract has no owner.** F-8001, F-8101, F-8201 and F-8301 each hold part of the R-46 out-of-context contract. There is no command-catalogue issue in this repo, while remote-explorer has F-5002 and remote-ssh has F-2006.
   - Fix: the catalogue notes that the contract has no single owner, and one component owns it.

## 4. Dangling citations

- None. Every cited id exists:
  - remote-containers: F-0101, F-1401 to F-1406.
  - remote-explorer: F-5001, F-5104, F-5201, F-5202, F-5901, F-5902.
  - remote-server: F-8001 to F-8902.

## 5. Shared-behaviour candidates

1. **Identity card, verbatim identifiers and the R-54 stand-down:** F-8901 here, plus remote-explorer F-5901, remote-ssh F-3901, remote-ssh-edit F-4901, remote-wsl F-7901, remote-extensionpack F-9901, remote-containers F-1401 and F-1406. Share as one `lib-identifiers` plus `lib-standdown`. F-8901 already asks this.
2. **Help, Settings and Report Issue commands:** F-8002 here, plus remote-ssh F-2004 and F-2005, remote-wsl F-6003, remote-containers F-0105. Share as one help-commands library.
3. **Package, activation, l10n and trust:** F-8001 here, plus remote-explorer F-5001, remote-ssh F-2001 and F-2002, remote-ssh-edit F-4002 and F-4003, remote-wsl F-6001 and F-6005, remote-containers F-0101. Share as one `lib-product`.
4. **Default extensions on the remote:** `remote.tunnels.defaultExtensions` in F-8104, remote-ssh F-2506, remote-containers F-0505. The same install-on-connect behaviour should be one library.
5. **Folder history behind the Remotes view:** F-8201, remote-explorer F-5104 and F-5902, remote-wsl F-6503. This is one companion data API (lib-companion) with one history store shape.
6. **Server download on the host:** F-8104, remote-ssh F-2403, remote-wsl F-6301, remote-containers F-0503. The host CLI does it here, but the progress and failure surfaces overlap.
7. **Proposed API enablement:** `resolvers` in F-8001 and F-8103, remote-containers F-1403, remote-ssh F-3903. Share as one enablement path.
8. **Remote authority resolver skeleton:** F-8103, remote-ssh F-2501, remote-wsl F-6201, remote-containers F-0502.
9. **Port forwarding provider:** F-8202, remote-ssh F-2507, remote-containers F-1102.
