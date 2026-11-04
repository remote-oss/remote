# Brief: the containers foundations (F-0102, F-0103, F-0107, F-0108, F-0109)

Owner: athena (architect). Plan: #1807's release-2 families (seed-01), "foundations first". Specs, all
`spec:reviewed`:
- remote-oss/remote-containers#88 (F-0102 Settings catalogue and legacy setting migration);
- #74 (F-0103 Localization);
- #51 (F-0107 Command availability matrix and context keys);
- #50 (F-0108 Shared UI conventions and vocabulary);
- #90 (F-0109 Programmatic command interface).

Decisions: D-14, F-1406, R-31, R-46, R-60, ADR-0003, lib-identifiers (`settings.ts`'s `readSetting`).

## 1. What a survey of the 126 open lines found

Every open line was read against the built manifest, code and rows (2026-11-04):

| Family | Built, needs a row | A gap of ours | Waits on another feature |
|---|---|---|---|
| F-0102 | 9 | 13 | 9 |
| F-0103 | 5 | 5 | 0 |
| F-0107 | 5 | 1 (a spec conflict) | 14 |
| F-0108 | 14 | 0 | 11 (1 to measure) |
| F-0109 | 10 | 3 | 25 (1 to measure) |

These families mostly describe **rules every feature keeps**. So most lines complete as the features they name land, and
this brief settles **the rules and the gaps**.

## 2. Settings (F-0102)

- **One reader for every setting.** remote-containers reads every setting through lib-identifiers' `readSetting`, which
  remote-ssh already uses: scope-aware, honouring `winner`, with its rule that an empty or null legacy value doesn't
  count. The three pairs hand-rolled today (`cache-volume.ts`, `mount-settings.ts`, `defaultExtensions` in
  `extension.ts`) move onto it.
- **`identifiers.json` `settingPairs` declares all 14 legacy pairs**, each with its `winner` per F-0102's table.
- **The catalogue grows with its features.** Each setting is contributed by the card that builds the feature it drives
  (R-60: no switch that does nothing). The 43-key catalogue and the remote window's 21 machine-scope rows then complete
  as personalization, WSL, Apple and the log land (F-0102 AC-2, AC-3, AC-6, AC-13, AC-14, AC-23).
- **Now, for features already built:**
  - the legacy twins `remote.containers.dockerPath`, `remote.containers.dockerComposePath` and
    `remote.containers.repositoryConfigurationPaths` are contributed and read through the pairs (AC-7, AC-9, AC-10,
    AC-15, AC-25; AC-25 reads `globalValue` only);
  - `experimentalMountGitWorktreeCommonDir` gets `tags: ["experimental"]` and a markdown description;
  - `repositoryConfigurationPaths`'s text follows §3.2 (AC-3's halves for built keys).
- **`(reading-NNNN-git-scheme)`, F-0102 AC-28 against F-0302:**
  - **The conflict:** AC-28 says a `git://` remote maps to no mirrored folder, while F-0302 (the owner of the lookup,
    its Q2 and 7.E3) maps it on purpose.
  - **The reading:** the owner's spec wins, and `mirrored-paths.ts` stays as it is. The question goes to metis to
    reconcile AC-28.

## 3. Localization (F-0103)

- **The English base bundle isn't shipped.** `l10n/bundle.l10n.json` stays the source table in the repo (tooling-41).
  `.vscodeignore` leaves it out of the VSIX, keeping the locale bundles (AC-2: no base file in the package).
- **qps-ploc is generated,** not written: a tool in `tools/` pseudo-localizes the English tables, both the manifest
  strings and the `l10n` bundle, into `translations/qps-ploc.json`, keeping placeholders and `{Locked=…}` entries
  (AC-3, AC-9). It's the same mechanism remote-ssh's table has.
- **Turkish** is the one real language a criterion renders (AC-4, AC-10). Card 2 writes `tr` translations of **our own**
  strings, which are ours to translate, so no licence question arises. The other locales stay English copies, falling
  back per string as AC-5 and AC-6 accept.
- **Reading `(reading-NNNN-key-counts)`:** the 159 manifest keys and 437 bundle keys of F-0103 AC-1 and AC-2 are the
  reference's counts. Ours are ours, and the rows assert our tables are complete and consistent, not those numbers.

## 4. Command availability and context keys (F-0107)

- **Palette clauses follow F-0107 §3.1's families.** `openFolder` is narrower today: `remoteName =~ /^(dev-container)?$/`
  hides it in attached windows, which are built now. It takes §3.1's eight-name family clause at once. Every other
  open command takes its §3.1 clause in the card that builds its window kind.
- **Context keys are set by their owners:**
  - `canReopenInSSH` and `canReopenInTunnel` by group 16;
  - `canReopenInWSL` by the WSL family;
  - `isRecoveryContainer` by the recovery card;
  - `remote-containers:noDevVolumes` by F-0904's card;
  - `remote-containers:needsSSHCredentials` by group 16 part A's relay.

  `hideConnectCommands` and `hideRebuildCommands` are never set by us (BR-6, BR-7).
- **`(reading-NNNN-failure-dialog)`, F-0107 AC-13 and AC-15:** where they describe the failure dialog and its pick
  differently from F-0410, the dialog's owner, F-0410's text holds and the built dialog is right. The F-0107 lines
  assert availability only, and the conflict goes to metis.

## 5. Shared vocabulary (F-0108)

No product gap. Its lines are tagged as the features that show each pattern land. The `aka.ms` literals of AC-24 read
as our own pages under R-31 (the standing ruling that help and issue URLs are ours).

## 6. The programmatic interface (F-0109)

- **`openFolder`'s argument contract** (C1, BR-8, BR-10; AC-31, AC-36):
  - **What it gains:** the handler takes `(uri?, options?)` with `forceNewWindow`, `forceReuseWindow` and
    `noRecentEntry`, and skips the folder dialog when a `uri` is given.
  - **Bad paths:** a `uri` that names a file or a missing folder ends in S034 (F-0410's generic dialog), with nothing
    created.
  - **Today** the handler takes no arguments.
- **Out-of-context refusals in an attached window** (AC-38):
  - `reopenLocally` shows S009 (its owner's text);
  - `switchContainer` shows S240, where today it only logs.
  - R-46's safety holds in every other window kind.
- **AC-39** (Add Dev Container Configuration Files in an attached window whose container folder holds a configuration):
  card 3 measures whether a confirmed pick edits that file. If it does, the line comes to me.

## 7. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| the survey's built lines | rows and tags now (card 4); F-0102 AC-4, AC-5, F-0103 AC-7, AC-8, F-0108 AC-1 as `core` with reasons |
| the gaps above | cards 1 to 3 |
| lines naming an unbuilt feature (attach's commands, Kubernetes, Apple, the URI handler, Dev Volumes, recovery, WSL, SSH, tunnels) | with that feature's card, as each brief's cut already says |

**Suggested cards** (daedalus):
1. **Settings:** §2, `readSetting` everywhere, the 14 pairs, the three legacy twins, the tag and the texts.
2. **Localization:** §3, the VSIX without the base bundle, the qps-ploc generator, and the `tr` translations.
3. **Commands:**
   - §4's `openFolder` clause;
   - §6's argument contract and the attached-window refusals;
   - AC-39's measurement.
4. **Rows and tags** for the built lines. It's tests only.

**Spec questions for metis** (with this brief's PR): F-0102 AC-28 against F-0302 Q2, and F-0107 AC-13 and AC-15 against
F-0410.
