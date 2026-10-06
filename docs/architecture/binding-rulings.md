# Binding rulings for the implementation (extract from the family register)

Extracted by remote-development on 2026-10-05 (23:40) from decisions.md (remote-oss/remote-development, private). Each entry is
the register row: the decision or ruling text, then its trailing cells (who asked, options, recommendation or source) after
an em dash. The full register carries the lab process, which the clean side never needs. Cite these ids; ask
remote-development for anything not here.

## D-10

**DECIDED 2026-09-27 15:20: Ids mirror the reference names: `remote-oss.remote-containers`, `remote-oss.remote-ssh`, `remote-oss.remote-ssh-edit`, `remote-oss.remote-wsl`, `remote-oss.remote-explorer` (the repo names). Dev Containers renames `remote-oss.containers` in its decision pass, folded into F-1406.** Original question: **Identity prefixes for the four extensions**: an F-1401 Option C instance per repo (own extension id and command/setting/context prefixes, remote-authority names kept), names chosen together to fit `containers.` / `containers:`, collision-checked on Open VSX, recorded as one decision issue per repo citing F-1401. Note: `explorer.` collides with VS Code core's own `explorer.*` settings, so the explorer needs another word. **Answered 2026-09-27 (the user): the Open VSX namespace `remote-oss` is ours.** Joint proposal ready in `family-conventions.md` §5.1: ids `remote-oss.<x>` for repo `remote-oss/remote-<x>`; prefixes containers `containers.`/`containers:` (F-1401), ssh `ssh.`/`ssh:`, ssh-edit `sshConfig.`/`sshConfig:`, wsl `wsl.`/`wsl:`, explorer `remotes.`/`remotes:` (id fallback `remote-oss.remotes`). All ids free on Open VSX; no prefix collisions in 953 domain-related Open VSX manifests, VS Code core or its built-ins; one near miss accepted (core agent-host ids look like `ssh:<alias>`). Keeping the `ssh-remote` authority means the reimplementation and open-remote-ssh cannot be active together. **Your pick:** the table as proposed, or name rows for their fallback.

— remote-ssh 8, remote-wsl U10

— approve the approach now; names later as one pick

— Approve the approach. `remote-development` collects one joint proposal from the four sessions and brings the names as a single pick.

## D-14

**DECIDED 2026-09-27 15:00 (the user): reuse the reference identifiers.** Every reimplementation uses its reference extension's identifiers verbatim wherever they appear in the manifest or in users' files: setting keys (`dev.containers.*`, `remote.containers.*`, `dotfiles.*`, `remote.SSH.*`, `remote.WSL.*`, `remote-explorer.*`), command ids, view and view-container ids, context keys and `when` clauses, menu ids, authority names, language ids, default keybindings. **Identity stays ours:** publisher and extension id (`remote-oss.<x>`), display name, description, icon, repository links, marketplace listing. Rationale (the user): the reference extensions' license keeps them out of every non-VS Code build, so they can never coexist with ours; identical identifiers let users bring their settings and keybindings over. Consequences: F-1401 is reopened by a decision issue in remote-containers that cites F-1401 and this ruling (Option C's own prefixes replaced by the reference identifiers), applied in the decision pass; D-12 closed; D-10 reduced to the extension ids; each sibling's identity decision issue at its go cites F-1401 and D-14, and the `[inferred]` placement of untriggered strings is unaffected. Decision issue **F-1406** (E14, P0) records D-14: remote-oss/remote-containers#107, `spec:reviewed` 2026-09-27 16:10; siblings cite it. It fixes the id `remote-oss.remote-containers`, all 71 `remote-containers.*` command ids, the setting keys verbatim in both namespaces (`dev.containers.*` 24, `remote.containers.*` 14 incl. the 3 dotfiles twins, `dotfiles.*` 3), `remote-containers:` context keys, authorities, views and menus; identity stays ours. In-room consequences: F-0102 reproduces the reference's legacy-vs-new setting precedence exactly (new key wins, except the 3 dotfiles pairs where legacy wins); F-0101 gets a README note plus an activation-time warning when the reference is also installed. Consequences recorded (remote-explorer): our VSIX can be side-loaded into Microsoft's VS Code next to the reference, where the identical ids would clash, so F-1406 states 'unsupported alongside the reference' (README, or an activation check); product.json's proposed-API grants are keyed by extension id, so F-1403's enablement route still applies. Follow-up for F-1404: other extensions' `extensionDependencies` and extension packs that name `ms-vscode-remote.*` ids will not resolve to ours.

— the user

## D-27

**DECIDED 2026-10-01 20:49 (the user): where the conformance tests go.** Cases cross the wall like specs: case files, fixture scripts and the catalogue are published from the dirty room into the implementation repo (`remote-oss/remote-<x>`, `tests/conformance/`) through the same gate as specs (lint, review, R-34 audit, secret gate) by a `publish-tests` step next to `publish-spec`; each case cites its feature and acceptance criterion by issue number. Recordings, transcripts and raw observations stay in the `-dirty` repo; the dirty room keeps the suite green against the reference. The runner (lab driver, fixture plugins, environment profiles) is a standalone package the implementers install without guard or pipeline parts (a sub-package of `cleanroom-kit` or `remote-oss/conformance-kit`), so their CI runs the same profiles against their builds. Cases that depend on reference-only artefacts (state the reference wrote in its own format, anything touching the identity card) carry a `reference-only` flag, stay in the dirty repo, and the crossing suite uses fixtures built from public inputs only; the coverage lint reports cases recorded and cases that cross, per feature.

— remote-development

## D-41

**DECIDED 2026-10-03 (the user, picker): family identity: display names mirror the reference verbatim ("Dev Containers", "Remote - SSH", "Remote - SSH: Editing Configuration Files", "Remote Explorer", "WSL", "Remote - Tunnels", "Remote Development"); description, icon (a family icon, never the reference's), README and marketplace listing are ours; licence MIT for all seven implementation repos and the monorepo (LICENSE files added, copyright "remote-oss contributors").**

— the user, 2026-10-03

## D-49

**DECIDED 2026-10-05 16:15 (the user, picker): ADR-0002 (toolchain) approved with one change: pnpm workspaces instead of npm workspaces; the rest as proposed (TypeScript strict, esbuild bundling with tsc type checks, vsce packaging with the publishing location a later ADR, ESLint enforcing the layout's import rules and Prettier, tests on three levels with the conformance runner as the only definition of done, few MIT-compatible dependencies, no telemetry, no native modules without an ADR, manual CI).**

— the user, 2026-10-05

## D-50

**DECIDED 2026-10-05 (the user, directly to remote-architect): strict coding standards during development. The user's dislikes, in substance: (1) verbose, apologetic AI comments ("comments are not going to be read by the user, so your conversations should not live in the code; the only defensible comments are those required by the Google style guide", https://google.github.io/styleguide/tsguide.html); (2) variable names of 3 letters or fewer; (3) duplicated code, or dead code nothing reaches; (4) no tests, or tests that do not cover all scenarios; (5) low coverage ("we must strive for the highest"). Recorded as ADR-0003 (docs/adr/0003-coding-standards.md, accepted) and in the monorepo's AGENTS.**

— the user, 2026-10-05

## D-51

**DECIDED 2026-10-05 (the user, directly to remote-architect): the SSH transport is the native OpenSSH client, never the node ssh2 library (ADR-0004, accepted). The shared SSH library is a process manager around `ssh`, so the user's own config, agents, keys and jump hosts work because ssh handles them.**

— the user, 2026-10-05

## D-52

**DECIDED 2026-10-05 (the user's wish to remote-architect, ruled by remote-development as R-76): the reimplementation reuses @devcontainers/cli (MIT, the open reference implementation of containers.dev) for configuration parsing, features, image build, container create/start and lifecycle hooks, and the editor's CLI binaries (the VS Code OSS cli/ crate, MIT, as built by VSCodium) to download and start the server and to connect to tunnels (ADR-0005).**

— the user, 2026-10-05

## D-53

**DECIDED 2026-10-05 (the user, directly to remote-architect): "VSCodium won't be our only editor, so we have to expect that the editor configures the URL patterns for the REH and CLI binaries" (ADR-0006, accepted). One product profile read from the running editor's product.json (lib-product, the only place a product name may appear in code) supplies names, data folders, templates, gallery and URI scheme to every resolver and to Tunnels; nothing is hard-coded per product. Server URL order stays R-47 rule 4; for the CLI a product field `cliDownloadUrlTemplate` with the same order (override setting, product field, built-in table with the OSS shape `{updateUrl}/commit:{commit}/cli-{os}-{arch}/{quality}` for VS Code behind the R-68 gate and VSCodium's release assets, dialog); conformance profiles carry a synthetic product.json so a build that hard-codes a product fails a case. R-47 amended accordingly (its CLI extension takes ADR-0006 decision 3 as its rule 4). Deferred public action: proposing to VSCodium a patch declaring `cliDownloadUrlTemplate` next to `serverDownloadUrlTemplate`, the user's call when the design is stable (D-15 forbids nothing here: that was about another project).**

— the user, 2026-10-05

## R-21

**Dependents naming the Microsoft ids are documented, not emulated.** Each family README states that extensions and packs whose `extensionDependencies` name `ms-vscode-remote.*` / `ms-vscode.remote-*` ids will not resolve to ours and that users install ours directly; the specs (containers F-1404 at its decision pass, the siblings' equivalents) say the same and point here. Nothing is published under a Microsoft namespace. A family pack is D-16.

— Follows D-14; nothing outward-facing.

## R-22

**First-class companions are the family's own reimplementations.** For each member the first-class partners are the other `remote-oss.remote-*` extensions, which share the authority names per D-14; community forks (`jeanp413.open-remote-ssh`, `open-remote-wsl`) are "supported by authority, not specifically tested". remote-ssh and remote-wsl take the mirror image (remote-containers is their first-class partner). From remote-containers' ledger entry "F-1404 forks + family".

— Convention; follows D-14.

## R-27

**Naming invented identifiers (no reference counterpart).** A new setting, command, view or context key that the reimplementation needs and the reference lacks lives in the reference's own namespace for its kind (`dev.containers.*`, `remote.SSH.*`, `remote.WSL.*`, `remote-explorer.*`; commands `remote-containers.*` and so on), so users search one prefix, in the spirit of D-14. Rules: the name must not match any identifier in the pinned reference manifest (a lint check against the manifest); the spec tags it `[adaptation]` citing F-1406; each repo's identity decision issue keeps the list of invented identifiers, so a later Microsoft release that reuses a name is detectable and re-decided then. No separate `remote-oss` namespace.

— Follows D-14; remote-containers' recommendation, 2026-09-29.

## R-28

**No telemetry in the reimplementations (family), F-1405 Option A.** No extension sends usage or error telemetry, runs an experiments backend, or contacts Microsoft's telemetry endpoints; settings such as `isTelemetryEnabled` / `telemetryLevel` are respected trivially by sending nothing; the reference's telemetry events stay documented as out of scope. Dev Containers' eight affected specs drop their event rows (edit-only pass). Adding telemetry later (Option B: own backend, own instrumentation key, `remote-oss.remote-<x>/<event>` keys) is a new decision issue citing F-1405 and needs a backend and a privacy policy first. **Ruled under the user's delegation; the user may veto.**

— remote-containers' recommendation, 2026-09-29; conservative and reversible.

## R-29

**Command titles and the palette category are UI strings, reused verbatim (family).** "Dev Containers:", "Remote-SSH:", "WSL:" and every command title, like setting descriptions and other localized strings, come from the reference's declarative files and are kept, so users' muscle memory, docs and tutorials keep working (D-14's rationale); "Dev Containers" is also the name of the open specification at containers.dev. Branding stays with the identity card only: publisher, extension id, displayName, description, icon, README and marketplace listing. Specs keep quoting palette entries as "<Category>: <title>"; F-1406 and F-1401 gain the sentence. **Ruled under the user's delegation; the user may veto.**

— remote-containers' option (a), 2026-09-29; extends D-14.

## R-31

**Help and issue URLs are ours (family).** Every Microsoft-owned URL baked into a manifest or its strings is replaced by the reimplementation's own: `contributes.remoteHelp` (getStarted, documentation, issues, the aka.ms/vscode-remote links), the resolve-failed "Open Documentation" link, `bugs` and `repository`. Issues go to the project's tracker, documentation and getting-started to its docs; a Report Issue never files into Microsoft's tracker. Titles stay verbatim (R-29).

— Promoted from remote-containers' F-1401 "help and issue URLs", 2026-09-29.

## R-32

**URI scheme per editor (family).** OS links reach an extension's URI handler only through the running editor's own scheme (`product.json` `urlProtocol`: `vscode` for VS Code, `vscodium` for VSCodium; `vscode.env.uriScheme` at run time), so a `vscode://` badge or link never reaches VSCodium. Badges, docs and generated links use the target editor's scheme, and specs describe the handler in terms of `vscode.env.uriScheme`. Applies to Dev Containers, Remote-SSH, WSL and Tunnels handlers alike.

— Promoted from remote-containers' F-1401 "URI scheme per editor", 2026-09-29.

## R-47

**Server distribution for Code-OSS derivatives (family; containers F-1402).** Facts corrected by round 9: VSCodium's product.json `applicationName` is `codium` (the built-in mapping matches on it); its server archive is not a drop-in for the VS Code Server layout (launcher `bin/codium-server`, data folder `~/.vscodium-server`); F-1404 §3 expects F-1402 to decide the derivative's server and gallery configuration. Rulings: (1) a second built-in mapping entry for VSCodium Insiders (`codium-insiders`, archives from VSCodium/vscodium-insiders, same URL shape, all seven Linux architectures), so a whole published channel does not fall into the no-default dialog; (2) the server's launcher, data folder and in-container command follow the running client's product.json, as containers F-0503 already does for VS Code Insiders (`codium-server`, `~/.vscodium-server`, `codium`); documentation tells VSCodium users to mount `~/.vscodium-server`; never force `~/.vscode-server`, which would mix two products' state; (3) no gallery configuration of our own: the server installs from the gallery its own product.json names (Open VSX for VSCodium), and ids missing there take the per-id "not found" path (containers F-0505), consistent with the Marketplace terms recorded in F-1404 §3. Remote-SSH and Remote-WSL apply the same three rules to their server download and install. **Amendment 2026-10-02 15:53 (F-1402 rule 4, from gap hunt E14):** the server download source is resolved in this order, first match wins: (a) a user-set `remote.serverDownloadBaseUrl`; (b) the running client's own product.json `serverDownloadUrlTemplate`, whatever its applicationName (VSCodium and VSCodium Insiders declare it; VS Code and VS Code Insiders do not; core never reads it; for both VSCodium builds the table and the product template give identical URLs); (c) the built-in table (codium, codium-insiders); (d) the no-default error. `${name}` is the single placeholder syntax for every template. Stays correct when VSCodium renumbers or a rebuild changes applicationName.

— remote-containers' recommendations, 2026-10-02 11:28.

## R-53

**Reference data lists are reproduced as observed; upstream supersets are adaptations (family; remote-ssh-edit F-4902).** The reference's ssh_config completion offers 95 items (an older OpenSSH list plus Apple-only keywords: 16 not in 10.2p1 such as Cipher, Protocol, RSAAuthentication, KeychainIntegration, AskPassGUI; 25 of 10.2p1's keywords missing, such as Include, SetEnv, IdentityAgent, CertificateFile). Ruling: option (A): the specified behaviour reproduces the reference's list, order and item kinds, so recorded conformance cases pass; the items' documentation text is written from OpenSSH's `ssh_config(5)` under R-48 (the version whose wording the reference shows where identifiable, else 10.2p1), and cases compare documentation by presence and first sentence, not full text; option (C), the superset with 10.2p1's 25 missing keywords, is recorded as an `[adaptation]` behind a setting in the reference namespace (R-27) for the implementers to offer later. The same pattern applies to any reference data list in the family (Remote-SSH's own ssh option knowledge, WSL distro lists). Ruled under the user's delegation; the user may veto.

— remote-ssh-edit's recommendation, 2026-10-02 15:31.

## R-54

**Coexistence with the reference in one window (family).** Facts: genuine VS Code 1.139.1 and Insiders 1.140.0 recommend the reference by id in four product.json entry types and core shows both install prompts (VSCodium has none); core matches "already installed" by id, so the reimplementation's presence does not stop those prompts; because D-14 reuses command ids, setting keys and resolver authorities, both enabled in one window conflict by construction (the second to activate loses its duplicate command registrations and activation; duplicate settings and views are rejected with core's messages; remote-authority resolvers silently replace each other; from the OSS source). Ruling, options (b) plus (c): at activation the reimplementation detects the reference by its id; if the reference is enabled, it registers nothing and shows one warning notification with a button that opens the Extensions view on the reference, and stays inactive until a later activation finds the reference disabled; neither extension half-works and the user has one clear action. Applies to Dev Containers (F-0101 BR-10, F-1406), Remote-SSH, Remote-WSL, Remote Explorer and the pack.

— remote-containers' recommendation, 2026-10-02 15:56.

## R-58

**Shared extension cache per product (Dev Containers F-0419 Q-1).** The reference's cache on the shared `vscode` volume is keyed by id, version and platform only [observed]. Ruling: VS Code clients keep the reference layout so existing caches keep working; any other product (codium, codium-insiders, …) uses its own cache subfolder keyed by the client's product (applicationName / serverDataFolderName); a cache entry downloaded from another gallery is never reused. Follows R-47 rule 3 (the server installs from its own product.json gallery) and the Marketplace terms (F-1404 §3).

— remote-containers' recommendation, 2026-10-02 19:30.

## R-60

**No features beyond the reference in the specs (family).** The reimplementation mirrors the reference's feature set; authoring aids or other enhancements the reference lacks (remote-ssh-edit F-4204 Q1: hovers, diagnostics, outline symbols, value completion) are not specified and have no ACs; they are recorded in the spec's "later adaptations" note as candidates behind a setting off by default, for the phase after conformance. Follows R-53.

— remote-ssh-edit's recommendation (A), 2026-10-03 03:20.

## R-62

**The extension pack stays code-less (remote-extensionpack F-9901 Q3).** The reimplemented pack has no code and cannot run an R-54 check; coexistence with the reference pack is carried by each member extension's own R-54 stand-down; the pack's readme tells the user to install one of the two packs, not both. Follows R-54 and R-21/R-22 (members listed by our ids in the reference's order).

— remote-extensionpack's recommendation, 2026-10-03.

## R-66

**Companion interfaces are specified once (family).** The interface through which a provider (Remote-SSH, Tunnels, WSL) feeds the reimplemented Remote Explorer is specified in the explorer's F-5902 §5 and cited by each provider's decision feature (remote-ssh F-3906, server, wsl); payload fields stay provisional until the provider observes them; changes are §5 revisions, never forks. Invented internal identifiers follow R-27 and are listed in the explorer's identity decision. For SSH hosts: one internal change signal served by the explorer, called by the companion after its own editor save or after "Add New SSH Host..." writes a host; no file watching.

— remote-ssh's answer to F-5902 Q1/Q2, 2026-10-03.

## R-68

**No licence acceptance on the user's behalf (family).** The reference starts the VS Code Server with its licence terms pre-accepted and never asks. The reimplementation never accepts third-party server terms for the user: before a Microsoft-licensed server is installed (only on genuine VS Code through the explicit server URL, F-1402 / R-47), a modal once per profile names the terms with a link and offers "Accept and Continue" | "Cancel"; acceptance is remembered per profile; MIT/VSCodium servers need nothing. Applies to every room that installs a server (Dev Containers, Remote-SSH, WSL, Tunnels).

— remote-containers' recommendation (a), round-16 gap hunt, 2026-10-03; user may veto.

## R-73

**Conformance runner ownership.** The kit (remote-cleanroom-kit) is the runner's source while the dirty rooms run; the monorepo `remote-oss/remote` holds a synced copy under tests/conformance/runner, synced by the kit owner on each runner change; when the rooms close, the monorepo becomes the source and the kit copy is retired. Follows D-27.

— remote-architect's question 4, 2026-10-05.

## R-74

**Enforcement of D-50 (the architect's choice; the user may change the numbers).** Google TS style enforced by an explicit typescript-eslint rule table with gts's Prettier settings copied (gts itself not installed: it pins ESLint 9 and enforces a thin set); JSDoc on exports and no other comment classes (jsdoc rules plus three local rules no-commented-out-code, no-conversation and todo-issue in the TODO(#123) form, and multiline-comment-style; /* name= */ parameter comments allowed per the guide); ADR-0003 on main is the authoritative text; `_` is not an allowed identifier (the guide forbids it; unused trailing parameters are removed); id-length min 4 with a tiny fixed exception list plus an id-denylist of abbreviations (cfg, ctx, res, req, err, evt, fn, cb, tmp, val); jscpd failing on any clone of 5 lines AND 50 tokens in one run (revised 2026-10-05 from "10 lines / 75 tokens", not expressible in one run); knip plus noUnusedLocals/Parameters for dead code; c8 gates 90 % lines, 85 % branches, 90 % functions per package with a ratchet failing on a drop of more than 0.5 points; exclusions only by name with a reason, listed in the package README; six review questions R1–R6 answered in every coding PR; applies to tools/ as well as packages/.

— remote-architect, ADR-0003, 2026-10-05.

## R-76

**Open-source components as allowed sources (clean side).** @devcontainers/cli and the VS Code OSS cli/ crate are allowed dependencies and allowed sources on the clean side, cited [devcontainers-cli] and [cli]: the cli/ crate is part of VS Code OSS (already [oss]); @devcontainers/cli follows that precedent as MIT open source distinct from the reference extensions. The wall stays around the ms-vscode-remote and ms-vscode extension packages (VSIX contents) and the dirty rooms. R-47 extended: the editor CLI archive is fetched like the server archive, from the product's own download location per product.json. The user may veto.

— remote-architect's question, ADR-0005, 2026-10-05.
