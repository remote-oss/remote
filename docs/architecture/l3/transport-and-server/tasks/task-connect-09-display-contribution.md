# Task card connect-09: the forwarded display of an SSH window (pure)

Brief: slice 2 (#41), contracts V7 "Remote environment". Spec: F-2312 (`remote-oss/remote-ssh#45`). Reviewing coder:
`remote-coding-worker-1`. Depends on nothing; `packages/remote-ssh/src/environment/` does not exist on main.

## 1. Package and file boundary

`packages/remote-ssh/src/environment/display.ts`, test `packages/remote-ssh/test/unit/display.test.ts`. Neither exists on main.
Pure: no `vscode`, no process, no file system. Nothing else changes.

## 2. Contract

```ts
export interface DisplayInput {
  settingEnabled: boolean;              // remote.SSH.enableX11Forwarding
  sessionDisplay: string;               // DISPLAY exactly as the SSH session on the host reports it; '' when none
  newConnection: boolean;               // false: the connection is reused and `stored` decides
  stored: DisplayPlan | undefined;
}
export type DisplayPlan =
  | { kind: 'none'; reason: 'settingOff' | 'noSessionDisplay' }
  | { kind: 'display'; value: string };
export function planDisplay(input: DisplayInput): DisplayPlan;
// newConnection false with a stored plan: that plan. Else setting off: none/settingOff. Else sessionDisplay '': none/noSessionDisplay. Else display with value = sessionDisplay unchanged.
export function terminalEnvironment(plan: DisplayPlan): Record<string, string>;
// display: { DISPLAY: value }; none: {}
export function mergedDisplay(inherited: string | undefined, plan: DisplayPlan): string | undefined;
// display: the plan's value; none: inherited, unchanged
```

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2312.BR-2 | setting off, session display `localhost:10.0` | `none`, `settingOff` |
| F-2312.BR-2 | setting on, session display `''` | `none`, `noSessionDisplay` |
| F-2312.AC-25 | setting on, session display `''`, new connection | `none`; `terminalEnvironment` is `{}` |
| F-2312.BR-3 | setting on, session display `localhost:11.0` | `display`, value `localhost:11.0` |
| F-2312.BR-3 | session display `unix:/run/user/1/x11` | `display`, value exactly that text (no parsing, no `.0` added) |
| F-2312.BR-1 | newConnection false, stored `display` `localhost:10.0`, setting now off | the stored plan |
| F-2312.AC-31 | newConnection false, stored `none`/`settingOff`, setting now on, session display present | the stored `none` plan |
| F-2312.BR-1 | newConnection false, stored undefined, setting on, display present | a fresh `display` plan |
| F-2312.BR-11 | newConnection true, stored `display` `localhost:10.0`, session display `localhost:12.0` | `display` `localhost:12.0` (the newest counts) |
| F-2312.BR-5 | `terminalEnvironment` of a `display` plan | exactly one key, `DISPLAY` (no `XAUTHORITY`) |
| F-2312.BR-2 | `terminalEnvironment` of a `none` plan | `{}` |
| F-2312.BR-4 | `mergedDisplay('localhost:10.0', display plan 'localhost:12.0')` | `localhost:12.0` |
| F-2312.AC-21 | `mergedDisplay('localhost:10.0', none plan)` | `localhost:10.0` (the stale inherited value stays) |
| F-2312.AC-8 | `mergedDisplay(undefined, none plan)` | `undefined` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: forwarded display plan (card connect-09)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. Which events count as a "new connection" (F-2312 BR-10): the caller decides; this card takes the boolean.
2. A display value that is not a string of printable characters: F-2312 BR-3 passes whatever sshd sets; the function
   does not check it.
