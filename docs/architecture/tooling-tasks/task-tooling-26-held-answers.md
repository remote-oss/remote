# Task card tooling-26: held answers, a script read at every question, and the window's cursor across reloads

Issue: #573. Why: F-2102's shared-login rows (coverage-15, #574) need three things the scripted adapters lack:
- **a window that waits at a question** while another window joins, and that answers only when the test says so;
- **entries a test adds between steps.** Today the script is read once per extension host;
- **a cursor that survives a reload.** Today a reloaded window starts again from its first entry.

Builder: hestia or iris (hermes assigns). Size: M. Depends on nothing beyond main.

## 1. The behaviour (`packages/remote-ssh/src/surfaces/scripted-adapters.ts`)

**The script is read at every question.** `entriesOf` runs when a question arrives, not once when the adapters are
made. A test may append entries at any time; they count from the next question on.

**A window's cursor is the number of its answered entries.** At each question, the cursor is the count of this
window's record lines with `matched: true` whose surface is one of `ScriptEntry`'s surfaces. Derive that list once,
from the type (for example a `const SCRIPT_SURFACES = [...] as const satisfies readonly ScriptEntry['surface'][]`, with
a type-level check that it covers the union). Don't count "every surface but the display-only ones": each new
display-only surface would silently move every cursor (athena on #575). A record line that doesn't parse is skipped.
Only another window's append in flight can be partial. A reload then continues where the window left off. The in-memory `cursor` variable goes.

**A held entry.** Any `ScriptEntry` may carry `after: string`, a signal name of letters, digits and hyphens. When such an
entry matches a question:
1. the adapter appends the record line `{surface, question, answer: 'held', matched: true, held: true, window, time}`;
2. it waits, polling every 100 ms, until the file `<HARNESS_RUN_FOLDER>/signals/<after>` exists, then answers as the
   entry says. It appends the answer's record line as today, plus `time`;
3. if the question's `cancellation` ends first (the question was withdrawn: another window answered, the window closed,
   the connect ended), it gives nothing and appends `{…, answer: 'withdrawn', matched: true}`.

A held entry counts once for the cursor: the `held` line doesn't count, and the answer or `withdrawn` line does. So the
cursor counts lines with `matched: true` and no `held: true`. Surfaces without a cancellation (`failureDialog`,
`notice`, `licenceModal`, `mitigationPick`, `hostPick`, `filePick`) wait for their signal only. The wait is bounded by
the run's own end.

**`signal(name)`** in `tests/acceptance/windows/harness.ts` creates `<run>/signals/<name>`. It refuses `never`, a
reserved name for an answer that must never come. **`appendScript(entries)`** adds entries to the launch's script file
**atomically**: it writes the whole new JSON to a temporary file in the same folder, then renames it over the script.
The adapter reads the script at every question, so an in-place rewrite could be read half-written and fail closed at
random; with a rename a reader sees the old list or the new one. **`heldLines(window?)`** returns the record's held
lines.

## 2. The run's `ssh_config` (`tools/acceptance.ts`, `harnessSshConfig`)

One more alias, `password-ask`: the `password` alias's lines, but `StrictHostKeyChecking ask` and `UserKnownHostsFile
<run>/known_hosts_password_ask`. A test deletes that file to make the host key unknown again.

**`acceptedPasswords()`** in `windows/harness.ts`: the number of lines of `docker logs <container>` that contain
`Accepted password for harness-pw`. sshd runs with `-e`, so its log goes to the container's output.

## 3. Rows

Unit rows (`scripted-adapters.test.ts`, with a fake file port and a fake clock):
- an entry appended after the first question is used by the next question;
- a new adapter set for the same window, which is what a reload gives, continues at the count of its record lines;
- a held entry writes its `held` line, waits, and answers once the signal file exists;
- a held entry whose cancellation ends writes `withdrawn` and gives nothing;
- a held entry counts once for the cursor;
- a held failure dialog waits for its signal;
- a line of a display-only surface (`progress`) doesn't move the cursor; an unparseable record line is skipped;
- `appendScript` leaves no partial file: a reader during the write sees the old or the new list (tools row with a
  reader loop).

Capability rows in `tests/acceptance/windows/two-windows.test.ts`:

| Name | Expected |
|---|---|
| `D-85: a held password answer keeps the window waiting until its signal` | `appendScript([{surface: 'maskedInput', match: 'password', answer: {text: <the run's password>}, window: 'h1', after: 'h1-go'}])`; `openWindow('password', 'h1')` doesn't resolve its connect while the held line of `h1` is there and no signal is given (state not `ssh-remote` after 3 s); after `signal('h1-go')`, `h1` is connected |
| `D-85: one accepted password is counted on the host` | `acceptedPasswords()` grew by exactly 1 over the first row |

Close `h1` at the end. The cursor across a reload is proven by its unit row; coverage-15's reload rows use it in the
run. remote-ssh stays at 100/100/100.

## 4. Review

PR title `tests: held answers, the script read per question, the cursor across reloads (card tooling-26)`. themis or
triton reviews; athena checks the record's new lines.
