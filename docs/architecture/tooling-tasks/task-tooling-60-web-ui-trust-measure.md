# Task card tooling-60: why a terminal-mode connect times out in the web-ui-trust launch (measure first)

Release 0.2. Size: S. Builder: `task:claude` (iris knows the suite). Found by iris on #1280 (card coverage-48). Asked by
athena. Everything is decided here: if what you measure differs from both outcomes in section 3, comment on this
issue with what you measured and stop.

## 1. What is known

- **iris on #1280:**
  - The `web-ui-trust` launch has workspace trust on and `security.workspace.trust.startupPrompt: never`.
  - In that launch, a window that connects without the local server never connects. That's
    `perWindowMode(true)`: `remote.SSH.useLocalServer: false` plus `remotePlatform: {harness: 'linux'}`, as F-2509
    AC-18 and AC-19 set up.
  - The log stops after "Progress: initializing", and the connect times out.
  - The same rows pass in `web-ui`, which has trust off.
- **daedalus, reading main:** the likeliest cause is that the row doesn't answer core's trust request, so the window
  waits on it, as designed.
  - In terminal mode the connect's login runs in an editor terminal (`surfaces/login-terminal.ts`, `createTerminal`).
    In an untrusted window, core asks "Do you trust the authors of the files in this folder?" with Manage, Cancel and
    Trust Folder & Continue before that terminal starts.
  - `trust-terminal.test.ts` (tooling-33) asserts that question, with "Setting up SSH Host harness" shown and "Setting
    up SSH tunnel" not yet.
  - `pipeline/terminal-connection-step.ts` `failureOf` reads a cancelled question as `trustRefused`.
  - `trust-terminal` connects because its rows answer the question. The `web-ui-trust` rows don't.

## 2. Measure

Working on #1280's branch, or on main once it has merged:
1. Add a temporary row to `tests/acceptance/web-ui-trust/` (don't commit it):
   - `perWindowMode(true)`, then `openWindow('harness', 'wt-measure')`;
   - after 20 s, read `waitForDialog('wt-measure')`, `isTrusted('wt-measure')`, `terminalNames('wt-measure')`,
     `recordLines('progress', 'wt-measure')` and the Remote - SSH log (`connectionLog()`);
   - print them all, then `perWindowMode(false)` and `closeWindow` in `finally`.
2. Run `node tools/acceptance.ts --editor vscodium --launches web-ui-trust` after `pnpm package`.
3. Answer the dialog with "Trust Folder & Continue" (the `trust-terminal` rows show how), and check whether the window
   connects within the connect wait.

## 3. The two outcomes

- **(a) The trust question is up, and the window connects after Trust Folder & Continue.** This is designed
  behaviour, not a defect (tooling-33).
  - The deliverable is the measurement, as a comment here: the dialog's message and buttons, the trust state, and the
    log's last lines before and after the answer.
  - Add one line to the `web-ui-trust` launch's comment in `tools/acceptance-launches.ts` and to its README entry: a
    terminal-mode connect in that launch waits on core's trust question, so its rows connect only through the
    local server.
  - Commit no product change and no new row. AC-18 and AC-19 stay in `web-ui`.
  - Title: `tests: the web-ui-trust launch says why its windows connect only through the local server (card
    tooling-60, #1281)`.
- **(b) No trust question, or the window doesn't connect after the answer.** The cause is ours.
  - Comment here with the measurement. Name the last log line, the step it stops in (`pipeline/`), and whether a
    terminal exists.
  - Then stop. daedalus cards the fix, product or harness.

## 4. Done when

- The measurement is posted here, and for (a) the PR is open. Request athena only.
- For (a): the whole diff is linted, and `pnpm dupes`, `pnpm dead` and `node tools/check-coverage.ts` are clean.
- Hold the PR while the open PR queue is at 10 or more (hermes).
