# remote-ssh-edit: adversarial second read

Rows checked: `remote-ssh-edit-20.json` (9 rows), `remote-ssh-edit-21.json` (2 rows). Issues read: #6 to #16 via `gh issue view`.
This file lists problems only.

## 1. Missing

- No issue is missing a row, and no row is missing an issue. Ids match the issue titles for all 11.
- **F-4002 (#11): the row describes the wrong spec.** The row says "BODY MISMATCH" (Remote-SSH F-2001). That is false: the #11 body is the ssh-edit activation spec (Feature F-4002, epic E40, reference 0.87.0). Every surface, cite, count and question in the row came from remote-ssh F-2001, not from #11. Rebuild the row.
- **F-4003 (#16): the row describes the wrong spec.** Same problem. The row says "BODY MISMATCH" (Remote-SSH F-2006), but the #16 body is the ssh-edit package identity / l10n / README spec (Feature F-4003, E40, owned atoms META:displayName, META:l10n). The row's 17 `opensshremotes.*` commands, its `remote.SSH.*` settings and its context keys are not in #16. Rebuild the row.
- F-4002: the row has epic `E20`, but the issue label is `epic:E40`.
- F-4002: the row has acCount 28, but #11 has AC-1..AC-35 (35).
- F-4003: the row has acCount 26, but #16 has AC-1..AC-19 (19).
- F-4203: the row has acCount 24, but #13 has 25 distinct ACs. Numbering jumps from AC-24 to AC-28 (AC-25..27 are missing). Minor, but say so in the row's questions.

## 2. Wrong or thin rows

### F-4002 (#11): what the rebuilt row needs
- Surfaces: activation event `onLanguage:ssh_config`; atoms META:extensionKind (`ui`) and CAP:untrustedWorkspaces; `engines.vscode`. No virtualWorkspaces declaration. No commands of its own.
- Settings (core inputs, section 10):
  - `remote.extensionKind`
  - `extensions.supportUntrustedWorkspaces`
  - `extensions.supportVirtualWorkspaces`
  - `security.workspace.trust.enabled`
  - `security.workspace.trust.banner`
  - `files.associations`
- External: stable `languages.registerCompletionItemProvider`. **Proposed API: none.** #11 states there is no `enabledApiProposals`, so the row's 6 proposed APIs (resolvers, tunnels, …) are wrong.
- Cites: F-4001, F-4003, F-4101, F-4102, F-4201, F-4202, F-4203, F-4901, remote-containers#F-0109. None of the remote-ssh cites in the row (F-2001, F-2501, F-3903, F-3901, F-2006, F-3906) appear in #11.
- Error paths E1..E5 match the row (5).

### F-4003 (#16): what the rebuilt row needs
- Surfaces:
  - META:displayName (literal, not localized)
  - META:l10n
  - localizable description
  - categories and keywords
  - icon
  - README sections: title, feedback, telemetry, license
- Local files:
  - `package.nls.json` and `package.nls.<locale>.json` (14 locales)
  - `l10n/bundle.l10n.<locale>.json` (14 locales, 2 keys)
  - `README.md`, `LICENSE.txt`, `ThirdPartyNotices.txt`
- Settings and inputs (core): `telemetry.telemetryLevel`, `extensions.autoUpdate`, `locale` in `argv.json`.
- External: stable `vscode.l10n.t`, plus the `@vscode/l10n-dev` tooling.
- Cites: F-4001, F-4002, F-4202, F-4901, remote-containers#F-0109. The issue also names `OTHER:remote-oss/remote-ssh` as the owner of a release-note item. None of the remote-ssh cites in the row (F-2006, F-3901, F-2301, F-2302, F-2204) appear in #16.
- Error paths: E1..E3. The row says 5, so it overcounts by 2.
- Remove the row's question about the palette options a/b/c. It belongs to remote-ssh F-2006.

### Gap that affects every feature row: core configuration inputs are left out
Each spec's section 10 lists core settings, but every row has `settings: []`. Record them, at least as core inputs:
- F-4001 (#8):
  - `files.associations`
  - `workbench.editor.languageDetection`
  - `editor.tabSize`, `editor.insertSpaces`, `editor.detectIndentation`
  - `remote.SSH.configFile` (a remote-ssh setting, see 7.E6)
  - `remote.extensionKind`
- F-4101 (#9):
  - `editor.maxTokenizationLineLength`
  - `editor.unicodeHighlight.*` (5 keys)
  - `editor.minimap.showMarkSectionHeaders`, `editor.minimap.markSectionHeaderRegex`
  - `editor.tokenColorCustomizations`, `workbench.colorTheme`
  - `editor.unusualLineTerminators`
- F-4102 (#14):
  - `editor.autoClosing*` (4 keys)
  - `editor.autoIndent`, `editor.autoIndentOnPaste`, `editor.autoSurround`
  - `editor.comments.*`
  - `editor.foldingStrategy`
  - `editor.bracketPairColorization.enabled`, `editor.language.brackets`, `editor.language.colorizedBracketPairs`
  - core commands `editor.action.commentLine` and 9 more
- F-4201 (#10):
  - `editor.quickSuggestions`, `editor.suggestOnTriggerCharacters`, `editor.wordBasedSuggestions`
  - `editor.snippetSuggestions`, `editor.suggest.showProperties`, `editor.suggest.showSnippets`, `editor.suggest.insertMode`, `editor.suggestSelection`
  - `editor.tabCompletion`, `editor.acceptSuggestionOnEnter`
  - `files.readonlyFromPermissions`
  - context key `EditorContextKeys.writable`
- F-4202 (#12):
  - `editor.snippetSuggestions`, `editor.suggest.snippetsPreventQuickSuggestions`, `editor.tabCompletion`
  - `editor.insertSpaces`, `editor.tabSize`, `editor.detectIndentation`
  - `files.eol`
- F-4203 (#13):
  - `editor.quickSuggestions`, `editor.quickSuggestionsDelay`, `editor.suggestOnTriggerCharacters`
  - `editor.suggest.showWords`, `editor.wordBasedSuggestions`
  - `files.readonlyFromPermissions`
- F-4204 (#15):
  - `editor.hover.enabled`, `editor.formatOnSave`, `editor.formatOnType`, `editor.formatOnPaste`
  - `editor.links`, `editor.stickyScroll.*`, `editor.occurrencesHighlight`, `editor.linkedEditing`
  - `files.readonlyInclude`

### Other per-row gaps
- **F-4001:** local files are missing the Windows paths `%ProgramData%\ssh\ssh_config` and `%USERPROFILE%\.ssh\config` (platform section). Atoms LANG / ALIAS / ASSOC are not named.
- **F-4102:** the row lists 4 LCONF atoms. #14 declares 10: it also has autoCloseBefore, colorizedBracketPairs, folding, onEnterRules, surroundingPairs and wordPattern. #14 also names `languages.setLanguageConfiguration` as an alternative stable API.
- **F-4201:** `localFiles` holds "ssh_config(5) manual". That is a documentation source, not a file the runtime touches. Move it to notes or `reuse`.
- **F-4202:** local files are missing `l10n/bundle.l10n.<locale>.json`, which holds the 2 strings STR:S001 and STR:S002.
- **F-4204:** the row does not name the atoms ABSENT:diagnostics, ABSENT:documentSymbols and ABSENT:hover.
- **F-4203:** the row records ABSENT:valueCompletion only in prose.

### Missing cites
- Every feature row except F-4204 is missing remote-containers#F-0109 (the R-46 contract). All nine specs cite it.
- F-4001 is missing F-4003, F-4202 and F-4203.
- F-4101 is missing F-4202, F-4203, F-4902 and remote-containers#F-1403.
- F-4202 is missing F-4204.
- F-4203 is missing remote-containers#F-1403.
- F-4204 is missing remote-containers#F-1403 and #F-1406.

### Error paths
No row that has the right body undercounts by more than 2. F-4101 has 9 against E1..E10.

### Clean-side flags
Each spec's provenance section cites material not for the clean side:
- reference package files under `sources/ms-extension-0.87.0/` (all 11 issues)
- inventory-pass or lab transcripts (#10, #11, #13, #15)

Only the F-4901 row records this. Add "spec cites material not for the clean side" to the questions of the other rows.

## 3. Component doubts

- **F-4002:** `ssh.activation-manifest` with lib-product carries the remote-ssh namespace. Proposed: `ssh-edit.activation`. Library `none` (manifest fields only), or the shared manifest library in section 5.
- **F-4003:** `ssh.command-surface` is a remote-ssh component. Proposed: `ssh-edit.package-identity` (manifest metadata plus l10n bundles plus README).
- **F-4001, F-4901 and F-4003:** these describe the same manifest identity data (language id, aliases, patterns, scope root, display name) under 3 component names. Merge them into one `ssh-edit.manifest`. F-4901 stays a decision row that points at it.
- **F-4201, F-4202, F-4203 and F-4902:** four component names for one completion provider (`keyword-completion`, `tunnel-snippet`, `completion-positions`, `keyword-catalogue`). Proposed: one `ssh-edit.completion` component with a keyword-table data module.
- **candidateLibrary is inconsistent.** F-4201 says lib-identifiers and F-4902 says none for the same keyword list. Grammar (F-4101), language configuration (F-4102) and completion (F-4201..4203) are not identifiers, so lib-identifiers fits only the language id and scope names (F-4001, F-4901). Set the others to `none`, or to an ssh_config keyword library (section 5).
- **F-4204:** `ssh-edit.no-aids-contract` is not a component. Mark it `none`; it is conformance tests only.

## 4. Dangling citations

None. All cited ids exist:
- the ssh-edit ids
- remote-containers F-0109, F-1401, F-1403, F-1405 and F-1406 (checked with `gh issue list --search`)
- the remote-ssh ids that the F-4002 and F-4003 rows cite. These exist but are spurious; see sections 1 and 2.

## 5. Shared-behaviour candidates

- **`ssh_config` language and keyword knowledge.** Also appears in remote-ssh (F-2007, F-2201, F-2203, F-2204), remote-explorer (F-5001, F-5101, F-5102) and remote-extensionpack F-9901. Proposed: one ssh_config identifiers/keywords library holding the language id `ssh_config`, the scope root `source.config.ssh` and the keyword table (F-4902).
- **`remote.SSH.configFile`.** F-4001 7.E6 reads it, and so do remote-ssh (F-2201..F-2204, F-2008, F-2106, F-3906), remote-explorer (F-5001..F-5104) and remote-containers (F-0417, F-0708, F-1002). One config-path resolver in a library.
- **extensionKind and untrusted / virtual workspace declarations** (`remote.extensionKind`, `extensions.supportUntrustedWorkspaces`). Also in remote-ssh F-2001 and F-2007, remote-wsl F-6001, remote-containers (F-0505, F-0603, F-1202), remote-explorer (F-5001, F-5101, F-5201, F-5902) and remote-extensionpack F-9103. One shared manifest-capability checklist or test library.
- **Activation on `onLanguage:ssh_config`.** remote-ssh F-2001 and F-2007 also mention it. Check whether both extensions activate on the same language, and record who owns the trigger.
- **Localization mechanism** (`package.nls*.json`, `l10n/bundle.l10n.<locale>.json`, `vscode.l10n.t`). Used by F-4003 and F-4202, and in all repos except remote-extensionpack. One shared l10n library and build step.
- **Extension identity and telemetry decisions.** F-4901 applies remote-containers F-1406 and F-1405, and F-4003 does the same. Keep identity values in the shared identity library with the other rooms.
- **R-46 out-of-context command contract** (remote-containers F-0109). Cited by every ssh-edit feature spec and by all six other repos. It is already one contract; rows should cite it rather than re-describe it.
