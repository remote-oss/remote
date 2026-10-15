# Task card containers-36: no reload while `resolvers` or `workspaceTrust` is missing

Issue: #976 (release blocker). Milestone 0.4. Size: S. Builder: `task:claude`.

**Design:** athena's ruling on #976 (comment 6181772918); brief ruling 9; F-0101 (remote-oss/remote-containers#19,
the gate) BR-9 point 2 (a), (b), (c) and (d), AC-15.

## 1. The defect

Without the proposed API, the commands stay registered, as ruling 9 says, but nothing holds back the open path.
Reopen in Container reloads the user's window into a `dev-container` window that nothing can resolve, and core shows
"No remote extension installed to resolve". The user loses the window they were in.

## 2. The change (C6, `packages/remote-containers/src/open/`)

### 2.1 The guard (`open-gate.ts`, new)

```ts
/** The proposals without which a window on a container authority can't open (brief ruling 9). */
export const OPEN_PATH_PROPOSALS: readonly string[] = ['resolvers', 'workspaceTrust'];
export interface OpenGatePorts {
  /** `served.missing`: what the activation's probe found missing. */
  missing: readonly string[];
  /** `served.setupAgain`: probes again and shows the warning within BR-9 (c)'s cap. */
  setupAgain(): Promise<{decision: {missing: readonly string[]}; interaction: Promise<unknown>}>;
  logger: Logger;
}
/**
 * Whether a command that ends in a container window may go on: yes when `missing` holds none of
 * OPEN_PATH_PROPOSALS; otherwise it runs setupAgain once, and goes on only if the new probe finds them all.
 */
export async function openPathAllowed(ports: OpenGatePorts, command: string): Promise<boolean>;
```

- **Nothing of `OPEN_PATH_PROPOSALS` missing:** `true`, and `setupAgain` isn't called. A missing `contribViewsRemote`
  holds back only the views (#960), and nothing else holds back anything.
- **One missing:** `await setupAgain()` once (BR-9 point 2 (a)). Read only its `decision`, which is the new probe's
  (athena, #981). **Never await its `interaction`:** that settles only when the user answers the notice. Then:
  - the new decision still lacks one: log one info line, `<command> needs the proposed API: <the missing ones, comma
    separated>; the window stays as it is`, and return `false`;
  - the new decision lacks none: return `true` (in practice a grant needs a restart, so this branch is for
    correctness).
- **BR-9 (c)'s cap is unchanged.** A window whose activation already showed the warning shows nothing new on a second
  Reopen. The window stays local, and the log says why (athena, #976).

### 2.2 Where it's called

First, before anything else the command does: before the context check, the trust gate, the engine check and the
CLI read.
- **Reopen in Container** (`reopen.ts`): `attempt()` starts with `if (!(await openPathAllowed(ports.gate,
  'Reopen in Container'))) return;`. `ReopenPorts` gains `gate: OpenGatePorts`, which `extension.ts` wires from
  `served.missing`, `served.setupAgain` and `served.logger`.
- **Commands not yet built** call it the same way when they're built: Open Folder in Container (containers-17, #936),
  the rebuild commands run from a local window (containers-14 part 2, #884), and slice B's Open in Container actions.
  This card adds a note to #936 and #884. Their builders follow it, and their reviewers check it.

## 3. Rows

### 3.1 Unit

- `open-gate.test.ts`:
  - `F-0101 BR-9: a missing resolvers probes again once and holds back the open path`: `setupAgain` called once,
    `false`, and the info line;
  - the same for `workspaceTrust`;
  - nothing missing: `true`, no `setupAgain`;
  - only `contribViewsRemote` missing: `true`, no `setupAgain`;
  - missing at activation, granted by the new probe: `true`;
  - `setupAgain`'s `interaction` never settles (a promise that's never resolved): the guard still returns `false`
    (athena, #981).
- `reopen.test.ts`: `F-0101 BR-9, AC-15: without resolvers, Reopen calls nothing but setupAgain`. None of the window's
  folders or trust, the engine's first check, the bridge, the opener or the progress is called, and nothing reloads.
  The same for `workspaceTrust`. With nothing missing, the existing rows pass unchanged.

### 3.2 Acceptance (`tests/acceptance/containers-no-proposals/gate.test.ts`, gate row 10's launch)

| # | Rows |
|---|---|
| BR-9 2 (d), AC-15 | after the file's existing rows, `devContainerFolder('c36-no-proposals')` and `openFolderWindow` (both from `windows/`). Record `activations(name)` and `windowTitle(name)`, then run `inWindow(name, 'remote-containers.reopenInContainer')` and wait 10 s. `activations(name)` is unchanged, `windowState(name).remoteName` is `null`, the title is unchanged, and `notificationCentre(name)` holds nothing that starts with `No remote extension installed to resolve`. `devContainersOf` is `[]`. Close the window |

## 4. Gates and review

Run all gates with the changed files at 100 %, and the containers launches. PR title: `remote-containers: no reload
while resolvers or workspaceTrust is missing (card containers-36, #976)`. Request athena only.

`setupAgain()`'s `decision.missing` is the new probe's: `runSetup` probes on every call, and `decide()` puts `missing`
on every kind (athena, #981).
