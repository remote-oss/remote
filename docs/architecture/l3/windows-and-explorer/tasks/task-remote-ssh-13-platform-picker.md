# Task card remote-ssh-13: the platform picker (F-2206)

Why: when the shared connection is off and no setting names the host's platform, the connect asks the user before
any `ssh` process starts (F-2206 5.2 step 2, AC-2). `createTermsSteps` takes a `pickPlatform` dependency, and nothing
implements it. The connect's wiring (card connect-14, E6c) waits for this card. Owner: B's `ssh.connect-flows`
(windows-and-explorer contracts §3.2, `pickRemotePlatform`). Design check: athena, on connect-14 (#253).
Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/connect/platform-picker.ts` | new: the model and `pickRemotePlatform` |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | one key, the placeholder (section 2) |
| `packages/remote-ssh/test/unit/platform-picker.test.ts` | new |

Nothing else. No `vscode` import: the editor is behind the port of section 2. The wiring (E6c) gives the real port and
adapts the result to `createTermsSteps`.

## 2. Contract

```ts
import type {StringRef} from './picker-model.ts';
import type {RemotePlatform} from '../pipeline/platform.ts';

/** The picker as the editor shows it: a placeholder, labels in order, the first focused. */
export interface PlatformPick {
  placeholder: StringRef;
  items: ReadonlyArray<{label: string; platform: RemotePlatform}>;
}

/** The pick for a host: the placeholder with the host name, and Linux, Windows, macOS in that order. */
export function platformPickOf(hostName: string): PlatformPick;

/** What the picker needs of the editor. */
export interface PlatformPickPort {
  /**
   * Shows the pick, single selection, no title, the first item focused, closing when the user looks away or
   * `cancellation` ends. Gives the chosen platform, or undefined when it closed without one.
   */
  pick(pick: PlatformPick, cancellation: AbortSignal): Promise<RemotePlatform | undefined>;
}

/** Asks for the host's platform; `cancelled` when the user closed the pick or the connect was cancelled. */
export function pickRemotePlatform(
  port: PlatformPickPort,
  hostName: string,
  cancellation: AbortSignal,
): Promise<RemotePlatform | 'cancelled'>;
```

- `platformPickOf(hostName)`: `placeholder` is `{id: 'platformPickPlaceholder', values: [hostName]}`, and `items` is
  `[{label: 'Linux', platform: 'linux'}, {label: 'Windows', platform: 'windows'}, {label: 'macOS', platform: 'macOS'}]`.
  The labels are names and are not translated (athena, connect-14). The placeholder has no STR id in F-2206, so it is
  our own string-table entry: the named id `platformPickPlaceholder`, whose template is
  `Select the platform of the remote host "{0}"`, a key in all 15 bundles (the #141 brief's ruling 2).
- `pickRemotePlatform`: a `cancellation` already ended gives `cancelled` without showing anything. Otherwise it shows
  `platformPickOf(hostName)` and gives the chosen platform, or `cancelled` when the port gives undefined. It writes
  nothing and decides nothing else (contracts §3.2: when to ask and whether to store are R4's).
- No time limit (F-2206 5.2 step 2: "waits without a time limit").

## 3. Test table

One assertion per `it`; the cite starts the name. The port is a fake that records what it showed and answers a script.

| Cite | Given | Expected |
|---|---|---|
| F-2206 AC-2 | `platformPickOf('box')` | placeholder `{id: 'platformPickPlaceholder', values: ['box']}` |
| F-2206 AC-2 | `platformPickOf('box').items` | labels `Linux`, `Windows`, `macOS` in that order, platforms `linux`, `windows`, `macOS` |
| F-2206 5.2 step 3 | the port answers `linux` / `windows` / `macOS` | the same platform (one `it` each) |
| F-2206 AC-9 | the port answers undefined (Escape, focus lost) | `cancelled` |
| F-2206 7.E1 | the connect's signal already aborted | `cancelled`, and the port showed nothing |
| contracts §3.2 | the port is given the connect's signal | the signal the port received is the one passed in |
| string tables | the bundles | `pnpm check-layout` green: the placeholder key in all 15 |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the platform picker (card remote-ssh-13, F-2206)`.

## 6. Open rows

None.
