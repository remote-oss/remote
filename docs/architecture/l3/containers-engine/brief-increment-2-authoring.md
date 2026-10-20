# Brief: Remote - Containers, increment 2, authoring

Status: ruled by athena (architect), 2026-10-20, from daedalus's design request (remote-oss/remote#1204). Increment
2's authoring part is the user's D-87 ("authoring and ports go to increment 2") and `brief-release-1.md` §2. One
scope question is parked for the user (§2). Everything else here holds whatever the answer is. Sources:
- the published specs F-0801 (remote-oss/remote-containers#53), F-0802 (#40) and F-0403 (#22), all `spec:reviewed`;
- their cross-references F-0301, F-0401, F-0405, F-0106, F-0302, F-0803, F-0804, F-0805 and F-0413;
- the area C dossier (C14);
- ADR-0009 (the CLI);
- `brief-release-1.md`.

Facts about the public catalogue and the pinned CLI below are marked *measured 2026-10-20*. They're our own
measurements, not the specs'.

## 1. The job

**A folder with no `devcontainer.json` gets one from a template**, through one wizard. Its entry points are:
- "Dev Containers: Add Dev Container Configuration Files..." (F-0801);
- "Open Folder in Container..." on such a folder (F-0403 Flow A);
- Reopen and the rebuild-and-reopen commands on such a folder (F-0401 AC-8, F-0405 AC-13);
- "Use Template" on S113 (F-0301 7.E2, F-0405 7.E8 b).

The interim notice of release 1 (`CONFIG_TEMPLATES.noConfiguration`) goes. So does its entry on F-1406's list of
invented identifiers and its line under "Interim behaviour" in `release-1-notes.md`. The window kinds are a local
single-folder window and an ordinary dev container window (F-0801 BR-12). The others come with their own features.

## 2. Parked for the user: the wizard's later stages and the user-data folder

F-0802 AC-6 to AC-8 require the screens after the template pick:
- the options pick (F-0803, P1, 32 criteria);
- "Select Features" (F-0804, P1, 29 criteria);
- "Optional Files/Directories" (F-0805, P2, 21 criteria).

F-0801's "Add configuration to user data folder" (S026) writes into F-0302's store (P2): F-0801 AC-3, AC-5, AC-8 and
AC-17, and F-0403 AC-4. None of the four is in `brief-release-1.md`'s increment 2. Adding them is a cut change, so it's
the user's (AGENTS.md: scope).

| Option | What it means | The criteria |
|---|---|---|
| **(A) In** (recommended) | F-0803 and F-0805 render the template's own `options` and `optionalPaths` from the catalogue. F-0804's pick comes with F-0414, which increment 2 already has ("the rest"). F-0302's store is built far enough for S026, copy-to-workspace, and discovery for Flow B. | All asserted. About 82 more criteria are seeded. |
| (B) Out | The wizard goes straight from the template to the write with the template's defaults. S026 is hidden, and the location pick is skipped as in F-0801's reduced shape. | F-0802 AC-6 to AC-8, F-0801 AC-3, 5, 8 and 17 and F-0403 AC-4 become deviations (release notes plus spec questions). F-0803, F-0804 and F-0805 stay unseeded. |

I recommend (A): without options a template can't be adapted at all, and the cost is small screens over data the
catalogue already carries (*measured*: every template entry has `options` and `optionalPaths`). **Until the user
answers, cards start only on what both options share**, which is rulings 1 to 9.

## 3. Rulings

1. **One component, C14 (authoring), and continuations per caller.** C14 runs the wizard and returns
   `written {files, target}`, `cancelled` or `failed {detail}`. It never reloads and never starts a container. Each
   caller continues on its own:
   - F-0801's command opens the file as a preview and raises F-0402's notification (the folder variant, or the
     user-data variant under (A));
   - F-0403 Flow A reloads into the container through C6's existing `commandBeforeReload` and `reloadIntoContainer`,
     with no editor and no notification (5.0 step 9b);
   - Reopen and rebuild-and-reopen go on with release 1's connect on the written file;
   - S113's "Use Template" runs F-0801's continuation.

   C6 (open flows) calls C14, and C14 knows no caller.
2. **The trust order is the spec's, entry point by entry point.** Open Folder's Flow A runs the wizard and the write
   untrusted, and asks for trust after the reload has begun (F-0403 6.6, F-0801 PRE-2). Reopen asks first (F-0106
   AC-2). This doesn't contradict `brief-release-1.md` §2's "ask for trust before anything runs". That sentence
   governs execution (a build, a container, a lifecycle command), and writing a template's files into the user's own
   folder executes nothing. Execution still never happens untrusted.
3. **The catalogue: the published index of the dev container specification, fetched per run.**
   - *Source:* `https://containers.dev/static/devcontainer-index.json`. *Measured:* about 2 MB, with 183 templates and
     1460 Features, each template carrying its `options` and `optionalPaths`.
   - *When:* once at the start of each wizard run, never reused (F-0802 BR-1), and one fetch feeds both the template
     list and, under (A), the Feature list.
   - *How:* the extension host's `https` module, which core makes follow `http.proxy`.
   - *Failure:* the preferred outcome, our own message naming the network cause, before any screen (F-0801 7.E10,
     F-0802 7.E3). Its text is ours (ADR-0008), so it's a spec question for an `[adaptation]` string, with a
     provisional key until then.
4. **A template is applied by the CLI into a scratch folder, then copied by us.**
   - `devcontainer templates apply -w <scratch> -t <id> -a <options> [-f <features>] [--omit-paths <unchecked>]`.
     *Measured:* CLI 0.89.0 has these flags. The scratch folder is under our own storage and removed afterwards in
     every outcome.
   - C14 then copies into the target:
     - add or replace, never remove (F-0801 BR-5);
     - S182 once per existing file, Overwrite | Cancel | Skip, where Cancel writes nothing at all (BR-6);
     - nothing written on any failure (7.E8);
     - the dirty-editor check (7.E11).
   - This keeps the CLI unmodified (ADR-0009 rule 1) and gives us the write rules the CLI doesn't have.
   - The spawned CLI gets the editor's environment, as release 1's bridge does, and the user's own Docker credential
     helpers are the only credentials.
   - *Measure first:* the `templates` subcommands don't list `--log-format`, so ADR-0009 rule 3 (JSON events) has to
     be measured for them before the bridge card. If they don't give events, their result is read from the exit
     code and the written files, never from text.
5. **The runtime services, and what isn't bundled.** The product fetches the index (published data of the open
   specification) from containers.dev, and the CLI pulls templates from their registries, `ghcr.io` for the
   `devcontainers` collection (MIT templates), as the reference does (F-0802 BR-1, BR-7a). That's parity, and it's
   what the dev container specification publishes these for. **We bundle no template content:** R-76 admits the CLI
   as a source, not the templates' files. So the reuse rows (`From '<file>'`) apply the real
   `docker-existing-dockerfile` template through the same path, and they need the network like any template (F-0802
   BR-13). Compose rows (`docker-existing-docker-compose`, "Select a service") wait for F-0413, so their criteria are
   `later (Compose)`.
6. **The curated list is our own table** (F-0802 §16 allows it). The curated variant shows when any non-neutral file
   exists below the folder, `.git` excluded (BR-14). It holds Show All Templates, Learn More, the core set and our
   language matches. The table and the neutral list are data in C14, named in the card. The rows assert BR-14's
   rule, not the observed lists, which disagree between F-0403 and F-0802 (spec question on #40).
7. **Custom ids are in** (F-0802 BR-6 to BR-8). Two slashes switch to the custom-id row, `templates metadata` runs
   best-effort on select only, and its failure is silent. Apply failures show S039 with Cancel | Show Log (7.E1). The
   CLI's own OCI defaults apply, and we add no credential setup (F-0802 §15).
8. **Links:**
   - Learn More (S148) opens our documentation URL (R-31), as F-0402's already does;
   - the per-template Open Documentation (F-0105, `spec:draft`) isn't shown, and its criteria are
     `later (F-0105)`;
   - telemetry: none (F-0801 BR-9, R-28).
9. **Harness first** (cards before C14's):
   - *Catalogue:* the run serves its own pinned index from the run's download host (`tools/acceptance-downloads.ts`).
     The product reads the index URL from a harness-only environment variable, documented as such and never in a path
     a user reaches, like the acceptance log tee.
   - *Templates:* the pinned index names templates in the run's registry (containers-59, #1157). *Measure first*
     whether CLI 0.89.0 pulls from a plain-HTTP `127.0.0.1` registry. If it doesn't, the registry gets a run-local TLS
     certificate.
   - *Images:* every Flow A row pulls the template's image, so the run pre-pulls it by digest, as the Alpine one is.

## 4. Contracts and components

- **C14 (authoring)**, new in `components.md` §1, with its contract in `contracts.md`:
  - `runWizard({caller, folder, window kind}) → written | cancelled | failed`;
  - the catalogue port (fetch, parse);
  - the CLI port's two new calls, `applyTemplate` and `templateMetadata`, on the existing bridge;
  - the file-copy port.
- **C6** gains the hand-off from Open Folder, Reopen and the rebuild commands on a folder with no configuration.
- **C10**'s S113 path gains "Use Template".
- **The manifest** gains `remote-containers.createDevContainerFile` at F-0801's indices (`remote_30_dev-container_2_actions@4`)
  with its card (ruling 8 of `brief-release-1.md`).
- **The strings** of F-0801 and F-0802 (35 S-ids) go into `*_TEMPLATES` and every bundle, checked by
  `check-string-tables`.

## 5. Acceptance target

- **The 21 `increment 2 (authoring)` rows** of `coverage-containers-r1.tsv` (F-0106, F-0301, F-0401, F-0403, F-0405)
  become `acceptance`.
- **F-0801 (43) and F-0802 (37) are seeded and tagged,** less the criteria ruled `later` above (Compose, F-0105) and,
  under (B), §2's deviations.
- **Under (A),** F-0803, F-0804 and F-0805 are seeded too.

## 6. Spec questions, open

- F-0802 #40: the reuse rows (F-0403 vs F-0802), and the curated `.js` table.
- F-0801 #53: S113 and "Use Template" (F-0801 and F-0802 vs F-0301 and F-0405), the owner of "Select a service", and
  the stale §15 notes.
- 7.E10: our own network-failure string (ruling 3).
