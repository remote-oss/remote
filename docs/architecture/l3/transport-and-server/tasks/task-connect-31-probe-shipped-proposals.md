# Task card connect-31: the setup probes the proposals the manifest ships, not the ones the editor left

Issue: #586. **Priority: high.** Why: F-3903 §5 rule 4 (`remote-oss/remote-ssh#80`). Without the proposed APIs, the
extension tells the user once (the setup notice of F-2001 §3.4) and logs which proposals are missing. Proteus found
neither happens. Diagnosed and reproduced on #586 (pinned VSCodium insider, a plain start):
- **the editor strips the proposals it doesn't allow** from the in-memory manifest, so
  `context.extension.packageJSON.enabledApiProposals` is `[]`;
- `extension.ts` gives the setup `proposals: manifest.enabledApiProposals ?? []`, so nothing is probed, nothing is
  missing, no notice is shown and nothing is logged;
- the same holds for the family members that `installedFamilyIds` reads.

Builder: hestia, with connect-30 (#584). Size: S–M. Depends on connect-30 for its acceptance launch.

## 1. The changes

**Our own proposals come from the build, not from the running editor.**
- `tools/identifiers.ts` (the generator of `identifiers.generated.ts`) emits, for each package,
  `export const enabledApiProposals = [...] as const`, from that package's `package.json`, in its order. Its tools rows
  and the generated-file check cover it.
- `remote-ssh/src/extension.ts` passes `proposals: enabledApiProposals` (the generated constant) to the setup.
  `Manifest.enabledApiProposals` goes, since nothing reads it any more.

**Family members' declarations come from their files.**
- `GateEditor.installed()` becomes async. For each installed extension whose id starts with `remote-oss.`, it reads
  `<extensionPath>/package.json` through the existing `readFile` port and takes `enabledApiProposals` from the file. An
  unreadable or unparsable file counts as declaring none, and the reason goes to the log.
- Other extensions are not read.
- `installedFamilyIds` then sees what each member ships.

**The setup's notices go through the notice port in the harness.**
- `gateEditorOf`'s `showWarning` and `showInformation` take a `NoticePort` (tooling-24) instead of calling
  `vscode.window` directly.
- `extension.ts` makes the adapters (`adaptersFor`) once, before activation, and passes `adapters.notice`.
- Outside the harness, the editor adapter is today's `showWarningMessage` / `showInformationMessage`, so nothing changes
  for users. In the harness, the record gets a `notice` line for the setup notice.

## 2. Rows

Unit rows:

| Name | Expected |
|---|---|
| `F-3903 §5 rule 4: the setup probes the proposals the manifest ships` | the setup is given the generated `enabledApiProposals`. A fake editor whose `packageJSON.enabledApiProposals` is `[]` still gets the four probed |
| `F-3903 §5 rule 4: a family member's proposals are read from its manifest file` | `installed()` with a fake file port: a member with a file declaring `resolvers` counts; a member with none, or with an unreadable file, doesn't; a non-family extension isn't read |
| `the generated identifiers carry each package's enabledApiProposals` | tools row over `remote-ssh`'s `package.json` |
| `F-3903 §5: closing the setup notice stores the dismissal flag, as Not Now does` | `setup-ports` with a notice that answers nothing: the dismissal flag is set (add this row if `setup-ports.test.ts` has none) |
| `the setup's notice goes through the notice port` | `gateEditorOf` with a recording `NoticePort`: the setup notice's text and buttons |

**Acceptance rows** (connect-30's `no-proposals` plain launch: no `--enable-proposed-api`, not development mode):

| Name | Expected |
|---|---|
| `F-3903 §5 rule 4: without the proposals the setup notice is shown once` | after `inWindow('local', 'opensshremotes.showLog')`, the record has exactly one `notice` line of window `local`, whose question is F-2001 §3.4's setup text (`SETUP_TEXT_TEMPLATES.setup`, filled), with the buttons that text gives. The script answers it `dismiss`. Closing the notice stores the dismissal flag, as "Not Now" does (F-3903's repeat rule; `setup-ports.ts` maps a close to `notNow`). The launch activates the extension once, so no later row depends on the flag |
| `F-3903 §5 rule 4: without the proposals the log names them` | the launch's log holds exactly one line `Missing proposed APIs: resolvers, tunnels, terminalDataWriteEvent`, plus any further missing ones in the manifest's order |
| `F-3903 §5 rule 4: a second command in the same window shows nothing more` | after `inWindow('local', 'opensshremotes.getHelp')` (any served command), still exactly one setup `notice` line |

The third row holds because the setup runs once per activation. If the repeat rule needs more than that, report it on
the issue.

## 3. Review

PR title `remote-ssh, lib-authority: the setup probes the proposals the manifest ships (card connect-31, #586)`. athena
(design: the generated list, the file read, the notice port), themis or triton.
