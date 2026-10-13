# Task card tooling-24: the harness answers text inputs and records notices

> **Built by #552 (merged).** As built, `textInput` matches `prompt ?? placeholder`. F-2204's input has a title and no
> prompt (triton on #535), so connect-22 adds `title` to the request and matches `title ?? prompt ?? placeholder`, with
> the title as the record's `question`.

Issue: #534. Why: the slice-3 commands the user put into 0.2 (connect-22, connect-23) ask through two surfaces the
scripted adapters don't cover: a plain text input ("Enter SSH Connection Command", F-2204) and non-modal notices with
buttons (F-2204's "added" notice, F-2411's and F-2412's notices). D-85's capabilities don't include them. Builder:
hestia or selene. Size: S. Depends on tooling-18 (#511, the record's shape).

## 1. The two surfaces

In `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, beside the existing ones:
- **`textInput`:** `ScriptEntry {surface: 'textInput'; match: string; answer: {text: string} | 'dismiss'}`, matched
  on the input's title, else its prompt, else its placeholder (the title part comes with connect-22). The record keeps the text as typed: it's not a secret field, unlike
  `maskedInput`;
- **`notice`:** `ScriptEntry {surface: 'notice'; match: string; answer: {button: string} | 'dismiss'}`, for an
  information, warning or error message that isn't modal. The record line is `{surface: 'notice', question: <message>,
  answer: <button or 'dismiss'>, matched}`. A notice with no matching entry is recorded as `dismiss` and resolves at
  once (fail closed, as the other surfaces do).

The editor adapters (`surfaces/editor-adapters.ts`) gain the real `textInput` (`window.showInputBox`) and `notice`
(`window.showInformationMessage`, `showWarningMessage` and `showErrorMessage` without `modal`) ports that the commands
use, so the scripted ones replace them under the switch.

## 2. Rows

- **Unit rows** in `scripted-adapters.test.ts`:
  - a matching `textInput` entry answers its text;
  - `dismiss` gives `undefined`;
  - a `notice` with a matching entry answers its button and records it;
  - an unmatched notice is recorded `dismiss`;
  - with the switch off, the real ports are used.
- **The editor adapters:** a row each over the fake editor.

## 3. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `tests: the harness answers text inputs and
records notices (card tooling-24)`. triton.
