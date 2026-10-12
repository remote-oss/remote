# Task card authority-07: the progress's "(details)" link is decided by phase

Why: athena's ruling in contracts §3.2 (0e4c911, #379). The connect's progress puts "(details)" in front of whichever
stage comes **first** (`vscode-resolver.ts`: `phaseMessage(text, first, …)`). With connect-21 (#379) a window that
waits for another one shows S157 first, so S157 would get the link (F-2102 5.2 step 3 forbids it) and its later
`initializing` would get none (F-2102 5.3 step 4 shows it). **Ruled:** the link goes with `initializing` (STR:S082,
F-2304 3.4) and, in terminal mode, with `settingUpTunnel` (F-2308 6.1 step 4, 6.2 step 1); never with any other stage,
whatever its position. The connector's phases carry a `details` flag; the host's progress renders the link on every
stage that has it. **Merges before #379** (hermes holds #379 for it). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-authority/src/resolver/host.ts` | `ConnectPhase.details`; `ProgressPort`'s `update` takes the flag; the host passes it (section 2.1) |
| `packages/lib-authority/src/resolver/vscode-resolver.ts` | the link from the flag, not the position (section 2.2) |
| `packages/lib-authority/src/testing/recording-resolver-editor.ts` | records the flag (section 2.3) |
| `packages/remote-ssh/src/pipeline/connector.ts` | sets the flag (section 2.4) |
| `packages/lib-authority/test/unit/resolver-host.test.ts` | the fake progress records the flag; rows (section 3) |
| `packages/lib-authority/test/unit/resolver-vscode.test.ts` | the "first stage only" row is replaced; rows (section 3) |
| `packages/lib-authority/test/unit/recording-resolver-editor.test.ts` | `update('stage')` becomes `update('stage', false)`; one row |
| `packages/remote-ssh/test/unit/connector.test.ts` | `connectorFor` passes `terminalMode`; rows (section 3) |

Nothing else. `phaseMessage` and its tests are unchanged.

## 2. Contract

### 2.1 lib-authority `host.ts`

```ts
/** A stage the connector reports, with the share downloaded for `serverDownloadPercent`. */
export interface ConnectPhase {
  name: PhaseName;
  percent?: number;
  /** Whether the progress shows the "(details)" link in front of this stage's text. */
  details?: boolean;
}

/** Progress the user sees while a connect runs. */
export interface ProgressPort {
  withProgress<Result>(
    request: ProgressRequest,
    task: (update: (title: string, details: boolean) => void) => Promise<Result>,
  ): Promise<Result>;
}
```

In `registerResolver`'s connect, the phase listener becomes `update(options.titleOf(phase, decoded), phase.details ===
true)`. Nothing else in the host changes.

### 2.2 `vscode-resolver.ts`

`progressOf`'s task callback becomes `(text, details) => progress.report({message: phaseMessage(text, details,
options.detailsCommand)})`. The `first` variable and its assignment go.

### 2.3 `recording-resolver-editor.ts`

The fake progress's update records `phase <text>` as today, and `phase <text> (details)` when `details` is true. Its
JSDoc's list of records gains `phase <text> (details)`.

### 2.4 remote-ssh `connector.ts`

```ts
export interface ConnectorDependencies {
  // ...as today, plus:
  /** Whether a connect runs in terminal mode (each window its own ssh); read once when the connect starts. */
  terminalMode: () => boolean;
}
```

`connect` reads `dependencies.terminalMode()` once, before `connect(...)` runs, and `phaseOf(event, terminalMode)` sets
`details: true` on `initializing` always, and on `settingUpTunnel` when `terminalMode` is true; on no other phase is
`details` present (the property is absent, not `false`). The percentage phase keeps `{name, percent}` as today.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | File | Given | Expected |
|---|---|---|---|
| contracts §3.2 (0e4c911) | `resolver-host.test.ts` | the connector reports `[{name: 'installing'}, {name: 'initializing', details: true}]` | the progress's updates are `['phase installing', 'phase initializing (details)']` (the fake records `(details)` the same way as 2.3) |
| F-2304 | `resolver-host.test.ts` | the existing row (`initializing`, `installing`, no flags) | unchanged: `['phase initializing', 'phase installing']` |
| contracts §3.2 | `resolver-vscode.test.ts` | `update('Waiting', false)`, then `update('Initializing VS Code Server', true)`, then `update('Downloading VS Code Server', false)` | messages: `Waiting`, then `([details](command:<DETAILS>)) Initializing VS Code Server`, then `Downloading VS Code Server` (replaces the "first stage only" row) |
| F-2308 6.2 | `resolver-vscode.test.ts` | `update('Initializing VS Code Server', true)`, then `update('Setting up SSH tunnel', true)` | both messages have the link |
| contracts §3.2 | `recording-resolver-editor.test.ts` | `update('stage', true)` | the record `phase stage (details)` |
| F-2304 3.4 | `connector.test.ts` | the existing "stages reach the listeners" row, shared mode | `[{name: 'initializing', details: true}, {name: 'downloading'}]` |
| F-2304 3.4 | `connector.test.ts` | a shared-mode connect that reaches the tunnel | the `settingUpTunnel` phase heard is `{name: 'settingUpTunnel'}`, with no `details` |
| F-2308 6.1 step 4 | `connector.test.ts` | the same connect with `terminalMode: () => true` | `{name: 'settingUpTunnel', details: true}` |
| F-2304 | `connector.test.ts` | the existing percentage row | unchanged: `{name: 'serverDownloadPercent', percent: 40}` |
| contracts §3.2 | `connector.test.ts` | `terminalMode` that answers `true` on its first call and `false` after | it was called once per connect, and the tunnel phase has `details: true` |

After this card merges, #379 rebases and adds one row to its own tests: the `waitingForOtherWindow` phase the
connector reports has no `details` (F-2102 5.2 step 3).

## 4. Rule for the worker

As card log-01; coverage at lib-authority's and remote-ssh's 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-authority, remote-ssh: the details link is decided by phase (card authority-07)`.

## 6. Open rows

None. Ruled by athena (contracts §3.2, 0e4c911).
