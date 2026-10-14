# Task card connect-50: the extension's own wait shows "Connecting with SSH timed out"

Issue: #773. Release 0.2, **gating** (athena, register 2026-10-14, option (a)). Size: S. Builder: selene. It goes with
connect-49 (#771), which makes the wait end at the right time. This card gives the ending its text.

## 1. The defect

**The rule:**
- F-2105 7.E3: when the extension's own wait (BR-3, the timeout plus 2 s) passes before ssh has failed, the dialog is
  `Could not establish connection to "<alias>": Connecting with SSH timed out.`
- F-2105's §3 table lists the text as "not in the string table": the reason {1} of S031, and the presenter adds the
  full stop.
- F-2206 7.E5 and F-2601 AC-28 show the same dialog.

**What main does:** the wait's timeout is `{kind: 'timeout'}` with no reason, in both modes:
- shared mode: `pipeline/failure.ts`, the acquire mapping, `case 'timeout': return {kind: 'timeout'};`;
- terminal mode: `pipeline/terminal-connection-step.ts`, the three `fail({kind: 'timeout'})`: the `ConnectWait`, the
  prompt reader's `onUnreachable`, and the bootstrap's `timeout` event.

So the presenter shows S030, `Could not establish connection to "<alias>".`

## 2. The fix

1. **`surfaces/failure-strings.ts`:** add our own id `sshTimedOut: 'Connecting with SSH timed out'` beside the other
   own ids (`trustRefused`, `reversedPortRange`, …). The text is the spec's, verbatim, with no full stop. Add the key,
   with the English text as its value, to every `l10n/bundle.l10n*.json`. `pnpm check-string-tables` must pass.
2. **Shared mode:** in `failure.ts`'s acquire mapping, `case 'timeout'` gives `{kind: 'timeout', reason: {id:
   'sshTimedOut'}}`.
   - `ofChannel`'s `timeout` is unchanged: it's a channel timeout after the connection was made, not the connect wait.
3. **Terminal mode:** the three `fail({kind: 'timeout'})` above give the same reason. Put it in one constant of the
   module, so the three can't drift apart.
4. A timeout that ssh itself reports (classified from its output, S137 or S140) keeps its classified reason. This card
   only touches the extension's own wait.

athena is asking the room for an STR id (option (b)). If one comes, our id is renamed to it in a follow-up. That
doesn't block this card.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `failure.test.ts` | `F-2105 7.E3: the shared connection's own wait gives the reason "Connecting with SSH timed out"` | the acquire failure `{kind: 'timeout'}` | `{kind: 'timeout', reason: {id: 'sshTimedOut'}}` |
| `terminal-connection-step.test.ts` | `F-2105 7.E3: in terminal mode, the wait, the prompt reader and the bootstrap's timeout give the same reason` | each of the three paths, as the existing timeout rows drive them | the failure has `reason: {id: 'sshTimedOut'}` |
| `failure-presenter.test.ts` | `F-2601 AC-28: a timed out wait shows "Connecting with SSH timed out."` | `textFor({kind: 'timeout', reason: {id: 'sshTimedOut'}})` (the presenter rows' helper) | `Could not establish connection to "box": Connecting with SSH timed out.` |
| `failure-strings.test.ts` | the existing key-list row | | gains `sshTimedOut` in its place |

**Defect rule:** the first two rows, and an end-to-end form of the third (a shared-mode timeout through the presenter),
must fail on main and pass with the fix. Paste both runs.

**Acceptance:** coverage-12's `platform-mute-default` row (#551) then asserts the dialog's full text, and iris adds it
once both cards have merged. Say so on #551 when this merges.

## 4. Catalogue

No tag changes here. F-2601 AC-28 and F-2206 AC-28 are tagged by their acceptance rows.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-string-tables, check-identifiers,
check-coverage and coverage, with the changed files at 100 %. Use the PR title
`remote-ssh: the extension's own wait shows "Connecting with SSH timed out" (card connect-50, #773)`. Request athena
only; hermes assigns the peer.

## 6. Open rows (stop and report on #773)

1. A test on main asserts that a timeout has no reason. Name it, and update only its expectation, citing this card.
