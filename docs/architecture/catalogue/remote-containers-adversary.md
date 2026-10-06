# remote-containers catalogue: adversarial second read

Date: 2026-10-06. Scope: 100 rows across 15 row files, checked against 100 issues fetched with `gh issue view`. Problems only.
Note on clean-side material: 99 of the 100 issue bodies have provenance lines that point at `sources/` paths. 29 of them mention lab transcripts and 29 mention `evidence/` packs (#61 mentions script text, #93 and #112 mention lab tools). Spec cites material not for the clean side. I did not follow any of it.

## 1. Missing

- Issue/row coverage: none missing. Every listed issue has one row, and every row maps to its issue. All 100 ids match their titles.
- Title text disagrees: F-1401 (#38). The row says "extension id", the issue title says "extension identity".
- Label disagrees with the issue:
  - F-0301 (#20) and F-0409 (#23): the row says `spec:draft`, the issue says `spec:reviewed`.
  - F-1102 (#58) and F-1403 (#39): the row says `spec:reviewed`, the issue says `spec:draft`.

## 2. Wrong or thin rows

**Surfaces**
- F-0107 (#51), commands:
  - The spec owns 58 palette-gated ids. The row omits about 30 of them, including `createDevContainer`, `createDevContainerFile`, `createDevContainerFileWithCopilot`, `openDevContainerFile`, `openAttachDevContainerFile`, `openAttachConfigByNameFile`, `testConnection`, `addExtensionToConfig`, `labelPortAndUpdateConfig` and `checkoutPRInVolume`.
  - It also omits `*FromViewlet` x3, `openRepositoryFrom{Git,RemoteHub}WithEditSession`, `show{ReopenInContainer,RecoveryContainer}NotificationReset`, and all `when:false` view/row ids (`stop/start/removeContainer`, `explorer*Refresh`, `removeVolume`, `inspectInBasicDevContainer` …).
  - The row lists 11 ids that the spec puts in the 13 unconditional ones it does not own: `settings`, `getHelp`, `reportIssue`, `openLogFile`, `openLastLogFile`, `revealLogTerminal`, `installUserCLI`, `installDocker`, `cleanUpDevContainers`, `pruneVolumes`, `inspectVolume`.
- F-0102 (#88), settings:
  - The 14 owned legacy `remote.containers.*` keys appear only as one summary string. They should be listed one by one: `cacheVolume`, `copyGitConfig`, `defaultExtensions`, `dockerComposePath`, `dockerPath`, `dotfiles.{installCommand,repository,targetPath}`, `executeInWSL`, `executeInWSLDistro`, `gitCredentialHelperConfigLocation`, `logLevel`, `repositoryConfigurationPaths`, `workspaceMountConsistency`.
  - The row lists 29 `dev.containers.*` keys as surfaces. The spec marks these as reference data owned by other features.
- F-1004 (#101): the Windows path depends on `dev.containers.forwardWSLServices` (owned by F-0207). The row does not record this setting.

**External dependencies**
- F-0403 (#22): `proposedApi` is empty, but the flow calls `workspace.requestWorkspaceTrust` (`workspaceTrust`) and resolves `dev-container` through `resolvers`. Either list both or note the delegation to F-0106/F-0502.
- F-0207 (#108): `proposedApi` holds free text, not the id `workspaceTrust`.

**Cites**

Ids named in an issue's Depends/Related/Decisions metadata but absent from the row's cites (5 or more; the F-09xx rows are excluded and covered in section 4):

| Row | Missing | Ids |
|---|---|---|
| F-0502 | 16 | F-0104, F-0106, F-0108, F-0303, F-0403, F-0404, F-0405, F-0406, F-0407, F-0414, F-0804, F-0806, F-0807, F-0812, F-1401, F-1406 |
| F-0109 | 16 | F-0201, F-0407, F-0410, F-0419, F-0601, F-0602, F-0605, F-0702, F-0705, F-0707, F-0801, F-0802, F-0808, F-0812, F-0905, F-1202 |
| F-1301 | 14 | F-0107, F-0203, F-0205, F-0410, F-0504, F-0701, F-0702, F-0703, F-0801, F-0807, F-0808, F-0812, F-1401, F-1404 |
| F-0408 | 13 | F-0401, F-0402, F-0403, F-0404, F-0406, F-0407, F-0411, F-0413, F-0414, F-0417, F-0418, F-1401, F-1406 |
| F-0107 | 13 | F-0203, F-0402, F-0410, F-0701, F-0702, F-0703, F-0705, F-0707, F-0903, F-0904, F-0905, F-0906, F-1201 |
| F-0102 | 12 | F-0106, F-0107, F-0108, F-0202, F-0206, F-0411, F-0504, F-0505, F-0605, F-1002, F-1008, F-1401 |
| F-0503 | 11 | F-0105, F-0108, F-0202, F-0303, F-0401, F-0402, F-0403, F-0406, F-0501, F-0504, F-1406 |
| F-1005 | 11 | F-0106, F-0402, F-0504, F-1001, F-1003, F-1004, F-1006, F-1007, F-1008, F-1401, F-1406 |
| F-1001 | 10 | F-0105, F-0108, F-0202, F-0303, F-0403, F-0409, F-0502, F-0504, F-1401, F-1406 |
| F-1002 | 10 | F-0106, F-0402, F-0504, F-0704, F-1003, F-1004, F-1006, F-1007, F-1401, F-1406 |
| F-1003 | 9 | F-0107, F-0402, F-0902, F-1001, F-1002, F-1004, F-1005, F-1006, F-1007 |
| F-0405 | 8 | F-0406, F-0410, F-0411, F-0417, F-0419, F-0504, F-0601, F-1406 |
| F-0410 | 8 | F-0105, F-0303, F-0407, F-0701, F-0906, F-1401, F-1405, F-1406 |
| F-0504 | 8 | F-0402, F-0602, F-0702, F-0801, F-0806, F-0807, F-0812, F-0904 |
| F-0104 | 7 | F-0107, F-0108, F-0401, F-0402, F-0410, F-1401, F-1406 |
| F-0303 | 7 | F-0107, F-0108, F-0410, F-0504, F-0901, F-0903, F-1103 |
| F-0108 | 7 | F-0104, F-0105, F-0201, F-0203, F-0204, F-0605, F-0804 |
| F-0601 | 7 | F-0202, F-0205, F-0415, F-0504, F-0903, F-1302, F-1401 |
| F-0404 | 7 | F-0405, F-0406, F-0407, F-0410, F-0413, F-0501, F-1401 |
| F-0807 | 6 | F-0805, F-0806, F-0808, F-0809, F-0811, F-0812 |
| F-1004 | 5 | F-0402, F-0601, F-1001, F-1007, F-1008 |
| F-0105 | 5 | F-0108, F-0807, F-0808, F-0901, F-0906 |

- Overall, 35 feature rows (excluding F-09xx and F-14xx) leave out F-1401 or F-1406 even though their metadata names them.
- Two cites have no support in the issue body: F-0407 cites F-0505, and F-0808 cites F-0207.

**Counts**
- No row undercounts error paths by more than 2.
- Five rows overcount error paths against their 7.x sections by 3–4: F-0410 (8 vs 5), F-0601 (12 vs 8), F-0801 (16 vs 12), F-0901 (7 vs 4), F-0902 (9 vs 6).
- Decision rows give errorPaths 1–4 but their issues have no error section: F-1401, F-1402, F-1403, F-1404, F-1406.
- acCount is off by 3 for F-0705 (row 37, spec 40).

## 3. Component doubts

1. F-0101 (`activation-and-identity`, lib-product), F-1401 (`identity-and-authority-names`, lib-identifiers) and F-1406 (`identifiers-and-standdown`, lib-standdown) describe one identity decision. F-1406 supersedes F-1401. Fix: fold F-1401 into F-1406's component and give all three rows one library.
2. F-0101's shared proposed-API probe and F-1403 `proposed-api-gate` are the same behaviour under two names. Fix: F-1403's component owns it and F-0101 consumes it. F-1102 (lib-forwarding) is mostly a proposal declaration and should consume it too.
3. F-0701 `clone-volume-flow`, F-0702 `clone-named-volume` and F-0703 `clone-pr-volume` are one clone pipeline with different inputs, and F-0704 is its bootstrap. Fix: one `containers.clone-volume` component with three entry points.
4. Two commands have two owners:
   - `inspectDockerResource` sits in F-0705 and F-0902.
   - `removeRecentFolder` sits in F-0403 and F-0902.

   Fix: F-0902 owns both, and the other rows mark them as referenced.
5. `surfaces.commands` mixes owned and referenced ids. F-1302 lists 10 commands while its own notes say it has none; F-1301, F-0106, F-0301 and F-0302 do the same. Fix: add an owned/referenced split.
6. Docker engine endpoint selection is spread over three libraries: F-0201 and F-0202 (none), F-0205 (lib-forwarding), F-0207 (lib-forwarding), F-1301 (lib-authority). F-0207's notes also claim SSH/GPG/X11 forwarding, which overlaps F-1003, F-1004 and F-1008. Fix: one engine-endpoint component for F-0201, F-0202, F-0205, F-0207 and F-1301. Leave agent forwarding to the F-100x relays.
7. Libraries that look wrong:
   - F-0410 recovery container is on lib-standdown; it is not a coexistence behaviour, so use lib-authority or none.
   - F-1001 is on lib-identifiers; none fits better.
   - F-1202 is on lib-log, but it is a connection probe, so use lib-authority.
   - F-0603 partner menus is on none; use lib-companion, as F-1404 does.
   - F-0108 is undecided.
8. Areas:
   - F-1302 is `undecided`.
   - F-1405 is area C while every other decision row is A.
9. Reuse fields with bad data:
   - F-0811 holds a command id.
   - F-0604 holds "undecided kubectl-delegation".
   - F-0502 holds "openssh-none".

## 4. Dangling citations

- Six rows write cites without the `F-0` prefix, for example `remote-containers#906`, so they point at issue numbers that do not exist:

  | Row | Malformed cites | Notes |
  |---|---|---|
  | F-0901 | 26 | |
  | F-0902 | 22 | |
  | F-0903 | 19 | |
  | F-0904 | 18 | |
  | F-0905 | 11 | |
  | F-0906 | 20 | includes self-cites |

- Five rows cite bare ids with no repo prefix: F-0601 (18), F-0602 (17), F-0603 (16), F-0604 (14), F-0605 (13). They resolve, but only by assumption.
- No row cites an id that is absent from every repo. No issue body cites an id from another repo.

## 5. Shared-behaviour candidates

| Behaviour | containers | other repos |
|---|---|---|
| Proposed-API enablement and probe | F-0101, F-1403, F-1102 | ssh F-3903; wsl F-6001, F-6201; server F-8001, F-8103; explorer F-5101 |
| Identity reuse and stand-down | F-1401, F-1406 | ssh F-3901; wsl F-7901; explorer F-5901; server F-8901; ssh-edit F-4901; pack F-9901 |
| No-telemetry ruling | F-1405 | ssh F-3905; server F-8901; wsl F-6005 |
| Server source and download (`remote.serverDownloadBaseUrl`, `remote.serverDownloadFolder`) | F-1402, F-0503, F-0102 | ssh F-3902; wsl F-6302, F-6303 |
| Companion and marketplace policy | F-1404, F-0603 | ssh F-3904; explorer F-5902 |
| Remote Explorer registration (`contribViewsRemote`) | F-0906 | explorer F-5101, F-5902; ssh F-3906; wsl F-6501 |
| Window title, remote indicator, resource labels | F-0501, F-0504 | ssh F-2502; wsl F-6205; server F-8103 |
| Reopen origin (local/WSL/SSH/tunnel) | F-0406, F-1301, F-1302 | wsl F-6204, F-6701 |
| SSH agent and X11 forwarding | F-1003, F-1008 | ssh F-2311, F-2312 |
| Port forwarding | F-1101, F-1102, F-1103 | ssh F-2507; server F-8202 |
| Log channel and log terminal | F-0104 | wsl F-6002 |
| Localization bundles | F-0103 | ssh F-2002; wsl F-6005; explorer F-5001; server F-8001 |
| Activation and workspace trust | F-0101, F-0106 | ssh F-2001; wsl F-6001; explorer F-5001 |
| Help, feedback, issue reporting | F-0105 | wsl F-6003; server F-8002 |
| Continue working / edit sessions | F-0707 | server F-8301 |
