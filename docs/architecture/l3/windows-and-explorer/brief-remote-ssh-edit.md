# Coding brief: remote-ssh-edit (first coding target)

Status: draft by `remote-architect-worker-2` for the lead's review, 2026-10-06. After review the lead hands it to a
coding worker. The design is `components.md` (remote-ssh-edit), the contracts are `contracts.md` §1, and the ADRs are
0002, 0003, ADR-0007 (the `engines.vscode` floor, being written) and the draft "Identifier tables".

## What the package contains

`packages/remote-ssh-edit`, extension `remote-oss.remote-ssh-edit`, three components:

| Component | Content | Features |
|---|---|---|
| `sshedit.package` | Manifest with `extensionKind` `["ui"]`, `capabilities.untrustedWorkspaces.supported` true, empty `activationEvents`, `main` only, no `browser`, no proposals, no dependencies or pack. `package.nls.json` plus 14 locale files. `l10n/` runtime bundles for the 14 locales. README, MIT licence | F-4002, F-4003, F-4901 |
| `sshedit.language` | `contributes.languages`, `contributes.grammars` (the TextMate grammar file) and the language configuration file. Declarative only | F-4001, F-4101, F-4102 |
| `sshedit.completion` | The activation function registers one completion provider for `ssh_config` with trigger character space, and nothing else. It holds the keyword data list (95 items with documentation, R-53), the "Configure tunnel" snippet item and the position gate | F-4201, F-4202, F-4203, F-4204, F-4902 |

Activation writes nothing, shows nothing and logs nothing (F-4002 AC-14). There is no output channel.

## Identifiers fixed by F-4901 (remote-ssh-edit#6), verbatim

| Kind | Value |
|---|---|
| Publisher, id, display name | `remote-oss`, `remote-oss.remote-ssh-edit`, "Remote - SSH: Editing Configuration Files" (D-41) |
| Language | id `ssh_config`; aliases "SSH Config", "ssh_config", in this order |
| File associations | filename `ssh.config`; filename patterns `**/.ssh/config`, `/etc/ssh/ssh_config` |
| Grammar | scope `source.config.ssh`, and every token scope F-4101 lists |
| Commands, settings, views, menus, context keys, keybindings | none |
| Invented ids (R-27) | none |

## Libraries and the contract subset

| Library | Subset used | Note |
|---|---|---|
| `lib-identifiers` | The generated table (kind `languages` only) and `checkStringTables` at build time | No commands, settings or context keys exist |
| `lib-standdown` | Only if R-54 is extended to ssh-edit (question 1 below) | The container view's import graph lists it; leave it out until the answer |
| `lib-log` | none | The container view lists it, but the spec forbids a log (F-4002 AC-14) |

The completion provider talks to the editor through one adapter over `languages.registerCompletionItemProvider`. The
keyword list, documentation, position gate and sort keys are plain data and functions, unit-tested under Mocha
(ADR-0003 gates).

## Conformance target

The remote-ssh-edit suite (`tests/conformance/` in remote-oss/remote-ssh-edit) has 744 cases over 8 features:

| Feature | F-4001 | F-4002 | F-4003 | F-4101 | F-4102 | F-4201 | F-4202 | F-4203 |
|---|---|---|---|---|---|---|---|---|
| Cases | 64 | 72 | 29 | 99 | 164 | 115 | 104 | 97 |

- **First target: 706 cases**, every case in the 10 profiles that need no companion.
- **Deferred: 38 cases** in `clean-sshwindow` (20), `dirty-sshwindow` (7), `clean-companions` (8) and
  `clean-sshrestricted` (3). They need our Remote-SSH and Remote Explorer packages as fixture companions, and the
  schema bans the Microsoft ids.
- **Runner gap**: the runner enables no proposed API. ssh-edit declares none, so the gap does not block this
  package.
- **F-4204** has no cases. Its ACs are checked in review: nothing else is registered.
- **Engine floor**: no case checks `engines.vscode`, so ADR-0007's floor applies. Tell the room that F-4003 BR-9
  quotes the reference's floor.

## To settle before coding (through the lead)

1. **R-54 for ssh-edit** (constraint K2): F-4901 §6 says "unsupported, no handling", while F-9901 §5 step 3 counts
   ssh-edit among the members that stand down. It decides whether activation may show a warning (F-4002: activation
   shows nothing), whether the package imports `lib-standdown`, and whether a standing-down key gates anything. The
   package contributes no menus, so the key would gate nothing.
2. **The seven own-text keywords** (constraint K11): F-4902 §5 says "these two items" after listing seven keywords,
   while §6 says seven. This decides which seven documentation entries are presence-only and own text, which is data
   in `sshedit.completion`.

Not blocking, with the answer to use:

- Activation events: an empty list (F-4002 3.3).
- Display name: D-41 verbatim.
- Language-configuration ownership: follow F-4102 (F-4204 and F-4001 name another owner; traceability follows
  F-4102).
- Core's `quickSuggestions` default: core's own behaviour. The extension never sets it, and the cases were recorded
  on 1.139.1.

Done means the 706 cases pass in the runner against the packaged VSIX, the ADR-0003 gates are green, and the PR answers
R1–R6.
