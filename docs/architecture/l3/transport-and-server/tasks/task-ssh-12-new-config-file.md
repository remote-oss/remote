# Task card ssh-12: creating a picked configuration file and its starter template (pure)

Brief: slice 3 (#42). Spec: F-2203 (`remote-oss/remote-ssh#30`) BR-5, BR-6 and 6.1, 6.3. Reviewing coder:
`remote-coding-worker-1`. Depends on nothing for its own code; the caller builds the input with `filesInEffect` of
`lib-ssh` (exported on main: type `FileInEffect` and the function), and `ClientPlatform` is not needed here.

## 1. Package and file boundary

`packages/remote-ssh/src/config/new-file.ts`, test `packages/remote-ssh/test/unit/new-file.test.ts`. Neither exists on main
(card ssh-11 owns the other file of `src/config/`). Pure: it returns what to create, never creates. Nothing else changes.

## 2. Contract

```ts
export interface FolderState { path: string; exists: boolean }
export interface NewFileInput {
  file: string;                                  // absolute, `~` already expanded by the caller
  role: 'user' | 'configured';
  exists: boolean;
  missingFolders: readonly string[];             // outermost first, empty when the parent exists
}
export interface CreationStep { path: string; kind: 'folder' | 'file'; mode: number }
export interface CreationPlan {
  steps: readonly CreationStep[];                // folders first, then the file
  insertTemplate: boolean;
}
export function planCreation(input: NewFileInput): CreationPlan;
// exists: no steps, no template.
// role user, missing: each missing folder mode 0o700, the file 0o600, template.
// role configured, missing: each missing folder mode 0o755, the file 0o644, template.

export interface IndentChoice { insertSpaces: boolean; tabSize: 2 | 4 }
export interface TabStop { line: number; start: number; end: number }   // zero-based; start === end is a caret
export interface Template { text: string; tabStops: readonly TabStop[] }
export function starterTemplate(indent: IndentChoice): Template;
```

`starterTemplate`: the unit is four spaces when `insertSpaces` is true; otherwise tab characters, `4 / tabSize` of them.
Lines joined with `\n`, no trailing newline:
`# Read more about SSH config files: https://linux.die.net/man/5/ssh_config`, `Host alias`, `<unit>HostName hostname`,
`<unit>User user`. Tab stops in order: `alias` on line 1 (columns 5 to 10), `hostname` on line 2 (start
`unit.length + 9`, length 8), `user` on line 3 (start `unit.length + 5`, length 4), then the caret at the end of line 3
(start and end both the line's length).

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2203.BR-5 | user file missing, `/h/.ssh` missing | steps: folder `/h/.ssh` 0o700, file `/h/.ssh/config` 0o600; template true |
| F-2203.AC-31 | user file missing, `missingFolders` empty | one step, the file 0o600; no folder step (an existing folder keeps its mode) |
| F-2203.AC-9 | file exists (either role), empty or not | no steps; `insertTemplate` false |
| F-2203.AC-12 | configured file missing, folders `/a`, `/a/b` missing | steps in order: folder `/a` 0o755, folder `/a/b` 0o755, file 0o644; template true |
| F-2203.BR-5 | configured, only the file missing | one step, file mode 0o644 (not 0o600) |
| F-2203.AC-6 | `starterTemplate({insertSpaces: true, tabSize: 4})` text | the four lines with a four-space unit and no trailing newline |
| F-2203.AC-7 | the same text | 121 bytes (`Buffer.byteLength`) |
| F-2203.AC-25 | `{insertSpaces: false, tabSize: 2}` | lines 3 and 4 start with exactly two tab characters |
| F-2203.AC-25 | `{insertSpaces: true, tabSize: 2}` | lines 3 and 4 start with exactly four spaces |
| F-2203.BR-6 | `{insertSpaces: false, tabSize: 4}` | lines 3 and 4 start with exactly one tab character |
| F-2203.AC-6 | four-space template tab stops | `{1,5,10}`, `{2,13,21}`, `{3,9,13}`, then `{3,13,13}` |
| F-2203.BR-6 | two-tab template tab stops | `{1,5,10}`, `{2,11,19}`, `{3,7,11}`, then `{3,11,11}` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: new configuration file plan and template (card ssh-12)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. A missing file with role `system`: F-2203 Q2 leaves its mode open; the type excludes the role.
2. A relative `configFile` value: F-2203 7.E3 leaves the resolution to decision Q1 (reject, home-relative, or the
   reference); the caller must pass an absolute `file`, and this card does no resolving.
3. `tabSize` other than 2 and 4: the spec shows only those two; the type excludes the rest and the caller narrows.
