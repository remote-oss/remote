# remote-extensionpack catalogue: adversarial second read

Row file: `remote-extensionpack-17.json` (6 rows). Issues read: #5 to #10 (gh issue view), 2026-10-06.
Only problems are listed.

## 1. Missing

- Every issue has a row and every row has an issue; ids match titles (#5 F-9001, #6 F-9002, #7 F-9101, #8 F-9102, #9 F-9103, #10 F-9901).
- Label mismatch, F-9002 (#6): the row says `spec:needs-revision`, but GitHub has `spec:draft`. The row's first question rests on that wrong label, so drop it.
- Label mismatch, F-9103 (#9): the row says `spec:needs-revision`, but GitHub has `spec:draft`. The row's second question rests on that wrong label, so drop it.

## 2. Wrong or thin rows

- F-9002: acCount is 19 but the spec has 22 (AC-1 to AC-22).
- F-9103: acCount is 23 but the spec has 29 (AC-1 to AC-29).
- F-9002: cites leave out F-0109 (remote-containers#90, the command-catalogue contract) and F-1403 (remote-containers#39, named as not applying).
- F-9103: cites leave out F-0505 (remote-containers#37), F-6001 (remote-wsl#12) and F-8104 (remote-server#13), which are the member rooms' specs on extension placement.
- F-9901: cites leave out F-1403 (remote-containers#39), F-1405 (remote-containers#56) and F-4901 (remote-ssh-edit#6).
- F-9001: the row cites F-5901, but #5 never names it. The id exists (remote-explorer#7), but it reached this row from F-9901. Move it or mark it as inherited.
- F-9101: the row cites F-7901, F-1406, F-3901 and F-8901, but #7 names none of them. It names only the member room repos. These cites are inherited from F-9901; mark them so.
- F-9901: `external.proposedApi` is empty, yet the decision depends on the proposed-API enablement route (F-1403) and on the editor product keys `extensionEnabledApiProposals`, `remoteExtensionTips`, `exeBasedExtensionTips`. Add these as external, product-configuration dependencies.
- F-9101: the external list leaves out the editor product configuration (gallery entry and trusted publishers). These decide 7.E8, 7.E10 and 7.E11.
- F-9101: the core command `workbench.action.showWindowLog` (the log link in the install-error notification) is not listed.
- F-9001 and F-9002: the editor product key `extensionsGallery` is a declared input (section 10), but the rows list it nowhere.
- F-9001, F-9002, F-9101, F-9102: `http.proxy` (and `http.proxySupport` in #5/#6) is a section 10 input in each spec. No row lists it. F-9102 lists its other core settings, so the rows are also inconsistent with each other.
- F-9001: `extensions.autoUpdate` and `extensions.autoCheckUpdates` are section 10 inputs; the row's settings list is empty.
- F-9102: the core global-state key `extensions.dismissedNotifications` (dismissing the restart banner) is not listed under other or localFiles.
- F-9102: the menus list leaves out the core action "Developer: Restart Extension Host" (7.E5, AC-24) and the CLI form `--install-extension` used in 6.6/6.7.
- F-9103: the row button "Install Locally" and the workspace-trust input (Restricted Mode, 7.E2) are not in surfaces. `authorities` lists four kinds, but the spec only spells out `ssh-remote+`; the others appear only as window types.
- Error paths: all six counts agree with section 7 (5, 6, 13, 9, 6, n/a). No undercount.
- Questions to add (spec cites material not for the clean side): #5 cites `observations/F-9001` (many times) and #10 cites `observations/F-9901` notes. #7, #8 and #9 cite lab notes too.

## 3. Component doubts

- F-9001 (`pack.manifest-data`) and F-9002 (`pack.readme-listing`) both own the `repository` and `bugs` links (META:links vs LISTING:links). Fix: `pack.manifest-data` alone owns the link values, and `pack.readme-listing` only consumes them for BR-16.
- F-9001 and F-9101 both state `engines.vscode`. F-9101 gives the reference floor; F-9001 owns the rule. Fix: put the engine floor only in `pack.manifest-data` and have F-9101 point to it.
- F-9102 `pack.lifecycle-conformance` and F-9103 `pack.extension-kind` are both core behaviour with no owned code. Only the `extensionKind ["ui"]` field is pack-owned. Fix: fold that field into `pack.manifest-data`, and merge the two into a single conformance-only component, e.g. `pack.core-conformance`, so the build does not plan code for them.
- F-9101 `pack.member-list` and F-9901 `pack.identity` both hold the four ordered member ids. Fix: one source in `lib-identifiers` that both consume.
- The R-46 "outside its context" error paths in #5, #7 and #8 do nothing for a pack with no commands, yet they count toward errorPaths. Flag them, or leave them out of the component's error budget.

## 4. Dangling citations

- None. These ids were checked and exist: F-0109 (containers#90), F-0505 (#37), F-1401 (#38), F-1403 (#39), F-1404 (#55), F-1405 (#56), F-1406 (#107), F-6001 (wsl#12), F-7901 (wsl#11), F-3901 (ssh#78), F-4901 (ssh-edit#6), F-5901 (explorer#7), F-8104 (server#13), F-8901 (server#7).

## 5. Shared-behaviour candidates

- Member and reference id table: F-9901 with F-1406, F-7901, F-3901, F-4901, F-5901 and F-8901. Make it one `lib-identifiers` table, which also covers the pack lists of remote-ssh and remote-server.
- Placement by extension kind and "Install Locally" in remote windows: F-9103 with F-0505, F-6001 and F-8104. Make it one conformance fixture set or library of core behaviour.
- Localized display-name bundles (D-41): F-9001 with F-5901. Use one bundle layout and one build-time check.
- `bugs` URL form for the Issue Reporter: F-9001 with F-5901 §3. Use one manifest-check rule.
- Publishing only on Open VSX and the gallery dependency: F-9901 and F-9002 with F-1404. Use one release-gate rule that checks every member id is on Open VSX first (the F-9101 question).
- No telemetry: F-9901 with F-1405 and F-8901. One family rule.
- `remote.SSH.defaultExtensions` (F-9103) belongs to remote-ssh. Point to that row instead of listing it here.
