# Extension Pack release 1 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **The pack's description is the same English sentence in every display language.** Only its name is translated into
  the 14 languages. The extensions of the family do the same.
  - F-9001 AC-4 and BR-4 ask for a translated description in each of the 13 other bundles (D-56; spec question on
    remote-oss/remote-extensionpack #5).

- **The readme makes no statement about any other publisher's packs beyond the install advice.**
  - F-9002 AC-7 and BR-3 ask for a statement that the pack and its members are not another publisher's (D-56: no notice
    of affiliation anywhere; D-59; spec question on remote-oss/remote-extensionpack #6).

## Post-publish checks

A one-off checklist against the real gallery after the first publish. It is not a release gate: no field of the pack
decides these outcomes (`extension pack: after publication (post-publish check)` in the coverage file).

- **F-9101 AC-7:** install the pack in an empty profile of VSCodium; the members Dev Containers and Remote - SSH are
  active in the same window, with no reload, as soon as the install ends.
- **F-9901 AC-11:** look up each id the release's `extensionPack` lists on Open VSX; each is found with a version whose
  `engines.vscode` accepts the lowest editor version the project supports.
- **F-9901 AC-12:** in Microsoft's VS Code with both packs installed, disable the reference pack and its members and
  reload; each family extension activates on its own event, contributes its commands and views, and shows no coexistence
  warning.
- **F-9901 AC-19:** for the first release, `extensionPack` lists exactly Dev Containers then Remote - SSH (proved by the
  manifest row of F-9101 AC-1). For a later release, compare the list with the family members published on Open VSX
  before it: every one that is published with a compatible version is listed, and none that is not (no WSL before it is
  published, no `remote-oss.remote-server` while Remote - Tunnels is not built or not published).
- **F-9901 AC-20:** once a second release that adds a member exists, update an earlier release of the pack to it in
  VSCodium (the update or Install Specific Version); the new member is installed by the update and the members
  already installed are not reinstalled.
