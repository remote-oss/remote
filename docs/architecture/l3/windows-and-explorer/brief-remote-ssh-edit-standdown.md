# Coding brief (follow-up draft): remote-ssh-edit stands down for the reference

Status: draft by `remote-architect-worker-2`, 2026-10-06. **It waits for the F-4002 and F-4901 revision**
(remote-oss/remote-ssh-edit#11 and #6), which carries R-77 into the spec. It is issued the day those edits land, and
it extends `brief-remote-ssh-edit.md`, which stays in force for everything else.

## What changes in the package

- **Activation, first step**: `lib-standdown`'s guard, with the reference id `ms-vscode-remote.remote-ssh-edit`.
  It runs before the completion provider is registered (R-54, R-77).
- **Reference present (`standing`)**: the guard shows one warning with one button, which opens the Extensions view
  on the reference. Then activation returns without registering the completion provider. The language, grammar and
  language configuration are manifest data and stay as they are, because core reads them before activation. No
  mid-session check is made (R-78).
- **Reference absent (`serving`)**: activation is exactly as in the first brief.
- **The standing-down key gates nothing**, because ssh-edit contributes no menus, palette entries or welcome
  content. I recommend that the package passes no key, so no invented identifier exists with no reader (ADR-0003
  dead code). That needs `lib-standdown`'s key parameter to be optional, a one-line contract change.
  - If the F-4901 revision names a key anyway, it goes in the R-27 ledger and the guard sets it.
  - ssh-edit has no namespace of its own (no settings or commands), so the revision has to pick one.
- **Strings**: the warning text and button label come from the revision. They join the 14 locale bundles, and
  `checkStringTables` covers them.

## What F-4002's acceptance criteria become (expected; the revision decides)

- **Unchanged**: lazy activation on `ssh_config` only, never at startup (AC-23); no log, no files, no state
  (AC-14); kind `["ui"]`; Restricted Mode support.
- **"Activation does nothing visible"** gains one exception: the warning, at a standing activation only.
- **New, from the revision**: with the reference enabled, one warning per activation, no completion items from
  this extension, and normal behaviour after the reference is disabled and the window reloads.

## Libraries

`lib-standdown` is added: `standDownIfReferencePresent` with no key (or the revision's key). There is still no
`lib-log`.

## Conformance

- The 706 cases of the first target are unaffected. They were recorded without the reference installed, so the
  guard always answers `serving`.
- The standing case gets its cases when the room publishes them with the revision. Until then, unit tests prove
  it: present, absent, the provider not registered when standing, and exactly one warning.
