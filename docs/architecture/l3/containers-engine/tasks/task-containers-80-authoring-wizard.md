# Task card containers-80: the authoring wizard (C14), its entry points and their continuations (F-0801, F-0403 Flow A)

Containers increment 2, authoring. Size: L. Builder: `task:claude`. Brief:
`docs/architecture/l3/containers-engine/brief-increment-2-authoring.md` rulings 1, 2, 7 and 8, and §4. Specs: F-0801
(#53), F-0802 (#40), F-0403 (#22), F-0401 AC-8, F-0405 AC-13, F-0301 7.E2. **Depends on containers-77 (#1239),
containers-78 (#1240), containers-79 (#1241), coverage-52 (#1237) and tooling-57 (#1235).**

**Scope until the user answers the brief's §2.** This card builds what options (A) and (B) share:
- **local, single-folder windows**;
- **the workspace target** only, with no location pick: the S026 row is the parked question;
- **the template's defaults** for its options: each option's `default`, with no options pick;
- **no Features**;
- **no optional paths**: every `optionalPaths` entry goes in `omitPaths`, which is F-0805's default of `0 Selected`.

That's (B)'s shape. Under (A), a later card inserts the location pick and the F-0803, F-0804 and F-0805 stages into
the same sequence. Under (B), they stay out and become deviations. Build the stage sequence as a list in one place,
so either answer is a small change. Dev container windows, SSH, multi-root, WSL and the rest stay out (their criteria
are deferred).

## 1. C14 (`src/authoring/wizard.ts`, new; `components.md` §1 and `contracts.md` gain C14, as the brief's §4 says)

```ts
export type WizardOutcome = {kind: 'written'; files: string[]; target: string} | {kind: 'cancelled'} | {kind: 'failed'; detail: string};
export function runWizard(request: {title: string; folder: string}, ports: WizardPorts, cancellation: AbortSignal): Promise<WizardOutcome>;
```

1. `fetchCatalogue` (containers-77). On failure, `showCatalogueFailure`, then `failed`. No screen is shown first.
2. The folder's facts (root entries; the bounded walk for significant files, containers-79 §2).
3. `pickTemplate` (containers-79):
   - `learnMore` and `cancelled` give `cancelled`;
   - `reuse` gives `templateId` = docker-existing-dockerfile, with no options. Check whether the written
     `build.dockerfile` names the picked entry (F-0802 6.5 step 2, `../<entry>`): the template's own default may
     name `Dockerfile`. If it doesn't, write the entry into `build.dockerfile` after the copy with a JSONC edit (the
     package's JSONC helper), and say so in the PR.
4. `writeTemplate` (containers-78) into the folder, with `templateArgs` = each option's `default`, `features: []`
   and `omitPaths` = every optional path.
5. Return its outcome.

C14 never reloads, never opens an editor and never starts a container. Each caller continues (ruling 1).

## 2. The entry points and their continuations (C6, C10)

1. **`remote-containers.createDevContainerFile`**, "Dev Containers: Add Dev Container Configuration Files..." (F-0801):
   - **The manifest:** the command, the palette `when` `!remoteName && !virtualWorkspace` (the local clause only, for
     now), and the remote-indicator menu entry at `remote_30_dev-container_2_actions@4` with
     `workspaceFolderCount != 0 && !remoteName && !virtualWorkspace`. Follow `brief-release-1.md` ruling 8 and how
     the package adds a manifest entry (`identifiers.json` and the generator, then `package.json`), with the
     identifiers' unit rows. Each `when` also carries `!remote-containers:standingDown`, as every gated entry does.
   - **No folder open:** the modal S263 `Open a folder to create the configuration files in first.`, with `Cancel` |
     `Open Folder` (primary). Open Folder runs core's open-folder command (F-0801 AC-2, AC-15).
   - Otherwise, `runWizard({title: S024, folder})`.
   - **After `written`:** open `.devcontainer/devcontainer.json` as a preview editor, and raise F-0402's reopen
     notification, the folder variant (`open/reopen-notification.ts`).
2. **F-0403 Flow A**, Open Folder in Container on a folder with no configuration (`open/open-folder.ts`, where
   `choice.kind === 'noConfiguration'` shows the interim notice today):
   - `runWizard`;
   - **after `written`:** go on as Flow B does with the written file, through C6's `commandBeforeReload` and
     `reloadIntoContainer`, with no editor and no notification (5.0 step 9b);
   - **the trust order** (ruling 2): the wizard and the write run untrusted, and trust is asked after the reload
     has begun, where Flow B asks it today (F-0403 6.6).
3. **Reopen in Container and the rebuild-and-reopen commands** on a folder with no configuration (`open/reopen.ts`,
   the same `noConfiguration` branch): trust is asked first (F-0106 AC-2), then `runWizard`, then release 1's connect
   on the written file (F-0401 AC-8, F-0405 AC-13).
4. **S113's "Use Template"** (`config/choose-configuration.ts`, where S113 is shown): add the button and run entry
   point 1's continuation after `runWizard` (F-0301 7.E2, F-0405 7.E8 b). Read the brief's §6 question on #53 first.
   If the spec has answered which flow "Use Template" runs, follow it; otherwise follow ruling 1 and say so.
5. **The interim notice goes:**
   - remove `CONFIG_TEMPLATES.noConfiguration` and its bundle entries;
   - remove its entry on F-1406's list of invented identifiers;
   - remove its line under "Interim behaviour" in `release-1-notes.md`.

## 3. Rows

**Unit:** `wizard.test.ts`, over fakes: each step's outcome and the stage list. Then each entry point's continuation,
and the trust order of 2 and 3.

**Acceptance** (`tests/acceptance/containers/authoring.test.ts`, in the `containers` launch with tooling-57's catalogue
and registry). Each row empties its folder first. The rows name the criteria they prove:
- F-0801 AC-1: the palette item;
- AC-2 and AC-15: no folder, S263, then Open Folder;
- AC-4: alpine on an empty folder, `.devcontainer/devcontainer.json` written and opened in preview, F-0402's
  notification;
- AC-9: S182's three answers, one row each;
- AC-16: the progress and its end;
- AC-24: the dotfile left alone;
- AC-30: a `.devcontainer` file, and a read-only folder;
- AC-35 and AC-36: the network cases, through tooling-57's broken and unreachable index paths and a template id the
  registry lacks;
- AC-37: a subfolder configuration;
- AC-38 and AC-39: other files kept, and the unsaved editor;
- F-0802 AC-1: the four entry points' screen;
- AC-2 to AC-5: the flat screen;
- AC-9 to AC-13: custom-id, through the run's `remote-oss-run/custom/mini` and a missing one;
- AC-18: Learn More;
- AC-19: Escape;
- AC-20: the written file holds no UI text;
- AC-21: untrusted, no trust prompt;
- AC-22, AC-29 and AC-36's Dockerfile half: the chooser;
- AC-24, 25, 26, 28, 30, 34 and 35: curated versus flat by BR-14's rule;
- AC-31: no persistence;
- AC-33: Flow A's hand-off;
- AC-37: per-run download (the download host's request log counts two fetches for two runs).

Rows that need the parked stages, the S026 row or another window kind stay as coverage-52 tagged them.
- **The 21 `increment 2 (authoring)` lines** (F-0106 AC-2, AC-44; F-0301 AC-7, 10, 22, 49, 54, 66, 70, 72; F-0401
  AC-8; F-0403 AC-4 to AC-10, AC-23; F-0405 AC-13, AC-32): a row each, through the entry point it names, and the
  line becomes `acceptance`.
- A line whose criterion needs §2's stages (F-0403 AC-4 is S026) takes the reason `containers release 1: increment 2
  (authoring, the user's §2 question)`.

**Coverage:** every criterion whose row passes becomes `acceptance`. The curated rows assert BR-14's rule against our
table (ruling 6): AC-24, AC-26, AC-34 and AC-35 pass on the rule, and their observed lists are the open question on
#40. Note that in the PR.

## 4. Done when

- The unit rows pass, with `wizard.ts` at 100 %.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers` passes. Paste the summary line.
- `check-string-tables`, `check-coverage` and all gates pass.
- PR title: `remote-containers: the authoring wizard, its entry points and their continuations (card containers-80,
  #1242)`. Request athena only.
