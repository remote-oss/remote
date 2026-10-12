# Task card ssh-35: no script travels as `sh -c '<script>'` on the direct channel (#443)

Why: #445 for #443, found while measuring the login shells for it. The direct channel (`planScript` in
`packages/lib-ssh/src/process/remote-program.ts`) sends a script **with input and no environment** as
`sh -c '<script>'`. sshd hands that to the login shell as `<shell> -c "sh -c '<script>'"`. Measured on Debian's
packages through each login shell's `-c`:

| Script inside the quotes | sh, dash, bash, zsh, ksh, mksh, fish | csh, tcsh |
|---|---|---|
| two lines (`echo one` newline `echo two`) | runs | `Unmatched '` (not run) |
| `echo a!b` | `a!b` | `b: Event not found.` (not run) |
| `echo a\b` | `a\b` in sh | `ab` (backslash lost) |
| `'`, `$HOME`, `"a b"` | as written | as written |

Every multi-line script fails under csh and tcsh. The other two forms pass in every shell (same measurement):
`sh -s` with the script on standard input, and ssh-32's prelude `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`,
whose quoted word holds no newline, `!` or backslash. So the input-without-environment case uses the prelude too.
`sh -c '<script>'` is then never sent, and the remote command is always one of two fixed forms. Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/process/remote-program.ts` | `planScript`'s input case (section 2) |
| `packages/lib-ssh/test/unit/remote-program.test.ts` (or the file holding `planScript`'s rows) | rows (section 3) |
| `tests/acceptance/server/login-shells.test.ts` | one row per shell (section 3), on ssh-34's hosts |

**Depends on ssh-34** for the per-shell hosts.

## 2. Contract

In `planScript`, the branch `lines.length === 0` with input goes away. **Every script with input** takes the prelude
form: `prelude = [...lines, script.text].join('\n') + '\n'` (with `lines` empty when there is no environment), the
remote program `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`, and the input `{kind: 'text', text: prelude +
text}` or `{kind: 'prefixedFile', prefix: prelude, localFile}`.

Update the file's `@fileoverview`: a script without input travels on standard input of `sh -s`. A script with input
travels as a prelude ahead of its input on standard input, read by a fixed command whose one quoted word every login
shell parses alike.

`posixQuote` stays exported (other callers use it).

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| #443 | `planScript` with input `{kind: 'text', text: 'abc'}`, no environment, script `cat` | `remoteProgram` is `sh -c 'eval "$(dd bs=1 count=4 2>/dev/null)"'` (`cat\n` is 4 bytes) |
| #443 | the same | the input is `{kind: 'text', text: 'cat\nabc'}` |
| #443 | the same with a file input `/f` | the input is `{kind: 'prefixedFile', prefix: 'cat\n', localFile: '/f'}` |
| #443 | `planScript` of every input and environment combination (no input, text, file × no environment, one variable) | no `remoteProgram` contains a newline or `!` |
| #443 (real `ssh`, per shell of ssh-34) | the direct channel runs the two-line script `read -r line` newline `printf '%s!\n' "$line"` with the text input `a\b` and a newline | its output is `a\b!` |

The existing rows that expect `sh -c '<script>'` for input without environment change to the prelude form. Keep their
names and say so in the PR.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: no script travels as sh -c '<script>' (card ssh-35, #443)`.

## 6. Open rows

None.
