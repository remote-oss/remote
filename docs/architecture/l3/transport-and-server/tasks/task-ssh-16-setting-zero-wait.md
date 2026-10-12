# Task card ssh-16: the setting's 0 waits 2 s, a host's 0 waits the ceiling

Why: athena's ruling on #253 Q8 (2026-10-12). F-2105 BR-4 and AC-9: with `remote.SSH.connectTimeout` 0 and no per-host
value, ssh gets `ConnectTimeout=0` and the extension's own wait is 0 + 2 s, so `Connecting with SSH timed out.` shows
after about 2 s. A host's `ConnectTimeout 0` instead gives ssh no limit and the extension the R-79 ceiling
(`unboundedWaitSeconds`, 600 s from remote-ssh's bounds). Today `ConnectWait` takes the ceiling for any 0, because
the helper passes `Number(effective.connectTimeout ?? settings.connectTimeout)` and the source is lost: the setting's
0 waits 600 s and AC-9 fails. Implementer: a local coder. Reviewing coder: `themis`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/process/connect-wait.ts` | `ConnectWaitSettings` gains `fromHost: boolean` (section 2) |
| `packages/lib-ssh/src/connection-server/helper.ts` | passes `fromHost: request.effective.connectTimeout !== undefined` |
| `packages/lib-ssh/test/unit/connect-wait.test.ts` | the rows of section 3 |
| any other construction of `ConnectWaitSettings` in `packages/lib-ssh/src` (terminal mode) | the same `fromHost` from the same source |

Nothing else.

## 2. Contract

```ts
export interface ConnectWaitSettings {
  /** The connect timeout in seconds; 0 means the client sets no limit of its own. */
  connectTimeoutSeconds: number;
  /** Whether the timeout is the host's own `ConnectTimeout` (from `ssh -G`) rather than the setting. */
  fromHost: boolean;
  /** The whole wait for a host's `ConnectTimeout 0`, in seconds: the R-79 bound, with no margin added. */
  unboundedWaitSeconds: number;
}
```

The wait is `unboundedWaitSeconds` when `fromHost` and `connectTimeoutSeconds` is 0; otherwise
`connectTimeoutSeconds` seconds plus the 2 s margin, which for the setting's 0 is 2 s (F-2105 BR-4).

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Settings | Wait |
|---|---|---|
| F-2105 BR-4, AC-9 | `{connectTimeoutSeconds: 0, fromHost: false, unboundedWaitSeconds: 600}` | 2 000 ms |
| F-2105 BR-4, AC-8 | `{connectTimeoutSeconds: 0, fromHost: true, unboundedWaitSeconds: 600}` | 600 000 ms |
| F-2105 BR-3 | `{connectTimeoutSeconds: 15, fromHost: false, unboundedWaitSeconds: 600}` | 17 000 ms |
| F-2105 BR-1 | `{connectTimeoutSeconds: 3, fromHost: true, unboundedWaitSeconds: 600}` | 5 000 ms |
| F-2105 BR-4 | the helper with no looked-up timeout and the setting 0 | its wait is 2 000 ms |

The existing rows (pause on a prompt, restart after an answer, stop at the first setup report) stay and pass.

## 4. Gates and review

PR title `lib-ssh: the setting's 0 waits 2 s, a host's 0 the ceiling (card ssh-16, F-2105 AC-9)`; Part of #140.
