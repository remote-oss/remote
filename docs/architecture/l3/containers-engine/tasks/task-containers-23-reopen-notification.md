# Task card containers-23: F-0402, the reopen-in-container notification

Issue: #926. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`.

**Scope source:** the user moved F-0402 into release 1 on 2026-10-14. Their words are on #737 ("Reopen prompt: Yes"),
and the brief was amended at 82d30e9.

**Builds after:**
- containers-11 (#881): `onStartupFinished`, and `IntentMemento` through `timed-store.ts`;
- containers-13 (#883): `discoverConfigurations` and its `ConfigFiles` adapter;
- #918 (containers-09 part 2): `devContainerFolder`, `answerNotification` and `notificationButtons`.

Sources:
- F-0402 (remote-oss/remote-containers#17): 3.1, 3.4, 4 (PRE-2, PRE-3, PRE-5), 5.0, 6.1, 6.4, 7.E1 to 7.E3, BR-2 to BR-8
  (BR-3 is core's, §2.1),
  BR-10 and AC-1 to AC-5, AC-8, AC-9, AC-11 to AC-14;
- the brief (`brief-release-1.md`, the F-0402 item): the release-1 scope;
- R-27 (the keys are ours) and R-28 (no telemetry).

## 1. Release 1's scope

**In:**
- a **local** window (`vscode.env.remoteName === undefined`), on **one** folder of scheme `file`, not a `.code-workspace`;
- containers-13's discovery finds at least one configuration;
- the window is not suppressed (BR-6).

The window then shows S426 with S186 and the buttons S293 and S150, and S150's follow-up S151 with S035 and S101. The
reset command `remote-containers.showReopenInContainerNotificationReset` is in too, because without it "Any Folder" can't
be undone (6.4, BR-7).

**Out, and in the catalogue as `todo`:**
- the `.code-workspace` wording (6.2: S427, S405, S152, S036, S102; AC-6, AC-7);
- the repository-configuration and multi-root `{0}` (S368, 6.3, 6.5; AC-10, AC-15);
- remote windows that aren't containers (PRE-4's SSH case, BR-16; AC-16). athena's scope: "must not show in a
  remote window".

**`{0}` in release 1 is always S186.** BR-1 gives S368 only for a repository configuration or an untitled multi-root
workspace, and neither is in scope. A folder whose only configurations are in `.devcontainer/<sub>/` still gets S186.

**When the extension isn't serving, nothing is offered:**
- standing down for the other Dev Containers (F-0101);
- proposals missing, so Reopen can't connect: `served.missing` isn't empty.

## 2. The design

### 2.1 `src/open/reopen-notification.ts` (new), pure over its ports

```ts
/** Our keys in globalState and workspaceState (R-27); never synced. */
export const REOPEN_NOTIFICATION_KEY = 'remote-oss.remote-containers.reopenNotification';

/** What a window is, as far as the notification cares. */
export interface NotificationWindow {
  remote: boolean;
  workspaceFile: boolean;
  /** The workspace folders, in order. */
  folders: readonly {scheme: string; fsPath: string}[];
}

export interface ReopenNotificationPorts {
  window: NotificationWindow;
  global: IntentMemento;      // context.globalState
  workspace: IntentMemento;   // context.workspaceState
  hasConfiguration(folder: string): Promise<boolean>;
  show(message: string, buttons: readonly string[]): PromiseLike<string | undefined>;
  reopen(): PromiseLike<unknown>;
  now(): number;
  translate: Translate;
  logger: Logger;
}

/** Whether a stored global and workspace state suppress the notification (BR-6). */
export function isSuppressed(global: unknown, workspace: unknown): boolean;

/** Offers to reopen the window's folder in its container, once (5.0, 6.1). */
export async function offerReopen(ports: ReopenNotificationPorts): Promise<void>;

/** The reset command (6.4): a newer reset time, and nothing deleted (BR-7). */
export async function resetReopenNotification(global: IntentMemento, now: number): Promise<void>;
```

**The stored values**, one object per key (BR-5's shape, our key):
- global: `{suppressedAt?: number; resetAt?: number}`;
- workspace: `{suppressedAt?: number}`.

A stored value that isn't an object, or a field that isn't a finite number, counts as absent. A write keeps the
object's other fields: "Any Folder" doesn't drop `resetAt`, and the reset doesn't drop `suppressedAt`.

**`isSuppressed`:** `reset = global.resetAt ?? -Infinity`. The answer is `true` when `global.suppressedAt > reset` or
`workspace.suppressedAt > reset`, and an absent `suppressedAt` never suppresses. Equal times don't suppress: "newer
than", BR-6.

**`offerReopen`**, in order, returning at the first step that stops:
1. Stop when `window.remote`, `window.workspaceFile`, `folders.length !== 1`, or the folder's scheme isn't `file`.
2. Stop when `isSuppressed(global.get(KEY), workspace.get(KEY))`.
3. Stop when `!(await hasConfiguration(folder.fsPath))` (7.E1: nothing shown, nothing logged).
4. Show the message, `filled(translate, S426, [translate(S186), ''])`, with the buttons
   `[translate(S293), translate(S150)]`.
5. Act on the answer:
   - S293: `await reopen()`.
   - S150: show the follow-up `translate(S151)` with `[translate(S035), translate(S101)]`. On that answer:
     - S035: global `suppressedAt = now()`;
     - S101: workspace `suppressedAt = now()`;
     - `undefined`: nothing.
   - `undefined` (closed, or never answered): nothing (BR-8).

   Log one line at `info` for each of the outcomes S293, S035 and S101. The lines are `the reopen notification:
   reopen`, `the reopen notification: suppressed for any folder` and `the reopen notification: suppressed for this
   folder`. No telemetry (R-28, AC-14).

Steps 1 to 3 log nothing (BR-12: only the start lines).

**The lifetime (BR-3) is core's.** `showInformationMessage` gives a toast that core hides after its own timeout, about
10 s, and that stays in the notification centre. Nothing here sets a timer or closes it, and no row asserts the hiding.
A toast that core hides isn't an answer: the promise stays pending until the user acts in the centre or the window
closes, and nothing is stored (BR-8).

**Trust.** It is offered in Restricted Mode too (PRE-5, BR-10). Nothing here reads trust. S293 runs the command, and
containers-12's gate decides there.

### 2.2 The strings (`REOPEN_TEMPLATES` in `reopen-notification.ts`, and the l10n bundles)

| Id | English template |
|---|---|
| S426 | `{0} Reopen folder to develop in a container ([learn more](<CONTAINERS_INTRODUCTION>)).{1}` |
| S186 | `Folder contains a Dev Container configuration file.` |
| S293 | `Reopen in Container` |
| S150 | `Don't Show Again...` |
| S151 | `Don't show again for the current folder or for any folder?` |
| S035 | `Any Folder` |
| S101 | `Current Folder` |

Copy them verbatim from the spec's 3.4, with one exception: **S426's link target is ours** (R-31, athena on
#927). The text, "learn more" included, stays verbatim (R-29), and the target becomes our README's introduction:

```ts
/** The page S426's "learn more" opens: the extension's introduction. */
export const CONTAINERS_INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';
```

It sits beside containers-11's `CONTAINERS_DOCUMENTATION` and `CONTAINERS_REQUIREMENTS`, in the same module. The
template interpolates the constant (`` `…([learn more](${CONTAINERS_INTRODUCTION}))…` ``), so the address is written
once, and the bundles' key is the resulting English text. Never the aka.ms address.

The keys go into `l10n/bundle.l10n.json` and every locale bundle, as
containers-03 did. `check-string-tables` checks them. If another table already defines one of them, import it, and
don't define it twice (dupes).

### 2.3 The reset command

- **`package.json`:** the command `remote-containers.showReopenInContainerNotificationReset`, with title
  `%commands.Showreopenincontainernotificationreset.title%` = `Reset Don't Show Reopen Notification` and category
  `Dev Containers`, like `remote-containers.reopenInContainer`. It gets **no** `commandPalette` `when` entry (3.1: listed
  in every window kind).
- **The handler** goes into the handler table that `activation.ts` registers (`inputs.handlers(served)`), as
  `() => resetReopenNotification(context.globalState, Date.now())`. Use the id constant from `identifiers.generated.ts`.
- **Gate row 10's list** (#917 and #918: the exact set of registered commands) gains the id. Update its expectation in
  the same PR.

### 2.4 Wiring (`src/extension.ts`)

In the `serving` branch, once the handlers are registered, and only when `served.missing.length === 0`, call
`void offerReopen({...})` and don't await it, so activation isn't held. The ports:
- `window`: `remote: vscode.env.remoteName !== undefined`, `workspaceFile: vscode.workspace.workspaceFile !==
  undefined`, `folders` from `vscode.workspace.workspaceFolders ?? []` (`uri.scheme`, `uri.fsPath`);
- `hasConfiguration`: `folder => discoverConfigurations(folder, files, compare).then(found => found.length > 0)`, with
  containers-13's adapter and collator;
- `show`: `(message, buttons) => vscode.window.showInformationMessage(message, ...buttons)`;
- `reopen`: `() => vscode.commands.executeCommand(<the reopenInContainer id constant>)`;
- `global`, `workspace`: `context.globalState`, `context.workspaceState`.

Neither key is registered with `setKeysForSync` (R-27).

## 3. Files

| File | What |
|---|---|
| `src/open/reopen-notification.ts` | new: §2.1, §2.2 |
| `src/extension.ts`, `src/activation.ts`'s handler table | §2.3, §2.4 |
| `package.json`, `package.nls.json`, `l10n/bundle.l10n*.json` | the command, its title, the strings |
| `test/unit/reopen-notification.test.ts` | new: §4.1 |
| `test/unit/manifest.test.ts` | the command's contribution and its absent `when` |
| `tests/acceptance/containers/reopen-notification.test.ts` | new: §4.2 |
| `tests/acceptance/windows/harness.ts`, `tests/acceptance/containers/gate.test.ts` | move `openFolderWindow` from gate.test.ts into harness.ts (both files use it: dupes) |
| `tools/public-surface.ts`, `tools/public-surface.test.ts` | the aka.ms rule and its rows (§4.1) |
| `docs/architecture/catalogue/coverage-containers-r1.tsv` | §5 |

## 4. Rows

### 4.1 `reopen-notification.test.ts` (fake ports: recording mementos, a scripted `show`, a counting `reopen`)

| Name | Given | Expected |
|---|---|---|
| `F-0402 AC-1: a local folder with a configuration shows S426 with S186 and the two buttons` | defaults | one `show`: `Folder contains a Dev Container configuration file. Reopen folder to develop in a container ([learn more](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md)).` and `['Reopen in Container', "Don't Show Again..."]` |
| `F-0402 AC-2: Reopen in Container runs the reopen command and stores nothing` | `show` answers S293 | `reopen` once; both mementos unwritten |
| `F-0402 AC-3: Don't Show Again... shows the follow-up` | S150 | the second `show`: S151 with `['Any Folder', 'Current Folder']` |
| `F-0402 AC-4: Current Folder stores the time in the workspace state` | S150, then S101, `now` 1000 | workspace `{suppressedAt: 1000}`; global unwritten |
| `F-0402 AC-5: Any Folder stores the time in the global state and keeps the reset time` | global `{resetAt: 5}`, S150, S035, `now` 1000 | global `{resetAt: 5, suppressedAt: 1000}` |
| `F-0402 AC-12: a dismissed notification or follow-up stores nothing` | `undefined`; and S150 then `undefined` | no write in either |
| `F-0402 7.E2: a suppressed window shows nothing` | workspace `{suppressedAt: 10}`; and global `{suppressedAt: 10}` | no `show` |
| `F-0402 BR-6: a reset newer than the suppression shows it again` | global `{suppressedAt: 10, resetAt: 20}`, workspace `{suppressedAt: 15}` | one `show` |
| `F-0402 BR-6: a suppression after the reset suppresses again` | global `{resetAt: 20}`, workspace `{suppressedAt: 30}` | no `show` |
| `F-0402 BR-6: equal times don't suppress` | global `{suppressedAt: 20, resetAt: 20}` | one `show` |
| `F-0402 BR-6: malformed state counts as absent` | global `'x'`; workspace `{suppressedAt: 'soon'}`; global `{suppressedAt: NaN}` | one `show` each |
| `F-0402 7.E1: a folder without a configuration shows nothing` | `hasConfiguration` false | no `show`, no log line |
| `F-0402 AC-13: a remote window shows nothing` | `remote: true` | no `show`; `hasConfiguration` not called |
| `brief: a .code-workspace, two folders, no folder, or a non-file folder show nothing` | each | no `show` |
| `F-0402 AC-11: trust isn't read` | the ports have no trust | one `show` (the row documents PRE-5; the module has no trust port) |
| `F-0402 AC-8: the reset writes a newer reset time and deletes nothing` | global `{suppressedAt: 10}`, `now` 50 | global `{suppressedAt: 10, resetAt: 50}` |
| `F-0402 AC-8: a reset over a malformed value starts a fresh object` | global `7` | `{resetAt: 50}` |
| `F-0402 AC-14: each chosen outcome logs one line, and nothing else logs` | S293; S035; S101; a dismissal | the three lines of §2.1, and none for the dismissal |

`manifest.test.ts`: `F-0402 3.1: the reset command is contributed under Dev Containers with no when`.

**`tools/public-surface.ts`: no aka.ms address ships** (R-31, athena on #927). Today the check reads the shipped
files for process wording only. It gains a second rule over the same files: an `https://aka.ms/` address anywhere in
them fails, naming the file and the address. The licence hosts' allow-list (lib-product's `serverLicenseUrl` hosts,
when one ships in a string table) is the only exception, and today it's empty. Its rows, in `tools/public-surface.test.ts`:

| Name | Expected |
|---|---|
| `R-31: an aka.ms address in a localisation bundle fails, naming the file and the address` | a fixture `l10n/bundle.l10n.json` holding `https://aka.ms/x`: one problem line with both |
| `R-31: an aka.ms address in package.nls fails too` | the same for `package.nls.json` |
| `R-31: an address of our own passes` | `https://github.com/remote-oss/remote/...`: no problem |
| `R-31: the repository's shipped files hold no aka.ms address` | the real run over the repository: no problem |

### 4.2 Acceptance (`tests/acceptance/containers/reopen-notification.test.ts`, the containers launch)

Each row opens its own `devContainerFolder` (§2.1 of containers-09) with `openFolderWindow`, so the rows don't share
storage ids.

| # | Steps | Assertions |
|---|---|---|
| N1 | `devContainerFolder('notice-shown', {name: 'Notice'})`, open it | within 10 s of the agent's activation, a toast with exactly `Folder contains a Dev Container configuration file. Reopen folder to develop in a container (learn more).`, its "learn more" anchor's `href` our README's address, and `notificationButtons` `['Reopen in Container', "Don't Show Again..."]` (AC-1) |
| N2 | In N1's window, `answerNotification('Reopen in Container')` | the same window reaches `remoteName` `dev-container` with its folder under `/workspaces/notice-shown` (AC-2). Close it |
| N3 | Open `notice-current` and answer `Don't Show Again...` | the toast is now exactly `Don't show again for the current folder or for any folder?` with buttons `['Any Folder', 'Current Folder']` (AC-3) |
| N4 | Answer `Current Folder`, close the window, and open `notice-current` again; then open `notice-other` | `notice-current` shows no reopen toast within 10 s, and `notice-other` shows it (AC-4) |
| N5 | Open a folder with no `.devcontainer` (`notice-none`, a plain folder under the run folder) | no reopen toast within 10 s (AC-9) |
| N6, last | Open `notice-any`, answer `Don't Show Again...` then `Any Folder`, and open `notice-other2`. Then run `remote-containers.showReopenInContainerNotificationReset` in that window and open `notice-other2` again | no toast for `notice-other2` the first time, and the toast the second time (AC-5, AC-8's local half). The reset runs in the row's `finally` as well, so the later launches start unsuppressed |

**Rows of other cards that read a local window's notifications** on a folder with a configuration now see this
notification. Run the whole containers launch. Where a row's expectation is an empty list of a local window's
notifications, add the reopen notification to the expectation: it's the specified behavior. Never suppress it to keep
a row green.

## 5. Catalogue

- `acceptance`: AC-1, AC-2, AC-3, AC-4, AC-5, AC-9, and AC-8 (local window).
- `unit`: AC-11, AC-12, AC-13 (the notification half), AC-14.
- `todo`, with the reason "out of release 1 (brief, 82d30e9)": AC-6, AC-7, AC-10, AC-15, AC-16, and AC-8's
  container-window and SSH-window halves.

## 6. Gates and review

Run all gates, the containers launch locally (`docker ps` first), and the VSCodium run. The PR title is
`remote-containers: F-0402, the reopen-in-container notification and its reset (card containers-23, #926)`. Request
athena only; hermes assigns the peer.

## 7. Open rows (stop and report on #926)

1. **The toast doesn't render the Markdown link** as "learn more" (that is, N1 sees the brackets). Report the
   renderer's text. Don't change the template, since it's verbatim (D-14).
2. **The notification appears before containers-11's `onStartupFinished` activation** has finished registering the
   handlers, and S293 then finds no command. Report the order you see. Don't add a delay.
