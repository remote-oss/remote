# Task card containers-81: a relative `dev.containers.dockerPath` runs only in a trusted folder, and then the connect uses it (F-0201 AC-55, AC-37)

Containers release 1. Size: S. Builder: `task:claude`. Found by themis on containers-54 part e (#1117), measured in the
`containers-trust` launch with a recording wrapper at `<folder>/tools/dk` and the user setting `dev.containers.dockerPath`
= `tools/dk`. Spec: remote-oss/remote-containers F-0201 BR-1, 5.0 step 2, and the decision "F-0201 Q-trust-relative"
(option (b)). Two product gaps with one cause each, both in how a relative value is resolved, so they share one card.

## 1. The causes (daedalus, reading main)

1. **The view runs the folder's file before trust.** `explorer/targets-view.ts` `engineOfWindow` calls
   `executableOf(ports.dockerPath(), ports.folders()[0])`, whatever the workspace's trust. In Restricted Mode the
   wrapper recorded `events …`, `ps -a -q --no-trunc` and `inspect …` once the Remote Explorer showed the view. BR-1
   requires none: "until the folder is trusted, a relative value is treated as not found for every background and
   view call", with the view showing its welcome content for an absent Docker.
2. **The connect never resolves the value.** `connect/connector.ts` `toolsOf` calls
   `executableOf(settings.dockerPath, undefined)`. With no base, a relative value is `notFound`, and the code falls
   back to `written` (`tools/dk`). The engine then spawns `tools/dk` against the extension host's working directory,
   and the CLI gets `--docker-path tools/dk`. The checks before it (`reopen.ts`, `open-folder.ts`) resolve the value
   against the folder and pass. The setup then fails with F-0410's "'docker' command was not found".

## 2. The change

1. **The view** (`explorer/targets-view.ts`):
   - `TargetsViewPorts` gains `trusted(): boolean` (`vscode.workspace.isTrusted`, as `extension.ts` already passes
     it to the trust gate) and `onTrustGranted(listener): Disposable` (`vscode.workspace.onDidGrantWorkspaceTrust`).
   - `engineOfWindow` passes the folder as the base only when `trusted()` is true, and `undefined` otherwise. A
     relative value is then `notFound`, the listing is `unreachable('no Docker program is named')`, and the view
     shows its welcome content for an absent Docker (BR-15).
   - A trust grant re-reads the listing, as a `dockerPath` change already does.
   - Bare names and absolute paths are unaffected.
2. **The connect** (`connect/connector.ts` `toolsOf`):
   - resolve the value with the folder's host path as the base:
     `executableOf(settings.dockerPath, folder.hostPath)`;
   - the engine **and** the CLI bridge get the resolved file (`file.file`). Give `Tools` a field for it and make
     `cli-arguments.ts` pass that one as `--docker-path`;
   - messages and logs keep naming the value as written (`tools/dk`), as 7.E1 and 7.E4 do.
   The connect runs only after the trust request of 5.0 step 2, so it needs no trust check of its own. Check that
   with a unit row: the connector is never reached with an untrusted folder.
3. **Any other caller:** grep `executableOf(` and `dockerPath()` for background or view calls that resolve against
   the folder without trust (BR-13's context listing, the details view). Give each one the same `trusted()` rule, and
   list them in the PR.

## 3. Rows

**Unit:**
- `targets-view.test.ts`: untrusted with a relative value gives no engine and the welcome content; trusted resolves
  against the folder; a trust grant re-reads; bare and absolute values are the same either way.
- `connector.test.ts`: `tools/dk` and `./tools/dk` give the folder's file to the engine and to the CLI's
  `--docker-path`, while the messages name `tools/dk`.

**Acceptance** (in the `containers-trust` launch, beside themis's rows, with the same recording wrapper), named
`F-0201 AC-55 (…)` and `F-0201 AC-37 (…)`:
- **AC-55 (restricted):**
  1. In a never-trusted folder: opening the window and then the Dev Containers view records no call, and the view
     shows its welcome content.
  2. Reopen in Container shows the trust dialog with no call before the answer.
  3. Cancel leaves the window local and untrusted with no call.
  4. Run again and Trust Folder & Continue: the wrapper runs the checks and the window connects.
- **AC-37 (relative):** in a trusted folder, both `tools/dk` and `./tools/dk` connect with the wrapper running
  every engine call, with no dialog. In an empty window, Open Folder in Container shows the 7.E1 dialog with detail
  `Command not found: 'tools/dk'. Check the license for details.`, and the Dev Containers view shows only its welcome
  content.

**Coverage** (`coverage-containers-r1.tsv`):
- `F-0201.AC-55` becomes `acceptance`.
- `F-0201.AC-37` becomes `deferred` with `containers release 1: later (remote engines)`. Its Remote-SSH clause (the
  7.E9 dialog in an SSH window) waits for that group, and the rows for its local half stay. That's the rule for a
  criterion whose only unmet clause waits for a deferred group.

## 4. Done when

- The unit rows pass, with `targets-view.ts` and `connector.ts` at their gates.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-trust,containers` passes. Paste
  the summary line.
- All gates pass. PR title: `remote-containers: a relative dockerPath runs only in a trusted folder, and then the
  connect uses it (card containers-81, #1251)`. Request athena only.
