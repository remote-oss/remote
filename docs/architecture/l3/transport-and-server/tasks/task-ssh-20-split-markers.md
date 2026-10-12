# Task card ssh-20: the run markers are printed from two pieces (terminal mode T4, first part)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T4) as corrected on #299 (daedalus, 2026-10-12; main
8cf50a0). In terminal mode the editor's terminal echoes every command `ShellRuns` writes into the output it reads back.
`ShellRuns.hear` starts a run on a line that **contains** `<marker>:start` and ends it at `<marker>:end ` anywhere in a
line, on purpose (a script with no final newline leaves its last words in front of the end marker). So an echoed
command line that holds the marker literally would start a run early, and the run would collect its own command lines
as output. **Ruled (option b):** the commands never contain a marker literally. Each marker is printed from two pieces,
so no echo can carry it, while the line the shell prints is unchanged and `hear` stays as it is. This first part of T4
needs nothing from T1 and changes nothing in shared mode's output. The terminal-side wiring of T4 (`ShellRuns` with
S8 as writer and reader) is a later card, after T1. Reviewing coder: `remote-coding-worker-1`.

Checked on a prototype over main (2026-10-12, daedalus): with the split, a run fed its own echoed commands (including
a base64 input and its here-document terminator) followed by real `sh` output heard exactly the script's lines and the
right status; real `sh` printed `m1f00:start` and `m1f00:end 0` unchanged.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/connection-server/shell-runs.ts` | the two `printf` lines of `commandsFor` (section 2) |
| `packages/lib-ssh/test/unit/shell-runs.test.ts` | two rows change their expected text; rows added (section 3) |
| `packages/lib-ssh/test/unit/connection-handler.test.ts` | two rows change their expected text (section 3) |

Nothing else. `hear`, the here-document, the input and the deadlines are unchanged.

## 2. Contract

In `commandsFor(marker, request)`:

```ts
const start = `printf '%s%s\\n' ${posixQuote(`${marker}:st`)} 'art'`;
// …the body is unchanged…
const end = `printf '%s%s %s\\n' ${posixQuote(`${marker}:e`)} 'nd' "$?"`;
```

- The printed lines are exactly today's: `<marker>:start` and `<marker>:end <status>`.
- No command line contains `<marker>:start` or `<marker>:end ` (with its space) as text.
- The split points are fixed (`:st`|`art`, `:e`|`nd`): the marker itself is unguessable and never split.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Rows that change their expected text (names unchanged)

| File | Row | New expected command lines |
|---|---|---|
| `shell-runs.test.ts` | "print the start marker, run the script with no input, and print the end marker with the status" | `printf '%s%s\n' 'm1:st' 'art'` and `printf '%s%s %s\n' 'm1:e' 'nd' "$?"` in place of the two old `printf` lines |
| `shell-runs.test.ts` | "give an input to the script as a base64 here-document in lines of 76 characters" | the same two lines replaced |
| `connection-handler.test.ts` | "are written to the standard input of the ssh session" | `"printf '%s%s\\n' 'm1:st' 'art'\nsh -c 'echo hello' </dev/null\nprintf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"\n"` (the test's string literal, written as the test writes it) |
| `connection-handler.test.ts` | "wait for the one before them" | the `includes('m1:start')` / `includes('m2:start')` checks on the **written** text become checks for `'m1:st'` / `'m2:st'` (the written commands no longer hold the whole marker) |

These are the only existing rows that fail with section 2 in place (checked on the prototype).

### 3.2 Rows added (`shell-runs.test.ts`)

| Cite | Given | Expected |
|---|---|---|
| #299 | `commandsFor('m1', SCRIPT)` | no line includes `m1:start` |
| #299 | `commandsFor('m1', SCRIPT)` | no line includes `m1:end ` (with the space) |
| #299 | `commandsFor` of a script with an input | no line includes `m1:start` or `m1:end ` |
| F-2308 | the commands of a run piped into `/bin/sh` (`spawnSync('/bin/sh', [], {input})`) | its standard output is `['m1:start', <the script's output>, 'm1:end 0']`, line for line |
| #299 | a run that hears each of its own command lines (`commandsFor(…).split('\n')`, each through `hear`) and then `m1:start`, `hi`, `m1:end 0` | the run's lines are `['hi']` |
| #299 | the same | the run ended `{kind: 'ended', status: 0}` |
| #299 | the same with an input (`inputBase64` of `payload\n`) and the script `cat` | the run's lines are `['payload']` |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: the run markers are printed from two pieces (card ssh-20, terminal mode T4)`.

## 6. Open rows

None.
