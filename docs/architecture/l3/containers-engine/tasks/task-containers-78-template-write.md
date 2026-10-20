# Task card containers-78: a template is applied into a scratch folder and copied by us (C14's write)

Containers increment 2, authoring. Size: M. Builder: `task:claude`. Brief:
`docs/architecture/l3/containers-engine/brief-increment-2-authoring.md` ruling 4. Specs: F-0801 BR-5 (add or replace,
never remove), BR-6 (S182), 5.0 step 7 (S028), 7.E2, 7.E8, 7.E10 (b), 7.E11; F-0802 7.E1 (S039). **Depends on
containers-76 (#1238)**.

## 1. The write (`src/authoring/write.ts`, new)

```ts
export type WriteOutcome =
  | {kind: 'written'; files: string[]}        // the target-relative paths actually written
  | {kind: 'cancelled'}                       // S182 Cancel or Escape: nothing written
  | {kind: 'failed'; detail: string};         // nothing written
export function writeTemplate(request: WriteRequest, ports: WritePorts, cancellation: AbortSignal): Promise<WriteOutcome>;
```

`WriteRequest`: `{targetFolder, templateId, templateArgs, features, omitPaths}`. `WritePorts`: the bridge's
`applyTemplate`, a file port (stat, read, write, mkdir, remove a scratch folder), the S182 dialog, the open documents
(for 7.E11), the progress, and the log.

Order:
1. **Progress** S028 `Adding Dev Container Configuration Files...` for the whole call (an info notification,
   indeterminate, no buttons).
2. **Scratch folder:** `<globalStorage>/authoring-scratch/<random>`. Apply into it with `applyTemplate`. The folder is
   removed **in every outcome** (`finally`).
3. **Apply failed:** the modal error S039 `Application of the template failed.`, buttons `Cancel` | `Show Log`
   (primary).
   - Show Log reveals the Dev Containers log (the log terminal is F-0104, later), so it shows the stderr lines that
     containers-76 sent there. Say in the PR which surface it opened.
   - Either button returns `failed` with the CLI's failure, and nothing is written (7.E1, 7.E10 b).
4. **Plan the copy:** for each file in the `files` list (the scratch-relative paths without `./`):
   - when the target path exists as a file, ask S182 `File '{0}' already exists, overwrite?` with `{0}` = `./` plus
     the relative path. The buttons are `Overwrite` | `Cancel` | `Skip` (primary), one dialog per existing file,
     **all asked before anything is written**:
     - `Cancel` or Escape returns `cancelled` with nothing written (BR-6, 7.E2);
     - `Skip` leaves the file out;
     - `Overwrite` keeps it;
   - before the S182 dialog for a file that's open in an editor with unsaved changes, add to the dialog's detail one
     line, `It has unsaved changes in an editor.` (7.E11's preferred outcome). Ours, provisional id
     `unsavedChangesNote`.
5. **Copy:** create the folders, then write each planned file.
   - **Never remove anything** (BR-5, 7.E11): files of the target the template doesn't write stay byte for byte.
   - A failure while creating a folder or writing returns `failed` with the file system's message, with an error
     dialog of our own naming it. That's ours, provisional id `configurationNotWritten`: `The configuration couldn't
     be written to {0}: {1}`. Before writing, check that every target folder is creatable (a `.devcontainer` that's a
     file; a read-only folder), so a failure leaves nothing partial (7.E8's required outcome).
6. Return `written` with the files written.

All new strings (S028, S039, S182, `unsavedChangesNote`, `configurationNotWritten`) go into the containers string
table and every bundle.

## 2. Rows

- **Unit** (over fakes), one row per outcome, named after the criteria:
  - written (F-0801 AC-4's write half);
  - Skip, Overwrite and Cancel, and Escape (AC-9);
  - the unsaved-changes note (AC-39);
  - other files kept (AC-38);
  - a `.devcontainer` file, and a read-only folder: nothing written, the message (AC-30);
  - an apply failure: S039 and nothing written (F-0802 AC-12, AC-13; F-0801 AC-36);
  - the scratch folder removed in every outcome.
- **Acceptance** comes with the wizard card (containers-80), which reaches this through the screens.

## 3. Done when

The unit rows pass with `write.ts` at 100 %, and all gates pass. PR title: `remote-containers: a template is applied
into a scratch folder and copied by us (card containers-78, #1240)`. Request athena only.
