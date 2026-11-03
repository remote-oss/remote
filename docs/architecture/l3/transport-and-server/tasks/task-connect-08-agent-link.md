# Task card connect-08: the agent link plan of an SSH window (pure)

Brief: slice 2 (#41), contracts V7 "Remote environment". Spec: F-2311 (`remote-oss/remote-ssh#44`). Reviewing coder:
`remote-coding-worker-1`. Depends on nothing; `packages/remote-ssh/src/environment/` does not exist on main.

## 1. Package and file boundary

`packages/remote-ssh/src/environment/agent-link.ts`, test `packages/remote-ssh/test/unit/agent-link.test.ts`. Neither exists on main.
Pure: no `vscode`, no process, no file system, no random source (the draw is a parameter). Nothing else changes.

## 2. Contract

```ts
export interface AgentLinkInput {
  settingEnabled: boolean;                 // remote.SSH.enableAgentForwarding
  forwardedSocket: string;                 // SSH_AUTH_SOCK as the session reports it; '' when none was forwarded
  newConnection: boolean;                  // false: the connection is reused and `stored` decides
  stored: AgentLinkPlan | undefined;       // the plan the connection's first window stored
  windowLink: string | undefined;          // the link this window already made (kept across reconnection)
  takenNames: ReadonlySet<string>;         // link paths in /tmp the window did not create
  draw: () => number;                      // an integer in 1..999999999
}
export type AgentLinkPlan =
  | { kind: 'none'; reason: 'settingOff' | 'noForwardedSocket' }
  | { kind: 'link'; linkPath: string; target: string };
export function planAgentLink(input: AgentLinkInput): AgentLinkPlan;
export function linkPathFor(draw: () => number, takenNames: ReadonlySet<string>): string;
// `/tmp/vscode-ssh-auth-sock-${draw()}`; draws again while the path is in takenNames, at most 16 times, then returns the last drawn path (ruled 2026-10-10, #247: no unbounded loop; a collision that survives 16 draws is caught by the link creation on the host, F-2311 5.0 step 6)
export function terminalEnvironment(plan: AgentLinkPlan): Record<string, string>;
// link: { SSH_AUTH_SOCK: linkPath }; none: {}
```

Order in `planAgentLink`:
- `newConnection` false with a stored `none` plan returns `stored` unchanged.
- `newConnection` false with a stored `link` plan returns `link` with the stored `target` and `linkPath` =
  `windowLink` when present, else `linkPathFor(draw, takenNames)`.
- `settingEnabled` false returns `none`/`settingOff`.
- Empty `forwardedSocket` returns `none`/`noForwardedSocket`.
- Otherwise it returns `link` with `target` = `forwardedSocket` and `linkPath` = `windowLink` when present, else
  `linkPathFor(draw, takenNames)`.

Amended 2026-11-03 (proteus and athena, #1686, register a262f68). V7 names the link "per window session". A reload or
a new window on the same host is a new window session: it has no `windowLink`, so it draws a new name for the stored
target, and the old link stays (F-2311 6.7 steps 2 and 4, AC-15, AC-18 (b), AC-26). A reconnect keeps the window's
session and its `windowLink` (6.5 step 2). The stored decision still decides (BR-1): a stored `link` links whatever the
setting says now, and a stored `none` stays `none`. The pipeline reads `takenNames` whenever the plan can be a link,
which includes a stored `link` plan with the setting now off.

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2311.BR-2 | setting off, socket `/tmp/ssh-a/agent.1` | `none`, `settingOff` |
| F-2311.BR-2 | setting on, socket `''` | `none`, `noForwardedSocket` |
| F-2311.BR-2 | setting off and socket `''` | `none`, `settingOff` |
| F-2311.AC-12 | setting on, socket `''` (server refused forwarding) | `none`; `terminalEnvironment` is `{}` |
| F-2311.BR-3 | setting on, socket `/tmp/ssh-a/agent.1`, draw 920370833 | `link`, linkPath `/tmp/vscode-ssh-auth-sock-920370833`, target the socket |
| F-2311.BR-3 | draw 33844213 | linkPath ends `-33844213` (no zero padding) |
| F-2311.BR-3 | takenNames holds the path of draw 5; draw returns 5 then 6 | `/tmp/vscode-ssh-auth-sock-6`; draw called twice |
| F-2311.BR-3 | windowLink `/tmp/vscode-ssh-auth-sock-77`, new socket `/run/u/agent.2`, draw would give 9 | linkPath unchanged `...-77`, target `/run/u/agent.2`; draw not called |
| F-2311.BR-4 | any link plan, `TMPDIR` set in the caller's world | linkPath starts `/tmp/vscode-ssh-auth-sock-` (no input can change the folder) |
| F-2311.BR-6 | two windows, same socket, draws 11 and 12 | two plans: different linkPath, same target |
| F-2311.BR-1, 6.7 | newConnection false, stored `link` to `/run/u/agent.1` at `...-77`, no windowLink, setting now off, draw 9 | `link`, linkPath `...-9`, target `/run/u/agent.1` (a reload: a new name for the stored target) |
| F-2311.AC-15 | newConnection false, stored `link` at `...-77`, no windowLink, takenNames holds `...-77`, draw returns 77 then 12 | linkPath `...-12`, target the stored one (a second window: its own name) |
| F-2311.6.5 | newConnection false, stored `link` at `...-77`, windowLink `...-77`, draw would give 9 | linkPath `...-77`, target the stored one; draw not called (a reconnect keeps the name) |
| F-2311.BR-1 | newConnection false, stored `none`/`settingOff`, setting now on, socket present | the stored plan, `none`/`settingOff`; draw not called |
| F-2311.BR-1 | newConnection false, stored undefined, setting on, socket present | a fresh `link` plan (nothing stored to reuse) |
| F-2311.BR-10 | `terminalEnvironment` of a `link` plan | `{SSH_AUTH_SOCK: <linkPath>}` and no other key |
| F-2311.BR-11 | `terminalEnvironment` of a `none` plan | `{}` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: agent link plan (card connect-08)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. Ruled 2026-10-10 (#247): at most 16 redraws, then the last drawn path is returned; one row: a `draw` that always
   returns a taken number is called 17 times and the function returns that path.
2. Ruled 2026-10-10 (#247): the function trusts its argument; the pipeline's `draw` is the family's own generator,
   specified as an integer in 1..999999999, so no check and no row.
3. The command text that creates the link on the host (F-2311 5.0 step 6) is not in this card.
