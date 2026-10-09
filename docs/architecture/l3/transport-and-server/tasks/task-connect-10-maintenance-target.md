# Task card connect-10: the host named by a kill or uninstall command, and its two notices (pure)

Brief: slice 3 (#42). Specs: F-2411 (`remote-oss/remote-ssh#56`), F-2412 (`#57`). Reviewing coder:
`remote-coding-worker-1`. Depends on nothing; `packages/remote-ssh/src/maintenance/` has `host-picker.ts` under
another writer and no other file on main.

## 1. Package and file boundary

`packages/remote-ssh/src/maintenance/target.ts`, test `packages/remote-ssh/test/unit/maintenance-target.test.ts`. Neither exists
on main. Do not touch `host-picker.ts` or `src/report/`. Pure. Nothing else changes.

## 2. Contract

```ts
export function hostPartOf(target: string): string;
// the text after the LAST `@` (the whole text when there is none), then a trailing `:` followed only by digits removed
export function isOwnHost(target: string, windowHost: string | undefined): boolean;
// windowHost undefined: false; otherwise exact, case-sensitive equality of target and windowHost
export function killedNotice(host: string): string;     // `Killed VS Code Server on ${host}.`
export function killFailedNotice(host: string): string; // `Failed to kill VS Code Server on ${host}.`
```

`isOwnHost` compares the target text exactly as the user gave it with the window's authority host: it returns
`target === windowHost` and does not call `hostPartOf` (a different spelling of the same host is another host).

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2411.BR-6 | `hostPartOf('myhost')` | `myhost` |
| F-2411.BR-6 | `hostPartOf('lab@myhost')` | `myhost` |
| F-2411.BR-6 | `hostPartOf('lab@203.0.113.6:2222')` | `203.0.113.6` |
| F-2411.BR-6 | `hostPartOf('203.0.113.6:2222')` | `203.0.113.6` |
| F-2411.BR-6 | `hostPartOf('a@b@host')` | `host` (last `@`) |
| F-2411.BR-6 | `hostPartOf('host:abc')` | `host:abc` (not all digits, kept) |
| F-2411.BR-7 | `isOwnHost('devbox', 'devbox')` | true |
| F-2411.BR-7 | `isOwnHost('DEVBOX', 'devbox')`, `isOwnHost('lab@devbox', 'devbox')`, `isOwnHost('10.0.0.5', 'devbox')` | false each |
| F-2411.BR-7 | `isOwnHost('devbox', undefined)` | false |
| F-2411.AC-5 | `killedNotice('myhost')` | `Killed VS Code Server on myhost.` |
| F-2411.AC-13 | `killFailedNotice('myhost')` | `Failed to kill VS Code Server on myhost.` |
| F-2411.AC-11 | `killedNotice(hostPartOf('lab@myhost:2222'))` | `Killed VS Code Server on myhost.` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: maintenance target host and notices (card connect-10)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. IPv6 literals and `ssh://` forms in a typed target: not specified by F-2411 or F-2412; `hostPartOf` is not tested
   on them.
2. A target ending in `:` with no digits (`host:`): F-2204 BR-4 treats an empty port as no port, F-2411 is silent;
   not tested.
3. The strings above are the English text of STR:S085 and STR:S076; their localisation keys belong to the manifest
   card, not here.
