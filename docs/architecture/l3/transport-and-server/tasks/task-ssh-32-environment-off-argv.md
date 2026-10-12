# Task card ssh-32: a script's environment never appears in a process's command line (contracts §S10)

Why: daedalus's finding for cli-03b on #412, ruled by athena (contracts §S10, 696fa45 and 323d2f2: "No secret in any
process's command line"). A `ScriptRequest`'s `environment` is written as assignment lines inside the script text
(`remote-program.ts` `environmentLines`). The script is then run as `sh -c '<script>'` on the shared session
(`commandsFor`), in terminal mode (the same `commandsFor`), and on the direct channel when it has input
(`planScript`). So every variable sits in that `sh`'s argv, which any local user reads with `ps`. Measured:
`sh -c 'export SECRET_TOK=s3cret; sleep 2; echo done'` shows the value in `ps -eo args`; the forms below show nothing.
The CLI's token (contracts V7a, `VSCODE_CLI_REQUIRE_TOKEN`) is the first secret that needs this. **Merges before
cli-03b.** Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/process/remote-program.ts` | `scriptText` without the assignment lines; `environmentPrefix`; `planScript`'s input form (sections 2.1, 2.3) |
| `packages/lib-ssh/src/connection-server/shell-runs.ts` | `ShellRun.environment`; `commandsFor` writes the prefix (section 2.2) |
| `packages/lib-ssh/src/connection-server/client.ts` | `SessionRun.environment` |
| `packages/lib-ssh/src/connection-server/messages.ts` | the `runScript` message carries `environment` (section 2.2) |
| `packages/lib-ssh/src/connection-server/handler.ts` | passes it from the message to `ShellRuns` |
| `packages/lib-ssh/src/connection-server/shared-channel.ts` | sends `scriptText` and `environment` separately |
| `packages/lib-ssh/src/terminal/terminal-runs.ts` | the same (it builds `ShellRun`s) |
| `packages/lib-ssh/test/unit/*` | rows (section 3) |
| `tests/acceptance/server/environment-argv.test.ts` | new: the three real-shell rows (section 3.2) |

## 2. Contract

### 2.1 `remote-program.ts`

- `scriptText(request)` returns the script **without** assignment lines (the interpreter and name checks stay: a
  bad name is still refused, with today's reason).
- New, exported:

```ts
/** The environment as an assignment prefix for a `sh` command: `NAME='value' …` and a trailing space, or `''` when empty. */
export function environmentPrefix(environment: Readonly<Record<string, string>>): string;
```

  Each value is `posixQuote`d, in the order of `Object.entries`. Names are already checked by `scriptText`.

### 2.2 The session runners (`commandsFor`)

- `ShellRun` and `SessionRun` gain `environment: Readonly<Record<string, string>>`.
- The `runScript` message gains `environment`. `parseConnectionRequest` accepts an object whose values are all
  strings, and refuses any other value, as it refuses a wrong `inputBase64`. The helper's handler passes it on.
- `commandsFor(marker, run)` writes `${environmentPrefix(run.environment)}sh -c ${posixQuote(run.script)}` in both
  of its forms (with input, after `| `; without, before `</dev/null`). The session shell reads that line from its
  stdin and puts the values in the child's environment. They are never inside the `-c` text.
- `SharedSessionChannel` and the terminal runner build the run from `scriptText(request)` and `request.environment`.
  `EXEC_ARGUMENT_LIMIT_BYTES` still counts the script text only (the prefix isn't in the argument).

### 2.3 The direct channel (`planScript`)

The remote command is `ssh`'s argument on the client and `sh -c`'s on the host, so no value may be in it.
- **Without input** (unchanged in shape): `remoteProgram: 'sh -s'`, and stdin is the assignment lines (`environmentLines`,
  as today) followed by the script.
- **With input and an empty environment** (unchanged): `remoteProgram: sh -c '<script>'`, stdin the input.
- **With input and a non-empty environment** (new): the **prelude**, the assignment lines and the script joined by
  `\n` with a final `\n`, goes on stdin **ahead of the input**. The remote command reads exactly the prelude and runs it:

  ```sh
  sh -c 'eval "$(head -c <n>)"'
  ```

  `<n>` is the prelude's length in bytes (UTF-8). It is the only variable part of the command, and it's a number,
  never a value. `head -c` consumes exactly the prelude, and the script then reads the rest of its stdin: the input,
  byte for byte.

  `ScriptPlan`'s `input` becomes lib-ssh's own type (lib-host's `ScriptInput` is unchanged):

  ```ts
  export type PlannedInput =
    | {kind: 'text'; text: string}
    | {kind: 'file'; localFile: string}
    | {kind: 'prefixedFile'; prefix: string; localFile: string};
  ```

  For this case, a text input becomes `{kind: 'text', text: prelude + input.text}`, and a file input becomes
  `{kind: 'prefixedFile', prefix: prelude, localFile}`. `SshHostChannel.feed` takes `PlannedInput`, and for
  `prefixedFile` writes `prefix` first, then the file's bytes, as for `file`.

Checked on this machine (dash and bash) and on the pinned Alpine host image (BusyBox `head`). A 100 000-byte random
input arrived intact (`cmp`); the value reached the script; `ps -eo args` showed only
`sh -c eval "$(head -c 89)"` and the script's own commands, never the value.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Unit

| Cite | Given | Expected |
|---|---|---|
| §S10 | `environmentPrefix({A: 'x y', B: "it's"})` | `A='x y' B='it'\''s' ` |
| §S10 | `environmentPrefix({})` | `''` |
| §S10 | `scriptText({script: 'echo hi', environment: {A: '1'}, …})` | `echo hi` (no assignment lines) |
| §S10 | `scriptText` with the name `1A` | refused, today's reason |
| §S10 | `commandsFor('m', {script: 'echo $A', environment: {A: 'v'}, inputBase64: null, …})` | its body line is `A='v' sh -c 'echo $A' </dev/null` |
| §S10 | the same with input | the body line ends `| A='v' sh -c 'echo $A'` |
| §S10 | `commandsFor` with an empty environment | the body lines are today's |
| §S10 | `parseConnectionRequest` of a `runScript` with `environment: {A: 1}` | refused (`undefined`) |
| §S10 | the same with `environment: {A: '1'}` | accepted, with that environment |
| §S10 | `planScript` with input, environment `{A: 'v'}`, script `cat` | `remoteProgram` is `sh -c 'eval "$(head -c 19)"'` (the prelude `A='v'\nexport A\ncat\n` is 19 bytes) |
| §S10 | the same | `remoteProgram` contains no `v` value (`!includes("'v'")`) |
| §S10 | the same with a text input `xyz` | the plan's input text is the prelude followed by `xyz` |
| §S10 | the same with a file input `/tmp/in` | the plan's input is `{kind: 'prefixedFile', prefix: <prelude>, localFile: '/tmp/in'}` |
| §S10 | `feed` of a `prefixedFile` over a fake session and a file of `abc` | the session got the prefix, then `abc`, then the end of input |
| §S10 | `planScript` with input and an empty environment | today's plan |
| §S10 | `planScript` without input, environment `{A: 'v'}` | `sh -s`, stdin `A='v'\nexport A\n<script>` (today's) |

### 3.2 Real shell (`tests/acceptance/server/environment-argv.test.ts`, against the harness host, `pnpm test:acceptance:server`)

The marker value is a fresh random token per row, for example `marker-<16 hex>`. Each script keeps running while
`ps` is read, and isn't a lone `sleep` (dash exec-optimises a lone command and hides it). Use `cat >/dev/null; echo
"$MARKER" >got; sleep 3; true`, and read `ps -eo args` on the host (`onHost`) and on the client (`ps -eo args`
locally) while it sleeps.

| Cite | Path | Expected |
|---|---|---|
| §S10 | the shared session (`SharedSessionChannel.runScript`), environment `{MARKER: <m>}`, a text input | no line of `ps -eo args` on the host or the client contains `<m>` |
| §S10 | the same | the script got `<m>` (the file `got` holds it) |
| §S10 | the direct channel (`SshHostChannel.runScript`) with a text input | no `ps` line contains `<m>`; the script got `<m>`; the input arrived whole (a 64 KiB random input compares equal) |
| §S10 | the direct channel without input | no `ps` line contains `<m>`; the script got `<m>` |
| §S10 | terminal mode (`TerminalSessionRunner` over a real login terminal is out of the server suite's reach) | covered by the `commandsFor` unit rows, since it uses the same function; name this in the PR |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet. The acceptance rows need Docker.

## 5. Gates and review

PR title `lib-ssh: a script's environment never appears in a process's command line (card ssh-32, §S10)`.

## 6. Open rows

None. Ruled on #412 (contracts §S10). The direct channel's input form is this card's, proven above.
