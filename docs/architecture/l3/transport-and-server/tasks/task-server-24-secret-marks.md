# Task card server-24: a run's secret variables are marked where they're defined, and the log names them at any length

Issue: #1090. Release 0.2. Size: S. Builder: `task:claude`. **Build after** connect-67 (#846, PR #1087) is on main.
Design: athena's ruling on #253 (2026-10-20, F-2003 BR-14, option 3). The contracts edit is athena's.

## 1. The rule

- **A variable of a run's environment is secret** when it carries a credential or a token, or when its value comes
  from a user setting. Its value is logged as `${NAME}` at any length.
- **Every other value keeps connect-67's rule:** named when it's 8 characters or longer.
- **The mark lives where the variable is put into the environment.** `loggedChannel` reads it, and never guesses
  from the name.
- **A guard:** a variable whose name contains `TOKEN`, `SECRET`, `PASSWORD` or `KEY` (any case) must be marked.
  A run that defines one unmarked is a defect, and a unit row catches it.
- **The connection token** stays masked as today, from the parsed block.

## 2. The change

1. **lib-host, `ScriptRequest`:** gains `secretVariables?: readonly string[]`, the names in `environment` whose
   values are secret. Its doc comment says that a channel or a decorator that logs output must name those values
   whatever their length. `RecordingChannel` records it with the request, as it records the rest.
2. **lib-server, `run-step.ts`:**
   - `StepOptions` gains `secretVariables?: readonly string[]`, and `runStep` passes it into the request.
   - Before the run, `runStep` checks the guard of §1: an `environment` name that matches `/TOKEN|SECRET|PASSWORD|KEY/i`
     and isn't in `secretVariables` throws `Error('the run variable <NAME> looks secret and is not marked')`. That's
     a programming defect, not a host failure.
3. **lib-server, `cli.ts`:** the start of the CLI passes `secretVariables: [TOKEN_VARIABLE]` with its
   `{[TOKEN_VARIABLE]: token}`. It's the only variable lib-server puts into a run's environment today: check with
   `grep -rn "environment:" packages/lib-server/src`. A new one later marks itself, or the guard stops it.
4. **remote-ssh, `pipeline/remote-log.ts`:** `scrubbed` takes the request's `secretVariables`. Their values are
   named at any length, and an empty value is skipped. The other values keep the 8-character rule. The longest value
   still goes first, over both sets together.

## 3. Rows

| File | Cite | Given | Expected |
|---|---|---|---|
| `lifecycle.test.ts` (the `runStep` rows) | F-2003 BR-14 (ruling-253-mark) | `runStep` with `environment: {MY_TOKEN: 'x'}` and no mark; with the mark; with `{PLAIN: 'x'}` and no mark | throws naming `MY_TOKEN`; runs; runs |
| `lifecycle.test.ts` (the `runStep` rows) | BR-14 | each of `A_SECRET`, `password1`, `SSH_KEY` unmarked | throws (the four words, any case) |
| `lifecycle.test.ts` (the `runStep` rows) | BR-14 | `secretVariables` reaches the channel's request | the recording channel's request has it |
| `cli-lifecycle.test.ts` | BR-14 | the CLI start's request | `secretVariables` is `['VSCODE_CLI_REQUIRE_TOKEN']` |
| `remote-log.test.ts` | BR-14 (ruling-253-mark) | a marked 3-character value `abc`, an unmarked 3-character value `xyz`, both printed | `${MARKED}`, and `xyz` as it is |
| `remote-log.test.ts` | BR-14 | a marked empty value | the line unchanged |
| `remote-log.test.ts` | BR-14 | a marked short value inside an unmarked long one | the long one named; the short one's text isn't left over |

Every changed file at 100 %.

## 4. Gates and review

All gates. PR title: `lib-host, lib-server, remote-ssh: a run's secret variables are marked, and the log names them at
any length (card server-24, #1090)`. Request athena only; hermes assigns the peer.
