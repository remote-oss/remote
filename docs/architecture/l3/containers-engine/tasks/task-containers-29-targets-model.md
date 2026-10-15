# Task card containers-29: C15's targets model, the Dev Containers view as a pure tree

Issue: #962. Milestone 0.4. Size: M–L. Builder: `task:claude`.

**Design:** athena's ruling on #960 (§1, "C15's shape"; card 1, the model half) and `components.md`'s C15 row as
amended in #961. **Builds after** containers-18 (#951) only for the legacy label tier (§1.1). Everything else can
start now.

Sources: F-0901 (remote-oss/remote-containers#76) §3.3 (the icon table), §3.4, §6.1–6.4, 6.9, 6.14, 6.16, 6.18,
6.19, 6.20, BR-1 to BR-5, BR-9, BR-11, BR-13, §16's decisions; F-0906 (#72) §3.3 for the view's name.

**What this card is:** the pure half of slice A. The engine's answer, the window's facts and the time go in, and the
whole tree comes out: groups, rows, labels, descriptions, tooltips, icons, `viewItem` values, stable ids and the
welcome key. No `vscode`, no engine run and no file read happen here. containers-30 (#963) shows the tree and
containers-31 (#964) rebuilds it on events. Both build against §2's interface, so they can start in parallel with this
card.

## 1. What 0.4 does and doesn't build

### 1.1 In

- **Grouping (BR-1):** "Dev Containers" first, then S267 "Other Containers". Each header exists only while it has a
  row. A container whose labels make it a folder's dev container goes under "Dev Containers":
  `devcontainer.local_folder`, and the legacy `vsch.local.folder` and `vsch.local.repository`. The label families are **exported from C7's
  `lifecycle/labels.ts`**, never copied (athena, #960):
  - export `devContainerFolderOf(labels): string | undefined` (the folder a container was made for, or none) and
    `isDevContainer(labels): boolean` from `labels.ts`, and make `decide` use the same constants;
  - containers-18 (#951) adds the legacy tier to `labels.ts`. If it isn't on main yet, export the current-label rule,
    and the legacy families arrive with #951. Build on main after #951 if you can.
  - The window's own connection is always in the group its labels give, with one exception, 6.20's recovery container,
    which is "Other Containers". 0.4 has no recovery container, so this needs no code beyond the label rule.
- **Rows:** in 0.4 every row is a top-level, merged row with no children. De-densification (BR-2), recorded and recent
  folders (BR-10) and the multi-folder parent rows of 6.5 and 6.17 need attach or Compose, which are Later (#960).
  `children` is always `[]`.
- **Labels (BR-3):** a dev container's row is labelled with its folder's display name, following AC-49's rules for a
  Linux UI (the last segment of the label's value, with a trailing separator dropped). An "Other Containers" row is
  labelled with its creation image reference, as written (AC-24, AC-55, VS-26). The **description** is the Docker
  container name (AC-4).
- **Icons (BR-4, §3.3's table):** `vmActive` for the window's own container; otherwise `vmRunning`, `vm` (Exited and
  Created) or `vmOutline` (Paused and Restarting).
- **Tooltips (BR-5):** `<label> (<name>) <State>`, plus the relative-time clause where BR-5, 6.16 and 6.18 put one:
  Exited, Restarting, a Running or Paused container that exited before and was started again, and a long run (AC-35).
  The window's own row says `Connected` (AC-4, AC-28). The relative time follows BR-5's unit and rounding rules
  (VS-25, AC-11, AC-36, AC-54). The words S429–S436 go through `translate`. The state words and the composition stay
  as BR-5 writes them, since they carry no S-id.
- **Order (BR-9):** within a group, ascending by label with AC-48's collation for an English display language, ties
  by creation time descending (AC-25, VS-4d). Choose the `Intl.Collator` options that give AC-48's exact order, and
  name them in a comment.
- **Stable ids (BR-13, §16):** the two headers have fixed ids, `devContainers` and `otherContainers`, and start
  expanded. A row's id is its full container id. Core keeps a collapse state across rebuilds only while the id stays.
- **The welcome key (§3.3's welcome table):** an unreachable engine gives `needsDockerStartOrInstall` and no groups.
  Zero containers gives `noContainersWithFolder` or `noContainersWithoutFolder`, by whether the window has a folder
  (the names describe the window, not the containers). Otherwise there's no key.
- **`viewItem` (BR-8, BR-11):** the menus' `when` clauses read these tokens, space-separated, in this order, each
  present or absent:

| Token | Present when |
|---|---|
| `container` | always: every 0.4 row stands for a container |
| `dev` or `other` | the row's group |
| `running`, `exited`, `created`, `paused` or `restarting` | Docker's state |
| `own` | the window's own connection (the `vmActive` row) |
| `activeFolder` | the own row of a dev container whose folder the window has open (`#10`) |
| `configuration` | a dev container row whose configuration exists on the host (BR-11, AC-30, AC-42, AC-43): from the input's set |

  Example: `container dev running own activeFolder configuration`. A `when` matches a token with
  `viewItem =~ /(^| )own( |$)/`. Slice B's placements use the same tokens, so they're fixed here.

### 1.2 Out (slices B and C, or Later; containers-32 tags them)

Attach rows and recorded folders (6.5, 6.12, 6.15, AC-12, AC-13, AC-20, AC-28's attach, AC-33, AC-53), Compose
(6.17, AC-37, AC-38), volumes (6.11, AC-27, AC-34), WSL, SSH and Tunnel origins (6.6, 6.10, 6.13), Kubernetes (6.8),
Windows UIs (AC-50 to AC-52), `needsSSHCredentials` (7.E2), S419, and S005, S022 and AC-58, which only multi-folder
rows use.

## 2. The interface (`packages/remote-containers/src/explorer/`)

```ts
// listed-containers.ts
/** One container as `docker inspect` reports it, with what the view reads. */
export interface ListedContainer {
  id: string;            // the full id
  name: string;          // without the leading '/'
  image: string;         // Config.Image, as created
  state: string;         // State.Status
  createdAt: number;     // epoch ms
  startedAt: number | undefined;   // State.StartedAt; undefined for Docker's zero time
  finishedAt: number | undefined;  // State.FinishedAt; undefined for the zero time
  labels: Readonly<Record<string, string>>;  // Config.Labels; {} for null
}
/** `docker ps -a -q --no-trunc`: every container's id. */
export const LIST_ARGUMENTS: readonly string[];
/** `docker inspect --type container <ids…>`. */
export function inspectArguments(ids: readonly string[]): string[];
/** The containers of `docker inspect`'s JSON array, or undefined when stdout isn't one. */
export function listedContainersOf(stdout: string): ListedContainer[] | undefined;

// relative-time.ts
/** BR-5's elapsed-time phrase without "ago", e.g. "1 minute", "5 hours": the unit, its rounding and its number. */
export function elapsedPhraseOf(milliseconds: number, translate: Translate): string;

// targets-model.ts
export type RowIcon = 'vmActive' | 'vmRunning' | 'vm' | 'vmOutline';
export interface TargetRow {
  id: string; label: string; description: string; tooltip: string; icon: RowIcon; viewItem: string;
  children: readonly TargetRow[];
}
export interface TargetGroup { id: 'devContainers' | 'otherContainers'; label: string; rows: readonly TargetRow[] }
export type WelcomeKey = 'needsDockerStartOrInstall' | 'noContainersWithFolder' | 'noContainersWithoutFolder';
export interface TargetsTree { welcome: WelcomeKey | undefined; groups: readonly TargetGroup[] }
export interface TargetsInput {
  containers: readonly ListedContainer[] | 'unreachable';
  window: {
    folderOpen: boolean;
    /** C10's held connection (containers-30 adds the accessor); none in a window that isn't a dev container's. */
    connection: {containerId: string; hostPath: string; remoteWorkspaceFolder: string} | undefined;
  };
  /** The ids of the dev containers whose configuration exists on the host (BR-11); containers-30 computes it. */
  withConfiguration: ReadonlySet<string>;
  now: number;
  translate: Translate;
}
export function targetsTreeOf(input: TargetsInput): TargetsTree;
```

- `Translate` is the package's (`surfaces/engine-dialogs.ts`).
- The "Dev Containers" header's text is the view's name, the English template `Dev Containers` (F-0906 §3.3), through
  `translate`. "Other Containers" is S267.
- **The strings:** `EXPLORER_TEMPLATES` in `targets-model.ts` holds S267 and S429–S436 (S436 as BR-5's unit after
  days), verbatim from F-0901 §3.4, with the singular and plural forms BR-5 and AC-11 call for. Add them to the l10n
  bundles as the package's other templates are.

## 3. Rows (unit only: `test/unit/listed-containers.test.ts`, `relative-time.test.ts`, `targets-model.test.ts`)

One row per in-scope criterion, named from the AC, plus a row for every branch. At least:

| Name starts | What it checks |
|---|---|
| `F-0901 AC-1, AC-2, AC-16` | the three welcome keys, and that an unreachable engine gives no groups |
| `F-0901 AC-4` | the own dev container's single merged row: label, description, `vmActive`, the `Connected` tooltip, `viewItem` `container dev running own activeFolder configuration` |
| `F-0901 AC-6` | the same container from an unconnected window: `vmRunning`, `Running`, no `own` |
| `F-0901 AC-7, AC-21` | the two headers in order, each only while it has rows; "Other Containers" rows labelled by image |
| `F-0901 AC-8, AC-9, AC-10` | Created, Paused and Restarting: icons, tooltips, tokens |
| `F-0901 AC-11, AC-36, AC-54` | relative time: 0 s, exactly 1 minute (singular), AC-54's table, about 66 minutes |
| `F-0901 AC-35, AC-39` | a long run and a restarted container's clause without "ago" |
| `F-0901 AC-24, AC-55` | image references as written: digest, `sha256:` id, short id, tag |
| `F-0901 AC-25, AC-48` | tie-break by creation time descending, and AC-48's exact collation order |
| `F-0901 AC-30, AC-31, AC-32, AC-42, AC-43` | label families and `configuration` from the input set |
| `F-0901 AC-49` | AC-49's Linux-UI folder labels |
| `F-0901 BR-13` | the headers' fixed ids and the rows' container ids, equal across two calls |
| `listedContainersOf` | a real `docker inspect` array (a recorded fixture under `test/fixtures/`), the zero time, null labels, non-JSON |

## 4. Gates, review and open rows

Run all gates, with the new files at 100 %. PR title: `remote-containers: C15's targets model, the Dev Containers
view as a pure tree (card containers-29, #962)`. Request athena only.

**Open rows (stop and report on #962):**
1. AC-48's order can't be produced by an `Intl.Collator` with fixed options.
2. A tooltip in BR-5 needs a word that has no rule in BR-5, 6.16 or 6.18.
3. `labels.ts` can't export the families without changing `decide`'s results. Paste the row that changes.
