# Task card connect-30: the commands are registered without the resolvers grant (F-3903 §5 rule 4)

Issue: #584. **Priority: high.** Why: when the editor doesn't grant the `resolvers` proposal (an editor started without
`--enable-proposed-api` for us), every connect command reports "command not found". `registerConnect`
(`packages/remote-ssh/src/register-connect.ts`) returns before it registers any command when `registerResolver` gives
`proposalMissing`. F-3903 §5 rule 4 (`remote-oss/remote-ssh#81`) says the extension's own commands keep working after
a failed probe. A connect command still opens its `ssh-remote` window, whose own activation fails its probe and shows
the setup notification. athena ruled the early return "not intended" and amended contracts windows-and-explorer §3.2
on main (3ecd82e): **a missing proposal holds back the resolver alone.** Builder: hestia, after #540 merges (it's that
PR's file). Size: S.

## 1. The change

In `registerConnect`, once the guard says serving:
- **Always:** register every command that `register-connect.ts` serves, whatever `registerResolver` gave:
  - #540's connect commands (`openEmptyWindow`, `openEmptyWindowInCurrentWindow`, `openEmptyWindowOnCurrentHost`,
    `cleanLocalServer`);
  - `openWebUI`, `clearAllSessionHints`;
  - the runtime `showDetails`.
- **Only with `registered`:** the resolver, `registerWindowLabel`, the tunnel factory and the terminal listener.
- **Without a resolver:**
  - `currentAlias()` gives `''`, and the connection port's `current()` gives nothing, as before the first resolve;
  - `openWebUI` and `showDetails` behave as in a local window (no server port; nothing to reveal);
  - `dispose()` disposes what was registered.
- `registration` still reports the kind `registerResolver` gave, so activation's own handling of `proposalMissing`
  (the setup notification) is unchanged.

The fileoverview's "Nothing is registered when the editor does not grant the resolvers proposal" becomes "Without the
resolvers proposal only the resolver and what hangs on it are held back; the commands are registered".

## 2. Rows

Unit rows (`register-connect.test.ts`, the fake editor):

| Name | Expected |
|---|---|
| `F-3903 §5 rule 4: without the resolvers grant every served command is registered` | `resolversGranted` false: the fake's registered command ids equal the granted case's, minus none |
| `F-3903 §5 rule 4: without the resolvers grant Connect to Host still opens the window` | `openEmptyWindow` with a host argument calls `openRemote` with `ssh-remote+<payload>` |
| `F-3903 §5 rule 4: without the resolvers grant nothing of the resolver is registered` | no resolver, no label formatter, no tunnel factory |
| `F-3903 §5 rule 4: Open Web UI and Show Details without a resolver behave as in a local window` | `openWebUI` opens nothing and shows what a local window shows; `showDetails` does nothing |
| `F-3903 §5 rule 4: dispose ends the commands registered without a resolver` | every registration disposed |

**Acceptance row** (the windows suite: a plain editor, so it can be started without the flag):
- `Launch` gains `proposedApi?: boolean` (default true); `editorArguments` leaves `--enable-proposed-api` out when it's
  false.
- A second plain launch, `{label: 'no-proposals', kind: 'plain', suite: 'no-proposals', proposedApi: false}`, runs
  `tests/acceptance/no-proposals/commands.test.ts`:

| Name | Expected |
|---|---|
| `F-3903 §5 rule 4: without the proposal Connect to Host is a command, not "not found"` | with the script entry `{surface: 'hostPick', match: 'Select configured SSH host', answer: 'dismiss', window: 'local'}` (tooling-25), `inWindow('local', 'opensshremotes.openEmptyWindow')` resolves. The agent reports `done`, not a `failed` whose message holds `not found` |
| `F-3903 §5 rule 4: without the proposal Kill Local Connection Server is a command` | the same for `opensshremotes.cleanLocalServer` |

If tooling-25 hasn't merged when this is built, run the acceptance rows with the host argument instead
(`inWindow('local', 'opensshremotes.openEmptyWindow', 'harness')`). The window it opens shows the setup notification;
close it. Kill's row then waits for tooling-25.

## 3. Review

PR title `remote-ssh: the commands are registered without the resolvers grant (card connect-30, #584)`. athena (design;
she ruled it), themis or triton.
