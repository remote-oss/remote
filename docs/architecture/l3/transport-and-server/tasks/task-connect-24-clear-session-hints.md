# Task card connect-24: Clear previous session metadata, registered (F-2605 6.6)

> **Built by #541 (merged).** main has `HINT_STORE_KEY = 'remote.ssh.hints'` in `hint-store.ts` and
> `clear-hints-command.ts`. This card stays as the record of what was asked; don't build it again.

Issue: #533. Why: the user put `opensshremotes.clearAllSessionHints` into 0.2 (hermes, 2026-10-13). F-2605
(`remote-oss/remote-ssh#72`, still `spec:draft`) §6.6 says what it does. The hint store's pure model exists
(`diagnostics/hint-store.ts`), but nothing persists or records hints yet: the recording is the rest of F-2605, which
isn't in this card. Builder: selene. Size: S.

## 1. The command (F-2605 6.6)

- **The key.** `src/diagnostics/hint-store.ts` gains `export const HINT_STORE_KEY = 'remote.ssh.hints'`: the
  global-state key the future recorder writes, kept in one place. It's the sub-key F-2605 BR-8 records as reference
  data, reused under D-14; our global state is keyed by our own extension id, so nothing collides (athena on #535).
- **The handler** (`src/diagnostics/clear-hints-command.ts`), taking a `{update(key: string, value: undefined):
  PromiseLike<void>}` port and the logger. It runs `update(HINT_STORE_KEY, undefined)`, then logs `Cleared all session
  hints`. It shows nothing: no notification, dialog, pick or progress (6.6 step 2). It touches no other key (step 3).
  On an empty store it behaves the same (step 6).
- **Registration** in `register-connect.ts` as connect-21's commands are, over `context.globalState`.

## 2. Rows (unit, one assertion each)

| Cite | Given | Expected |
|---|---|---|
| F-2605 6.6 step 3 | the handler over a recording port | `update` ran once, with `('remote.ssh.hints', undefined)` |
| F-2605 6.6 step 4 | the same | the log has `Cleared all session hints` |
| F-2605 6.6 step 2 | the same, with recording editor surfaces | no notification, dialog, pick or progress was shown |
| F-2605 6.6 step 6 | an empty store | the same `update`, and no error |

Name each row by F-2605's AC for the case when one states it (check the spec's AC list); otherwise as above.

## 3. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `remote-ssh: Clear previous session metadata,
registered (card connect-24)`. themis or triton.
