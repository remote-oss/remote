# Binding constraints from the family's decision issues

Read 2026-10-06 from 22 decision issues (via `gh issue view`) and `docs/architecture/binding-rulings.md`; checked against
ADR-0002 to ADR-0006 in `docs/adr/`. Own words only; identifiers, numbers and ids are quoted, spec prose is not.

Status of the sources: accepted are F-1401 (partly superseded), F-1402, F-1403, F-1404, F-1405, F-1406, F-4901, F-4902,
F-5901, F-8901, F-9901. **Proposed** (not yet binding, listed so the design can anticipate them): F-3901 to F-3908,
F-5902, F-8902. **spec:needs-revision**: F-7901. Constraints resting only on a proposed issue carry "(proposed)".

Package keys: containers, ssh, ssh-edit, explorer, wsl, server (Remote - Tunnels), pack, all.

Entry format: statement. Source. Binds. Kind.

---

## Identity

1. Every member publishes under `remote-oss`, and each extension id is `remote-oss.` plus the reference's own `name`:
   `remote-oss.remote-containers`, `remote-oss.remote-ssh`, `remote-oss.remote-ssh-edit`, `remote-oss.remote-wsl`,
   `remote-oss.remote-explorer`, `remote-oss.remote-server`.
   Source: binding-rulings D-10; remote-containers#107 F-1406 §5 (records D-10/D-14); remote-ssh#78 F-3901 §5
   (proposed); remote-ssh-edit#6 F-4901 §5; remote-wsl#11 F-7901 §5; remote-explorer#7 F-5901 §5; remote-server#7
   F-8901 §5. Binds: containers, ssh, ssh-edit, wsl, explorer, server. Kind: identity.
2. The pack's id is `remote-oss.vscode-remote-extensionpack` (name copied from the reference, not from the repo name).
   Source: remote-extensionpack#10 F-9901 §5 identity card (records D-16, D-10). Binds: pack. Kind: identity.
3. Display names equal the reference's ("Dev Containers", "Remote - SSH", "Remote - SSH: Editing Configuration Files",
   "WSL", "Remote Explorer", "Remote - Tunnels", "Remote Development"); description, icon (one family icon, never the
   reference's or a look-alike), README and listing are the project's. Tests may check displayName; they may only check
   that description and icon differ from the reference's.
   Source: binding-rulings D-41; remote-containers#38 F-1401 §5 (D-41 block); F-5901 §5; F-8901 §5; F-4901 §5; F-7901
   §5; F-3901 §5 (proposed); F-9901 §5. Binds: all. Kind: identity.
4. Display-name localization follows the reference per package: explorer and pack reuse the reference's per-language
   display names; server and ssh keep an untranslated literal. The project's description is localized by the project
   (or falls back to English), never with the reference's sentence.
   Source: F-5901 §5 package properties; F-9901 §5 localized display names; F-8901 §5 localization; F-3901 §5
   (proposed). Binds: explorer, pack, server, ssh. Kind: identity.
5. Every identifier a user, a settings file or another extension binds to is reused verbatim: setting keys, command
   ids, view and view-container ids, context keys and `when` clauses, menu ids and groups, authority names, label
   formatters, language ids, default keybindings, walkthrough ids. Only the identity card is ours.
   Source: binding-rulings D-14; F-1406 §5. Binds: all. Kind: identity.
6. Containers keeps: 71 `remote-containers.*` command ids; `dev.containers.*` (24), `remote.containers.*` (14, including
   3 dotfiles twins) and `dotfiles.*` (3) setting keys, both namespaces declared; the `remote-containers:` prefix on 6
   context keys plus 7 unprefixed keys as-is; views `targetsContainers`, `detailsContainers`, `devVolumes`; authorities
   `dev-container`, `attached-container`, `k8s-container`, `apple-container`, `exec` with their label formatters and the
   `vscode-remote` scheme; server settings `remote.serverDownloadBaseUrl` and `remote.serverDownloadFolder`.
   Source: F-1406 §5, §6 ledger note; F-1401 §5 (authority part, still in force). Binds: containers. Kind: identity.
7. Containers reproduces the reference's legacy-versus-new setting precedence exactly: the new key wins for 9 pairs,
   the legacy key wins for the 3 dotfiles pairs.
   Source: F-1406 §6 (F-0102 bullet; records D-14). Binds: containers. Kind: identity.
8. SSH keeps: 17 `opensshremotes.*` command ids and category "Remote-SSH"; the `remote.SSH.*` keys (35 in F-3901,
   34 if F-3907 is accepted); authority `ssh-remote`, activation `onResolveRemoteAuthority:ssh-remote`, formatter
   `ssh-remote+*`; the five `remote-internal.*` ids; `api` `none` (no exports). URI handler host is the own id.
   Source: F-3901 §5 (proposed); F-3907 §6 (proposed). Binds: ssh. Kind: identity.
9. SSH-edit keeps language id `ssh_config`, its two aliases in the reference order, three file associations, grammar
   scope `source.config.ssh` and every token scope its grammar spec lists.
   Source: F-4901 §5. Binds: ssh-edit. Kind: identity.
10. WSL keeps `remote.WSL.*`, `remote.WSL1.*`, `remote.WSL2.*`; view `targetsWsl` with its item contexts and menu
    groups; context keys `wslFeatureInstalled`, `wsl.openInNewWindow`, `wsl.noWSLPath`, `wsl.noWSLDistrosInstalled`;
    keybinding Shift+Alt+R; walkthrough `wslWalkthrough`; authority `wsl` with its formatter; category "WSL".
    Source: F-7901 §5. Binds: wsl. Kind: identity.
11. Explorer keeps view `remoteTargets` (with name, group `targets@1`, `remoteName` [`tunnel`, `ssh-remote`]), 13
    `remote-explorer.*` commands hidden from the palette, 8 `remote-explorer.*` row context values, settings
    `remote-explorer.foldersSortOrder` and `remote-explorer.collapseRecentFolders` (scope `application`), the
    configuration title as an English literal, and activation event `onCommand:remote-internal.setActiveFolders`.
    Source: F-5901 §5. Binds: explorer. Kind: identity.
12. Server keeps authority `tunnel`; 7 `remote-tunnels.*` commands in category "Remote-Tunnels"; 9 internal ids
    (`remote-tunnels.isConnectedToRemote`, `remote-tunnels.connectNewWindowToTunnel`, 7 `remote-tunnels.internal.*`)
    declared only as activation events; settings `remote.tunnels.defaultExtensions`, `remote.tunnels.alwaysUpdateCLI`,
    `remote.tunnels.tunnelCredentialCommand` with schemas as-is; the explorer `viewsWelcome` entry; the `webOpener`
    scheme with an own module path.
    Source: F-8901 §5. Binds: server. Kind: identity.
13. Command titles, palette categories, setting descriptions and every other localized manifest string are UI strings
    and are reused verbatim; branding lives only in the identity card.
    Source: binding-rulings R-29; F-1406 §5/§6. Binds: all. Kind: identity.
14. Storage and log folders, state keys and URI-handler hosts follow the own id; the inner folder and key patterns keep
    the reference's shape; nothing is migrated from the reference's storage.
    Source: F-1401 §6; F-3901 §5 (proposed); F-5901 §6; F-7901 §5. Binds: all. Kind: identity.
15. An identifier the reference lacks lives in the reference's namespace for its kind, must not match the pinned
    reference manifest (lint), is tagged `[adaptation]` citing F-1406, and is listed in the repo's identity decision;
    there is no `remote-oss.*` namespace for such ids. Current ledgers: containers none; explorer
    `remote-internal.sshHostsChanged` plus an unnamed stand-down key; server `remote-tunnels.entriesEnabled`; ssh
    `remote.SSH.serverDownloadUrlTemplate`, a stand-down key (suggested `opensshremotes.active`) and, after
    conformance, `remote.SSH.experimental.windowsStandardUser`; ssh-edit, wsl, pack none.
    Source: binding-rulings R-27; F-1406 §6; F-5901 §6; F-8901 §6; F-3901 §6 (proposed); F-3908 §5 (proposed);
    F-4901; F-7901; F-9901. Binds: all. Kind: identity.
16. Server's invented ids must also avoid every id core contributes for its host-side tunnel feature (no setting under
    `remote.tunnels.access.`, no `workbench.remoteTunnel.actions.*`, context keys `remoteTunnelConnection`,
    `remoteTunnelHasLink`).
    Source: F-8901 §5 invented identifiers. Binds: server. Kind: identity.
17. `repository`, `bugs`, `contributes.remoteHelp`, README help links and every documentation link point at the
    project; Report Issue files into the project tracker. `bugs` uses the plain GitHub issues URL form of the repo
    (e.g. `https://github.com/remote-oss/remote-explorer/issues`); the spec repo is also the user-facing tracker.
    Source: binding-rulings R-31; F-1401 §5; F-5901 §5 (D-25, orchestrator Q5); F-8901 §5; F-9901 §5; F-3901 §5
    (proposed); F-7901 §5. Binds: all. Kind: identity.
18. External URLs open through the editor API only; core's link-protection dialog is accepted and never bypassed, and
    tests check the URL that finally opens, not the absence of the dialog.
    Source: F-1401 §5 link protection. Binds: containers (rule for all its ACs). Kind: identity.
19. Links into an extension use the running editor's scheme (`vscode.env.uriScheme`), never a hard-coded `vscode://`;
    a redirect wrapper is used only for schemes the redirector forwards; the pack's README contains no editor-scheme
    link.
    Source: binding-rulings R-32; F-1401 §5; F-3901 §5 (proposed); F-8901 §5; F-9901 §5. Binds: containers, ssh,
    wsl, server, pack. Kind: identity.

## Coexistence

20. With the reference installed and enabled, each member detects it by id as the first activation step, registers
    nothing at run time (commands, views' providers, resolvers, internal commands, URI handler, chat), shows one
    warning with one button that opens the Extensions view on the reference, and stays inactive until a later
    activation finds it gone. The warning strings belong to each package's activation spec.
    Source: binding-rulings R-54; F-1406 §5; F-5901 §5; F-8901 §5; F-3901 §5 (proposed). Binds: containers, ssh, wsl,
    explorer, server (R-54 names these; ssh-edit see conflicts). Kind: coexistence.
21. Static menu, `viewsWelcome` and `continueEditSession` entries carry, besides the reference's clause, a positive
    context key that only the running code sets after the check passed and resets to false on stand-down.
    Source: F-1406 §5; F-5901 §5 step 6; F-8901 §5 step 6; F-3901 §5 (proposed). Binds: containers, ssh, explorer,
    server. Kind: coexistence.
22. Duplicate setting, command-metadata, formatter and help registrations rejected by core are accepted as diagnostics;
    the combination is declared unsupported in each README.
    Source: F-1406 §6; F-5901 §5; F-8901 §5; F-3901 §3/§6 (proposed). Binds: containers, ssh, explorer, server. Kind:
    coexistence.
23. Containers' README also explains core's recommendation of the reference and how to decline it.
    Source: F-1406 §6. Binds: containers. Kind: coexistence.
24. The pack has no code and no check; coexistence rests on the members; its README says to install one pack only.
    Source: binding-rulings R-62; F-9901 §5. Binds: pack. Kind: coexistence.
25. Other extensions resolving the same authority (community forks) are neither detected nor tested; the README says
    only one resolver per authority may be enabled.
    Source: binding-rulings R-22; F-3901 §5 (proposed); F-7901 §6. Binds: ssh, wsl. Kind: coexistence.
26. Server declares `onStartupFinished` in addition to the reference's ten activation events, limited to the check, the
    gating key and invisible registrations; explorer declares no startup activation.
    Source: F-8901 §5 step 7 and §6 (orchestrator ledger "F-8901 startup activation"); F-5901 §5 activation. Binds:
    server, explorer. Kind: coexistence.

## Proposed API

27. Family policy: avoid a proposal per feature where a stable route gives a comparable result; for unavoidable ones
    (`resolvers`, `tunnels`) the end-user route is `enable-proposed-api` in `argv.json` or the CLI switch; petition
    derivatives (VSCodium first) in parallel; document a `product.json` patch for packagers; never assume being
    built in.
    Source: remote-containers#39 F-1403 §5, §6; F-3903 §2.3/§5 (proposed); F-5901 §3. Binds: all with proposals.
    Kind: proposed API.
28. Every grant is keyed by the exact extension id; all docs and notifications name the own id, never the id-less
    switch.
    Source: F-1403 §6; F-1406 §6; F-3903 rule 3 (proposed). Binds: all. Kind: proposed API.
29. One shared setup flow per extension, owned by its activation feature: probe at every activation with
    side-effect-free gated members, re-probe after a gated use fails; at most one notification per window; a stored
    dismissal flag (global state, not synced, no expiry) silences activation-time failures only; no success flag is
    cached; restart and failed-attempt follow-ups; the extension never edits `argv.json` itself.
    Source: F-1403 §6 (F-0101 BR-9). Binds: containers, and every member under F-1403. Kind: proposed API.
30. Declared lists: ssh exactly `resolvers`, `tunnels`, `terminalDataWriteEvent`, `contribRemoteHelp`; explorer
    `contribViewsRemote`, `extensionsAny`; server `resolvers` (more only via F-8902); containers per atom-owning spec
    (`resolvers`, `tunnels`, `contribViewsRemote` via Option B; others via substitutes). `telemetry` is never declared.
    Source: F-3903 rule 1 (proposed); F-5901 §5; F-8901 §5; F-1403 §6/§7. Binds: ssh, explorer, server, containers.
    Kind: proposed API.
31. Explorer always requests `extensionsAny` through the Option B route; without the grant it falls back to the
    same-host lookup and silently treats a companion in another host as absent.
    Source: remote-explorer#14 F-5902 §5/§6 (proposed). Binds: explorer. Kind: proposed API.
32. SSH probes three gated members, registers what a partial grant allows, logs the missing ones, repeats the
    notification at every failing activation with no opt-out, and caches success per machine and product.
    Source: F-3903 rule 4 (proposed). Binds: ssh. Kind: proposed API.
33. `engines.vscode` is pinned to the editor versions the declared proposals were checked against.
    Source: F-3903 rule 6 (proposed). Binds: ssh. Kind: proposed API.
34. In hosted web editors no enablement route exists; server claims no support there and never writes product
    configuration or `argv.json`.
    Source: F-8901 §5 (web); F-8902 rules 5, 7, AC-5 (proposed). Binds: server. Kind: proposed API.

## Server distribution

35. Server source order, first match wins: (a) user override setting; (b) the running client's `product.json`
    `serverDownloadUrlTemplate`; (c) built-in table on exact `applicationName` (`codium`, `codium-insiders`); (d) the
    no-default error dialog. Genuine VS Code has no table entry.
    Source: binding-rulings R-47 (amendment 2026-10-02); remote-containers#41 F-1402 §5 rule 4; remote-ssh#79 F-3902
    rule 1 (proposed). Binds: containers, ssh, wsl. Kind: server distribution.
36. Templates use `${name}` placeholders: `${os}`, `${arch}` (target platform), `${version}`, `${commit}`, `${quality}`,
    `${release}` (empty when the product has no release field); containers also keeps the reference's base-URL form
    (no token: reference path appended, combined platform token).
    Source: F-1402 §5 rule 4, §6; F-3902 rules 3-4 (proposed). Binds: containers, ssh, wsl. Kind: server
    distribution.
37. Override settings: containers `remote.serverDownloadBaseUrl` (no declared default, scope `application`, counts as
    set in any layer); ssh `remote.SSH.serverDownloadUrlTemplate` (invented, no default, `application`, read only from
    the default profile's user layer; unusable template gives a dialog naming the setting).
    Source: F-1402 §6; F-3902 rules 1-3, 8 (proposed). Binds: containers, ssh. Kind: server distribution.
38. Launcher, data folder and in-host command come from the client's `serverApplicationName`, `serverDataFolderName`,
    `applicationName`; `~/.vscode-server` is never forced on a derivative; docs say which folder to persist.
    Source: binding-rulings R-47 rule 2; F-1402 §6; F-3902 rule 7 (proposed). Binds: containers, ssh, wsl. Kind:
    server distribution.
39. The server installs extensions from its own product's gallery; the family adds no gallery configuration; missing
    ids fail one by one on the existing path.
    Source: binding-rulings R-47 rule 3; F-1402 §6; F-3902 rule 12 (proposed). Binds: containers, ssh, wsl. Kind:
    server distribution.
40. A server whose commit differs from the client's has its reported commit rewritten to the client's (force), never
    skipped validation.
    Source: F-1402 §6 (orchestrator decision); F-3902 rule 9 (proposed). Binds: containers, ssh. Kind: server
    distribution.
41. Containers downloads on the host and copies into the container; its local cache is keyed by what the resolved
    template uses (commit or version); the temp folder follows the host OS; the platform token is always the
    container's Linux architecture.
    Source: F-1402 §6. Binds: containers. Kind: server distribution.
42. Shared extension cache: VS Code clients keep the reference layout, other products use their own subfolder, and
    entries from another gallery are never reused.
    Source: binding-rulings R-58. Binds: containers. Kind: server distribution.
43. SSH installs templated sources as one server archive per host (no CLI, exec-server setting ignored with one log
    line); host-first download with client fallback per `remote.SSH.localServerDownload`; client copies are temporary
    with no cache; an installed server in either reference layout is reused without download.
    Source: F-3902 rules 5, 6, 10 (proposed). Binds: ssh. Kind: server distribution.
44. Tunnels downloads nothing on the client; the host CLI supplies the server; R-47 binds only what the family
    downloads itself.
    Source: F-8902 rule 4, AC-6 (proposed). Binds: server. Kind: server distribution.
45. Windows hosts: the conformant default keeps the reference's dependence on a remote WMI query; a standard-user
    setting is a post-conformance item, off by default; the extension never changes host security.
    Source: F-3908 §5 (proposed; R-60). Binds: ssh. Kind: server distribution.

## Dependencies

46. Partner integrations keep full parity: no contribution is pruned, no run-time check for a partner's presence,
    `when` clauses are the only gate; specs name the partner ids and cite F-1404 §3 for their Open VSX availability;
    third-party ids are never substituted; no partner is vendored.
    Source: remote-containers#55 F-1404 §5/§6; F-3904 A-2 (proposed); F-8902 §3 (cites F-1404 Option C). Binds:
    containers, ssh, server. Kind: dependencies.
47. Dependents that name Microsoft ids are documented, not emulated; nothing is published under a Microsoft namespace;
    every README says to install ours directly.
    Source: binding-rulings R-21; F-1404 §6; F-5901 §5; F-8901 §5; F-7901 §6; F-9901 §5; F-3904 A-3 (proposed).
    Binds: all. Kind: dependencies.
48. Runtime packages are the project's choice but exclude non-public `@vscode-internal/` packages and any telemetry
    package.
    Source: F-8901 §5 package properties; ADR-0002 decision 8 (D-49). Binds: server, all. Kind: dependencies.
49. Tunnels uses only the public dev tunnels service through an MIT open-source client library, adds no setting for
    another service, takes `github`/`microsoft` sessions only via the editor's authentication API, ships no client
    ids or secrets, and needs no trusted-access entry.
    Source: F-8902 rules 1-2 (proposed). Binds: server. Kind: dependencies.
50. Toolchain and reuse rulings: pnpm workspaces, TypeScript strict, esbuild, vsce, few MIT-compatible deps, no native
    modules without an ADR (D-49); native OpenSSH only, never ssh2 (D-51); `@devcontainers/cli` and the editor CLI as
    allowed dependencies and sources (D-52, R-76); one product profile from `product.json` (D-53).
    Source: binding-rulings D-49, D-51, D-52, D-53, R-76. Binds: all (D-51 ssh, D-52 containers/ssh/wsl/server). Kind:
    dependencies.

## Companions

51. First-class companions are the family's own members; forks are supported by authority only. Containers' WSL/SSH
    companions are `remote-oss.remote-ssh`, `remote-oss.remote-wsl`, `remote-oss.remote-server`.
    Source: binding-rulings R-22; F-1404 §6. Binds: all. Kind: companions.
52. Packs: the family pack lists `remote-oss.remote-wsl`, `remote-oss.remote-containers`, `remote-oss.remote-ssh`,
    `remote-oss.remote-server` in that order; ssh's `extensionPack` is `remote-oss.remote-ssh-edit` then
    `remote-oss.remote-explorer` with no `extensionDependencies`; server's `extensionPack` is
    `remote-oss.remote-explorer`.
    Source: F-9901 §5 member list; F-3904 A-1 (proposed); F-8901 §5; F-5901 §6. Binds: pack, ssh, server. Kind:
    companions.
53. Explorer talks to companions only through `commands.executeCommand` with reference ids (never exports); internal
    ids stay out of `contributes.commands` and menus; arguments and results are plain data carrying a major/minor
    interface version; fields are only added within a major; every call answers within 10 s; no automatic retries;
    unversioned or unknown-major payloads get an empty or no result, never a rejection, and nothing is shown.
    Source: F-5902 §5 (proposed; SSH part confirmed by binding-rulings R-66); F-3906 rules 1-9 (proposed). Binds:
    explorer, ssh, server. Kind: companions.
54. One host-list change signal, `remote-internal.sshHostsChanged`, served by explorer and called by ssh within 1 s on
    exactly two triggers (save of a tab its own open-config flow opened; end of its add-host flow); no side watches
    files; history changes are never signalled.
    Source: binding-rulings R-66; F-5902 §5; F-3906 rule 7 (proposed). Binds: explorer, ssh. Kind: companions.
55. Explorer decides which groups exist by the family companion's id being installed and enabled (across hosts when
    granted); Microsoft ids and forks do not count; an absent or failing companion is silent and explorer never adds
    its own error for a failed hand-over.
    Source: F-5902 §5 (proposed). Binds: explorer. Kind: companions.
56. Tunnel sign-in is run by the server companion on explorer's request so that the consent dialog names the
    companion; explorer listens to session changes itself.
    Source: F-5902 §5 tunnels part (proposed). Binds: explorer, server. Kind: companions.
57. The companion interface is specified once (F-5902 §5) and cited by providers; changes are revisions, never forks;
    the interface document is copied identically into both repos (proposed file `docs/companion-interface.md`,
    explorer's copy authoritative).
    Source: binding-rulings R-66; F-5902 §5 joint decision (proposed); F-3906 rule 12 (proposed). Binds: explorer,
    ssh, server. Kind: companions.

## Telemetry

58. No member sends usage or error telemetry, runs experiments or contacts Microsoft telemetry endpoints: no `aiKey`,
    no (or an empty) `telemetry.json`, no telemetry logger API, no telemetry library; reference `TEL:` atoms stay
    reference data; no acceptance criterion depends on telemetry; each README says none is collected.
    Source: binding-rulings R-28; remote-containers#56 F-1405 §5/§6; F-5901 §5; F-8901 §5; F-9901 §5; F-4901 §3;
    F-7901 §3; remote-ssh#82 F-3905 rules 1-7 (proposed); ADR-0002 decision 8. Binds: all. Kind: telemetry.
59. Reintroducing telemetry needs a new decision citing F-1405 with a backend and a privacy policy first.
    Source: F-1405 §5 (R-28). Binds: all. Kind: telemetry.
60. SSH logs no event-payload lines at any level and starts every server it launches with server telemetry disabled.
    Source: F-3905 rules 4, 8 (proposed). Binds: ssh. Kind: telemetry.

## Licensing

61. MIT for all seven implementation repos and the monorepo, copyright "remote-oss contributors"; manifest
    `license` is `MIT`; a `LICENSE` file ships; Microsoft's terms and notices files are never shipped.
    Source: binding-rulings D-41; F-1401 §5; F-5901 §5; F-8901 §5; F-9901 §5; F-4901 §5; F-7901 §5; F-3901 §5
    (proposed). Binds: all. Kind: licensing.
62. No third-party server licence is accepted for the user: before installing or starting a Microsoft-licensed server
    the extension shows R-68's modal once per profile with a link to the terms; cancel leaves nothing installed or
    started; MIT/VSCodium servers need no dialog. Containers detects "Microsoft-licensed" by a non-empty
    `serverLicense` on the client; ssh by download host plus `serverLicense` and keys acceptance by licence URL.
    Source: binding-rulings R-68 (amended 2026-10-04); F-1402 §5 rule 5, AC-1..AC-5; F-3902 rule 11 (proposed).
    Binds: containers, ssh, wsl, server. Kind: licensing.
63. Use of the dev tunnels service by a non-Microsoft client is unresolved; the recommendation is to ask Microsoft and
    hold tunnel connections until answered.
    Source: F-8902 Q1 (proposed). Binds: server. Kind: licensing.
64. Derived editor material keeps its MIT notice (containers' attach-config schema from VS Code OSS).
    Source: F-1401 §5 schema bullet. Binds: containers. Kind: licensing.

## Data lists

65. Reference data lists are reproduced as observed (items, order, kinds); documentation text comes from public
    upstream manuals with own short texts where upstream has none; upstream supersets are later `[adaptation]` items
    behind a setting. ssh_config completion: 95 items; 7 keywords get own texts.
    Source: binding-rulings R-53; remote-ssh-edit#7 F-4902 §5. Binds: ssh-edit; by R-53 also ssh, wsl. Kind: data
    lists.
66. Containers' default "install if present locally" list is the reference's three GitHub ids; the Copilot instruction
    setting is written into machine settings on every editor without probing.
    Source: F-1404 §6. Binds: containers. Kind: data lists.
67. Localization covers the reference's 14 bundles; kept strings reuse each language's reference value verbatim.
    Source: F-5901 §5; F-8901 §5; F-9901 §5. Binds: explorer, server, pack. Kind: data lists.

## Other

68. No features beyond the reference in the conformant build; improvements are recorded as post-conformance
    candidates behind an off-by-default setting (e.g. `terminalRemoteResolver`, a neutral chat participant, the
    Windows standard-user setting, the ssh_config superset).
    Source: binding-rulings R-60; F-3903 rule 7, F-3907 Q1, F-3908 (proposed); F-4902 §5. Binds: all. Kind: other.
69. SSH ships no chat participant, does not declare `remote.SSH.experimental.chat`, shows no AI entry points, sends no
    logs to any model, and contributes `opensshremotes.clearAllSessionHints` without `enablement`.
    Source: remote-ssh#84 F-3907 rules 1-7 (proposed). Binds: ssh. Kind: other.
70. Publication is on Open VSX only under the verified `remote-oss` namespace (ssh also attaches each VSIX to its
    release page); no release lists a member or companion not yet on Open VSX with a compatible engine; a withdrawn
    member is dropped at the same time.
    Source: F-9901 §5 publishing rule (ledger "F-9901 Q1"); F-3904 B-1..B-4 (proposed). Binds: pack, ssh; members
    listed by them (containers, wsl, server, explorer, ssh-edit) by consequence. Kind: other.
71. SSH pre-releases share the id, use plain `major.minor.patch` with odd minors, ship a fresh pre-release with every
    release, need `engines.vscode` at least `^1.63.0`, and never gate behaviour on the channel.
    Source: F-3904 C-1..C-6 (proposed). Binds: ssh. Kind: other.
72. Manifest properties kept: `extensionKind` `["ui"]` (ssh, explorer, server, pack), untrusted workspaces supported
    (ssh, explorer, server), desktop and web entry points (explorer, server); `engines.vscode` is a build floor, not
    the reference's value; the reimplementation's version numbers are its own.
    Source: F-3901 §5 (proposed); F-5901 §5; F-8901 §5; F-9901 §5. Binds: ssh, explorer, server, pack. Kind: other.
73. Conformance cases cross the wall into `tests/conformance/`; reference-only cases stay dirty; the runner is synced
    from the kit until the rooms close; "done" means the runner passes.
    Source: binding-rulings D-27, R-73; ADR-0002 decision 7. Binds: all. Kind: other.
74. Coding standards per ADR-0003 with R-74's enforcement numbers (id length min 4, clone gate 5 lines and 50 tokens,
    coverage 90/85/90).
    Source: binding-rulings D-50, R-74. Binds: all. Kind: other.

---

## Conflicts and gaps

### Constraints that contradict each other

- **K1 Mid-session arrival of the reference.** F-1406 §6 requires containers to notice the reference being installed
  or enabled while it is active (timing (b)); F-5901 §5 step 5 and F-8901 §5 explicitly reject timing (b), and F-3901
  recommends no re-check (its Q3 open). One family rule is needed for a shared stand-down library.
- **K2 R-54 for wsl and ssh-edit.** F-7901 §6 and F-4901 §6 call side-loading both "unsupported, no handling"; R-54
  names Remote-WSL, and F-9901 §5 coexistence step 3 counts ssh-edit among the six members that stand down. R-54 does
  not name ssh-edit.
- **K3 Setup-flow caching.** F-1403 §6 forbids caching success and uses a dismissal flag; F-3903 rule 4 caches success
  per machine and product, never caches failure and offers no opt-out (it quotes an older F-1403 revision).
- **K4 Override setting.** Containers uses `remote.serverDownloadBaseUrl` (any layer, base URL or template), ssh an
  invented `remote.SSH.serverDownloadUrlTemplate` (user layer only, template only, F-3902 Q2 open); R-47 rule 4(a)
  names only the first. ADR-0006 decision 5 assumes one override table in lib-product.
- **K5 R-68 detection.** F-1402 decides "Microsoft-licensed" from the client's `serverLicense` and remembers per
  profile; F-3902 rule 11 decides from download host plus `serverLicense` and keys acceptance by licence URL. A shared
  server library needs one rule.
- **K6 SSH pruning versus parity.** F-3907 removes `remote.SSH.experimental.chat`, the chat participant and an
  `enablement`, against D-14 verbatim reuse and the F-1404 Option C no-pruning principle; F-3901 still lists 35 keys
  and the participant verbatim.
- **K7 Stale F-1401 text.** F-1401's note keeps "no courtesy import / one namespace" for settings; F-1406 replaced it
  with both reference namespaces and exact precedence. F-1406 governs.
- **K8 Pack id.** F-1404 §6 names a future family pack `remote-oss.remote-development`; F-9901 fixed
  `remote-oss.vscode-remote-extensionpack` (D-16), which also departs from D-10's repo-name pattern.
- **K9 Startup activation.** Server adds `onStartupFinished`, explorer forbids it; accepted as a recorded deviation,
  but a shared activation component must allow both.
- **K10 Server telemetry flag.** Only ssh (F-3905 rule 8) starts servers with telemetry off; containers, wsl and the
  tunnels host path say nothing.
- **K11 F-4902 wording.** Its §5 says "these two items" after listing seven keywords; its §6 uses seven.

### Constraints that contradict ADR-0002..0006

- **A1 ADR-0006 decision 2 placeholders.** Its list (`os`, `arch`, `commit`, `quality`, `version`, `applicationName`)
  lacks `${release}` (F-1402, F-3902 built-in VSCodium entry) and the containers base-URL/`platform` form, while
  making unknown placeholders an error; the built-in VSCodium entry would fail. Conversely F-3902 rule 3 errors on
  `${applicationName}`, which ADR-0006 allows.
- **A2 ADR-0006 decision 2(c).** It puts VS Code and VS Code Insiders in the built-in table; F-1402 rule 4 and F-3902
  rule 1/AC-8 say genuine VS Code has no entry and ends in the no-default dialog unless the user sets a URL (F-3902 Q5:
  a default needs a family ruling).
- **A3 ADR-0006 decision 3(c) / D-53.** A built-in CLI URL derived from `updateUrl` for genuine VS Code is the unruled
  F-3902 Option C and runs against F-1402's principle that only an explicit user URL reaches Microsoft's artefacts.
- **A4 ADR-0005 decision 2 / D-52 (editor CLI as launcher and tunnel connector).** F-3902 rule 5 never uses the CLI for
  templated sources (every derivative case: no VSCodium CLI for Alpine/armhf, CLI ignores templates); F-8902 rule 1
  connects tunnels through the dev tunnels client library and rule 4/AC-6 forbids client downloads, so the client-side
  CLI download of ADR-0006 decision 3 has no consumer in tunnels. ADR-0005 says "where specs allow"; for these paths
  they do not.
- **A5 Dev tunnels client library.** F-8902 rule 1 needs it; no ADR or R-76 admits it as a dependency or source.
- **A6 Web bundles.** ADR-0002 decisions 3 and 10 target Node only; explorer and server must ship browser (web worker)
  entry points (F-5901, F-8901), and server's `webOpener` module needs a browser build.
- **A7 Product names in code.** ADR-0006's lint confines `codium`, `vscode-server`, `update.code.visualstudio.com`
  etc. to lib-product; F-3902 rule 11 (licence hosts, VSCodium release prefixes), F-1402's table and F-8902's service
  domain must therefore live in lib-product's table, which ADR-0006 does not yet list.
- **A8 Monorepo versus per-repo documents.** F-5902/F-3906 copy the companion interface document into two repos and
  reject a shared library as the contract; ADR-0002's single monorepo makes the copy rule and the authoritative copy
  need restating.
- **A9 Publication.** ADR-0002 decision 5 defers the publishing location to a later ADR; F-9901 (accepted) and F-3904
  already fix Open VSX only plus VSIX, and F-3904 fixes a pre-release scheme. The ADR is missing, not contradicted.

### Decisions a repo lacks that another repo has

| Topic | Has a decision | Lacks one |
|---|---|---|
| Identity | all seven (ssh proposed; wsl needs revision) | none |
| Server distribution | containers F-1402, ssh F-3902 (proposed), server F-8902 (proposed) | wsl (R-47 says it applies; no override setting named) |
| Proposed API | containers F-1403, ssh F-3903 (proposed), explorer and server inside identity | wsl; ssh-edit (presumably none needed, unstated) |
| Dependencies / companions | containers F-1404, ssh F-3904, explorer F-5902, pack F-9901, server partly | wsl (one line), ssh-edit |
| Telemetry | containers F-1405, ssh F-3905, others inside identity | none (wsl, ssh-edit only constraint lines) |
| Coexistence (R-54) | containers, explorer, server, ssh (proposed) | wsl, ssh-edit (contrary text, K2) |
| Publication | pack, ssh (proposed) | containers, wsl, explorer, ssh-edit, server |
| Pre-release channel | ssh (proposed) | all others |
| Companion interface, WSL part | none | R-66 names WSL as a provider; F-5902 has no WSL rows |
| Data lists under R-53 | ssh-edit F-4902 | ssh (option knowledge), wsl (distro lists) |
| Chat / AI surface | ssh F-3907 (proposed) | containers (F-0811 Copilot partner under F-1404 only) |
| Licence of a remote service | server F-8902 Q1 (open) | none applicable |

### Rulings cited by the issues but absent from binding-rulings.md

D-16, D-25, D-40, D-44, D-45; R-02, R-03, R-04, R-26, R-40, R-46, R-48, R-52, R-56; room ledger entries ("F-9901 Q1",
"F-8901 startup activation", "F-8901 Q1", "F-1402 Windows question"). Ask remote-development for clean-side extracts.

### Questions

- Spec cites material not for the clean side: F-1401, F-1402, F-1403, F-1406, F-3901, F-3902, F-3905, F-5901, F-5902,
  F-8901, F-8902, F-9901 cite lab observations and sessions, lab tool commands, observation folders, the room's
  decision ledger file, and paths inside the reference package (manifest, licence file). Not opened; constraints above
  use only the issues' decided rules.
- F-8902 Q3 asks for the `cli/` sources as a new allowed source; R-76 already admits them, so Q3 can be answered from
  the clean side.
