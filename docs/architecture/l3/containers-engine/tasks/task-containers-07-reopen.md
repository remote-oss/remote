# Task card containers-07: Reopen in Container (C6, slice 1) and the dev-container payload codec

Issue: #766. Containers release 1, slice 1, item 9 (brief `brief-release-1.md`, D-87; components.md C6; contracts.md
§3 and §4). Builder: iris, after C10. Size: M (about 2 agent-days).

**Depends on:**
- containers-01 (#759): the package, `identifiers.json`, the `handlers` factory of `extension.ts`, `ServedWindow`,
  the string table;
- containers-03 (#758): `firstCheck`, `currentContext`, `executableOf`, and the `dev.containers.dockerPath` setting
  with its reader;
- containers-04 (#763): `CliBridge.readConfiguration`.

**Build order:** the codec (§3) is pure, depends on nothing but the package, and C10 needs it. Build and merge it first
if C10 is waiting for it. The rest of this card follows.

## 1. What this card builds, and what it leaves

**Builds:**
- the command `remote-containers.reopenInContainer` for a **local** window with one workspace folder that holds
  **exactly one** configuration;
- the `dev-container` payload codec;
- the reload of the same window into `vscode-remote://dev-container+<HEX>/<workspaceFolder>`.

**Leaves for increment 1b** (each card replaces one interim rule of §4):
- C4's discovery picker (F-0401 6.1, F-0301 5.0 step 4) and the hand-off when there's no configuration (F-0401 6.2,
  F-0801);
- C5's trust request (F-0401 6.7, F-0106 BR-2);
- Open Folder in Container (Flow B) and the four rebuild commands;
- the rebuild intent (§6).

**Out of release 1:**
- the WSL, SSH-remote and tunnel windows (F-0401 6.3) and their `when` clause;
- the recovery container (6.4);
- multi-root workspaces (6.5, 7.E3);
- the reopen notification (F-0402).

## 2. Files

All under `packages/remote-containers/`:

| File | What |
|---|---|
| `src/authority/payload.ts` | pure: the codec of §3 |
| `src/open/config-candidates.ts` | pure plus a port: slice 1's configuration lookup (§4.3) |
| `src/open/reopen.ts` | the command's handler: the flow of §4 over ports |
| `src/open/reopen-ports.ts` | the ports of §4.1 and their `vscode` adapters (coverage-excluded like containers-01's `extension.ts` adapters, if that's the package's rule; otherwise covered through fakes) |
| `identifiers.json`, `package.json`, `package.nls*.json`, `src/identifiers.generated.ts` | the command, its menus and its title (§5) |
| `src/extension.ts` | the `handlers` factory returns `reopenInContainer` |
| `test/unit/payload.test.ts`, `config-candidates.test.ts`, `reopen.test.ts`, and the manifest test | the rows of §7 |

## 3. The payload codec (contracts §3, F-0501 BR-1 and BR-2a)

```ts
/** A `file` or `vscode-fileHost` URI as the editor serializes it (`Uri.toJSON()`), in that member order. */
export interface SerializedUri {
  $mid: 1;
  fsPath?: string;
  external?: string;
  path: string;
  scheme: string;
}
export interface DevContainerFolder {
  kind: 'folder';
  hostPath: string;              // the absolute host folder
  localDocker: boolean;          // always false when written (F-0501 §16, room decision 2026-09-26)
  context?: string;              // a non-default Docker context, F-0501 BR-2a `settings.context`
  configFile: SerializedUri;
}
export interface DevContainerLegacy { kind: 'legacy'; hostPath: string; }   // F-0501 BR-2c
export type DevContainerTarget = DevContainerFolder | DevContainerLegacy;
export type PayloadMalformed = {malformed: 'hex' | 'json' | 'shape'};

export function devContainerPayloadOf(target: DevContainerFolder): string;
export function devContainerTargetOf(payload: string): DevContainerTarget | PayloadMalformed;
```

### 3.1 Encoding

1. The JSON text has these members in this order:
   - `"hostPath"`;
   - `"localDocker"` (always `false`);
   - `"settings": {"context": <name>}`, only when `context` is set, between `localDocker` and `configFile`;
   - `"configFile"`, whose members keep their order: `$mid`, then `fsPath` and `external` when present, then `path`,
     `scheme`.
2. The JSON is written with `JSON.stringify` and no spacing. That's F-0501's observed form, for example
   `{"hostPath":"/home/u/p","localDocker":false,"configFile":{"$mid":1,"fsPath":"/home/u/p/.devcontainer/devcontainer.json","external":"file:///home/u/p/.devcontainer/devcontainer.json","path":"/home/u/p/.devcontainer/devcontainer.json","scheme":"file"}}`.
3. The payload is the **lowercase** hex of its UTF-8 bytes (`Buffer.from(text, 'utf8').toString('hex')`).
4. The caller supplies `configFile` from the editor's URI, through the port of §4.1 and `serializedUriOf` (below). The
   codec never builds `external` itself, so its escaping is the editor's own.

   **Not `toJSON()`** (themis on #768, measured with vscode-uri 3.2): the editor's URI serializes only its cached state,
   so a fresh `Uri.file(path).toJSON()` is `{"$mid":1,"path":…,"scheme":"file"}`, with no `fsPath` or `external`. Those
   appear only after `.fsPath` and `.toString()` have been read. So `serializedUriOf(uri)` (pure, in `payload.ts`)
   builds the five members itself, in F-0501's order: `{$mid: 1, fsPath: uri.fsPath, external: uri.toString(), path:
   uri.path, scheme: uri.scheme}`. It takes `{fsPath: string; path: string; scheme: string; toString(): string}`, so
   it never calls `toJSON`.
5. The **authority** is lib-authority's
   `encodeAuthority({family: 'dev-container', target: {payload}, rawHostString: payload})`, which gives
   `dev-container+<payload>`. The codec doesn't add the prefix.

### 3.2 Decoding

1. **Hex:** the text must be non-empty, of even length, and only `[0-9a-f]`; otherwise `{malformed: 'hex'}`. Uppercase
   hex is malformed, because the spec's payload is lowercase.
2. **Bytes:** decode them as UTF-8. If the result doesn't start with `{` after whitespace, it's the **legacy** form
   (BR-2c, a plain host path): `{kind: 'legacy', hostPath: <the text>}`. An empty text is `{malformed: 'shape'}`.
3. **JSON:** text that starts with `{` but doesn't parse is `{malformed: 'json'}`.
4. **Shape.** Anything else is `{malformed: 'shape'}`:
   - `hostPath` must be a non-empty string;
   - `localDocker` must be a boolean (an absent one is malformed);
   - `settings`, when present, must be an object whose `context` is a non-empty string;
   - `configFile` must be an object with string `path` and `scheme`; `fsPath` and `external`, when present, must be
     strings. This is the SSH variant of BR-2a: no `fsPath` or `external`, and scheme `vscode-fileHost`. Decoding
     accepts it even though release 1 never writes it.
   - Members that aren't listed are ignored.
5. **Round trip:** `devContainerTargetOf(devContainerPayloadOf(t))` deep-equals `t` for every folder target.
6. **The legacy form:** release 1 decodes it so that C10 can say what it does with it. Resolving one (configuration
   discovery from the folder alone) is C4's, in increment 1b. Until then C10 fails it as `malformedAuthority`. That's
   C10's card; it's stated here so both cards agree.

## 4. The command's flow

### 4.1 Ports (all faked in unit rows)

```ts
export interface ReopenPorts {
  window: {
    /** `vscode.env.remoteName`, `workspace.workspaceFolders`, and `workspace.isTrusted`, read at each call. */
    remoteName(): string | undefined;
    folders(): readonly {scheme: string; fsPath: string}[];
    isTrusted(): boolean;
    /** `serializedUriOf(vscode.Uri.file(path))` */
    serializedFile(path: string): SerializedUri;
  };
  files: {isFile(path: string): Promise<boolean>; subfolders(path: string): Promise<readonly string[]>};
  settings: {dockerPath(): unknown};                          // containers-03's reader of dev.containers.dockerPath
  engine: {
    firstCheck(base: string | undefined): Promise<'proceed' | 'stopped'>;   // containers-03, with its own dialogs
    currentContext(file: string): Promise<string | undefined>;             // containers-03
  };
  cli: Pick<CliBridge, 'readConfiguration'>;                  // containers-04
  opener: OpenerHost;                                         // lib-authority
  logger: Logger;                                             // ServedWindow.logger
}
```

If containers-03's actual `firstCheck` and `currentContext` signatures take more arguments, the adapter fills them,
and this port keeps the shape above.

### 4.2 The flow, in order

1. **Re-entry:** if a run of this command is already in flight in this window, the new call returns at once. It logs
   at info `Reopen in Container is already running`, shows nothing and calls no port. The flag clears when the run
   ends, whether it opened, stopped or threw.
2. **Context (BR-2, 7.E5).** The command acts only when all three hold:
   - `remoteName()` is `undefined`;
   - `folders()` has exactly one entry;
   - that entry's scheme is `file`.

   Otherwise it logs at info `Reopen in Container does nothing in this window` and returns. Nothing is shown,
   created or written, which meets 7.E5's safety requirement (AC-23). A local window with two or more folders is
   multi-root, which is out of release 1, and it takes the same path.
3. **Trust (interim, until C5):** if `isTrusted()` is false, the command logs at info
   `the folder isn't trusted; Reopen in Container needs workspace trust` and returns. It shows nothing (§8, row 1).
   The palette and the menu also hide the command then (§5).
4. **The engine:** `firstCheck(<the folder's fsPath>)`. On `'stopped'`, return; the check already showed its dialog.
5. **The configuration (§4.3):** with zero or several candidates, log at info naming them and return, with nothing
   shown (§8, row 2).
6. **The docker file:** `executableOf(settings.dockerPath(), <folder>)` (containers-03). `notFound` can't happen after
   a `proceed`, but if it does, log at warn and return.
7. **The workspace folder:** `cli.readConfiguration({workspaceFolder: <folder>, configFile: <candidate>, dockerPath:
   <file>, idLabels: [], mountWorkspaceGitRoot: true, logLevel: 'info'}, undefined, <a fresh AbortSignal>)`. The
   path to open is its `workspaceFolder` (F-0411: the git-root mount, `/workspaces/<basename>`, or the configured
   `workspaceFolder`). A `CliFailure` logs at warn with its kind and message and returns. The failure dialogs of
   F-0301 7.E1–7.E3 are C4's and C8's, in increment 1b.
8. **The context:** `currentContext(<file>)`.
9. **The payload:**
   ```
   devContainerPayloadOf({kind: 'folder', hostPath: <folder>, localDocker: false, context?, configFile: serializedFile(<candidate>)})
   ```
10. **The reload:** `openRemote(opener, 'dev-container+' + payload, {path: <workspaceFolder>, pathKind: 'folder',
    target: 'current'})`. The same window reloads (BR-1).
    - The editor's `Uri.from` encodes the path, so a host folder named `h #x` opens `/workspaces/h #x` exactly (F-0501
      BR-1's preferred outcome, AC-27).
    - A `rejected` outcome logs at warn with its reason.

The command never creates, starts or changes a container. The resolve does that (C10 and C7).

### 4.3 Slice 1's configuration lookup (F-0301 5.0 step 1)

`configCandidates(folder, files): Promise<string[]>` gives the absolute paths that are files, in F-0301's order:
1. `<folder>/.devcontainer.json`;
2. `<folder>/.devcontainer/devcontainer.json`;
3. `<folder>/.devcontainer/<sub>/devcontainer.json` for each immediate subfolder `<sub>`, sorted with
   `localeCompare(…, undefined, {sensitivity: 'base'})`.

The match is exact-case and goes no deeper. A missing `.devcontainer` folder means no subfolders.

Slice 1 uses the list only when it has exactly one entry. C4 (increment 1b) owns the full discovery, including links,
unreadable files and the picker, and takes this function over.

## 5. The contribution (F-0401 3.1, BR-2; F-0504 #15; F-1406)

- **Command:** `remote-containers.reopenInContainer`, category `Dev Containers`, title `Reopen in Container` (palette:
  "Dev Containers: Reopen in Container"). The title's nls key is the one the identifiers tool generates for it, as
  for remote-ssh's commands. There's no keybinding and no icon.
- **`commandPalette`**, one entry, with `when`:
  `!hideConnectCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && isWorkspaceTrusted && !remote-containers:standingDown`.
- **`statusBar/remoteIndicator`**, group `remote_30_dev-container_2_actions@8`, with the same `when`.
- **What differs from the reference:**
  - only the local clause of BR-2 is contributed. The `wsl|ssh-remote|tunnel` clause and the recovery-container
    clause come with those features;
  - `isWorkspaceTrusted` is slice 1's interim (§4.2 step 3). C5's card removes it, so the command is listed in
    Restricted Mode again, as F-0401 PRE-7 says;
  - `!remote-containers:standingDown` is the family's guard (containers-01 §2.3).
- **`hideConnectCommands`:** F-0504 BR-8 (decision 2026-09-26) says the extension defines it, defaults it to false and
  never sets it, and keeps the `when` clause verbatim (D-14, F-1406).
  - Add it to `identifiers.json`'s `contextKeys` with `"setter": "extension"`.
  - Add a tooling-31 allowlist entry: kind `contextKeys`, key `hideConnectCommands`, card `#766`, slice
    `containers release 1`, decision `F-0504 BR-8 (2026-09-26): defined, never set`.
  - If `pnpm check-identifiers` rejects an unprefixed context key, stop and report (§8, row 3).

## 6. The rebuild intent (named here, built in increment 1b)

Contracts §3: the rebuild commands store a rebuild intent before the reload, and C7 reads it once at the start of the
resolve.
- **The key:** `remote-oss.remote-containers.rebuildIntents` in the extension's `globalState` (R-27).
- **The value:** an object mapping each payload to `{at: <epoch ms>, removeExistingContainer: boolean, buildNoCache:
  boolean}`.
- **Who builds it:** the rebuild commands' card, in increment 1b. This card writes nothing under it.

## 7. Rows

### 7.1 `payload.test.ts` (pure)

| Cite | Given | Expected |
|---|---|---|
| F-0501 BR-2a | a folder target, no context, `configFile` with all five members | the exact JSON text of §3.1 (compare the decoded text), and the payload is that text's lowercase hex |
| F-0501 BR-2a | the same with `context: 'desktop-linux'` | `settings` sits between `localDocker` and `configFile`: `…"localDocker":false,"settings":{"context":"desktop-linux"},"configFile":…` |
| F-0501 BR-2a | a `hostPath` with a space, `#`, a non-ASCII letter, and a `"` | the round trip keeps it exactly |
| F-0501 BR-2a | (each) round trip of: no context; a context; the SSH-variant `configFile` (no `fsPath` or `external`, scheme `vscode-fileHost`) | deep-equal |
| F-0501 BR-2a | `serializedUriOf` over a fake URI whose `toJSON()` returns only `{$mid: 1, path, scheme}` and whose `fsPath`, `path`, `scheme` and `toString()` give `/home/u/p/.devcontainer/devcontainer.json`, the same, `file` and `file:///home/u/p/.devcontainer/devcontainer.json` | the five members in order `$mid`, `fsPath`, `external`, `path`, `scheme`, with those values; the fake's `toJSON` was never called |
| F-0501 BR-2c | the hex of `/home/u/legacy` | `{kind: 'legacy', hostPath: '/home/u/legacy'}` |
| contracts §3 | (each) `''`, `'abc'` (odd), `'zz'`, `'7B'` (uppercase) | `{malformed: 'hex'}` |
| contracts §3 | the hex of `{"hostPath":` | `{malformed: 'json'}` |
| contracts §3 | (each) the hex of: `{}`; `hostPath` `''`; `hostPath` 5; no `localDocker`; `localDocker` `"no"`; `settings` `[]`; `settings.context` `''`; no `configFile`; `configFile` without `path`; `configFile.scheme` 3; `fsPath` 3 | `{malformed: 'shape'}` |
| contracts §3 | an unknown member `"extra": 1` | decoded, and the member is ignored |
| contracts §3 | `encodeAuthority` of the payload | starts with `dev-container+`, followed by the payload unchanged |

### 7.2 `config-candidates.test.ts` (over a fake `files`)

| Cite | Given | Expected |
|---|---|---|
| F-0301 5.0 | only `.devcontainer/devcontainer.json` | that one path |
| F-0301 5.0 | the dotfile, the root file, and the subfolders `b`, `A`, `c` each with a `devcontainer.json`, plus `d` without one | the dotfile, the root file, `A`, `b`, `c`, in that order |
| F-0301 5.0 | `.devcontainer/x/DevContainer.json` | not a candidate |
| F-0301 5.0 | `.devcontainer/a/b/devcontainer.json` only | `[]` |
| F-0301 5.0 | no `.devcontainer` folder and no dotfile | `[]` |

### 7.3 `reopen.test.ts` (over fakes that record each call)

| Cite | Given | Expected |
|---|---|---|
| F-0401 5.0, BR-1 | a local trusted window, one folder `/w/p`, one candidate; `firstCheck` `proceed`; `readConfiguration` gives `workspaceFolder` `/workspaces/p`; context `undefined` | the calls in order: `firstCheck('/w/p')`, the candidate lookup, `readConfiguration`, `currentContext`; then exactly one `executeCommand('vscode.openFolder', <uri>, {forceNewWindow: false, forceReuseWindow: true})` whose authority is `dev-container+` and the hex of §3.1's JSON for `/w/p`, and whose path is `/workspaces/p` |
| F-0501 BR-2a | the same with context `ctx1` | the authority's payload decodes with `context: 'ctx1'` |
| F-0401 7.E5, AC-23 | (each) `remoteName` `dev-container`; `ssh-remote`; no folder; two folders; one folder with scheme `memfs` | no port called but the logger; nothing opened; the info line |
| F-0401 PRE-7 (interim) | an untrusted window | no port called but the logger; nothing opened |
| F-0201 5.0 step 3 | `firstCheck` resolves `stopped` | no lookup, no `readConfiguration`, nothing opened |
| F-0301 5.0 (interim) | (each) zero candidates; two candidates | nothing opened; the info line names the candidates; no dialog or notice |
| contracts §6 | `readConfiguration` gives `buildFailed` | nothing opened; a warn line with the kind |
| F-0401 BR-1 | the opener answers `rejected: 'x'` | a warn line naming `x` |
| F-0401 BR-7a | a second call while the first waits on `firstCheck` | the second calls nothing, and its info line is written; after the first ends, a third call runs again |
| contracts §6 (R-26) | the whole run | no argument passed to any port holds a secret (there are none to hold; the row checks that the opener received no token-like value) |

### 7.4 The manifest test (extends containers-01's)

| Cite | Expected |
|---|---|
| F-0401 3.1, F-1406 | the command's id, category and resolved title, exactly as §5 says; no keybinding |
| F-0401 BR-2, AC-5 | the `commandPalette` and `statusBar/remoteIndicator` entries, each with §5's exact `when` and group `remote_30_dev-container_2_actions@8` for the menu |

## 8. Open rows (for athena, on #766; build the default unless she rules otherwise first)

1. **Untrusted folder before C5.** The default: the command is hidden in Restricted Mode, and a keybinding does
   nothing (§4.2 step 3). The alternative is to bring C5's prompt into this card (a `TrustPort` over
   `workspace.requestWorkspaceTrust`, with the S265 message), which adds about half a day.
2. **No configuration, or several, before C4 and F-0801.** The spec has no slice-1 text for either. The default:
   nothing is shown, and an info line names the candidates. Showing a message would mean inventing a string (R-60).
3. **`hideConnectCommands` in `identifiers.json`.** If the identifiers tool doesn't accept an unprefixed
   `setter: extension` key, the builder stops and reports. The alternatives are a tool change, or leaving the clause
   out until a product sets it.

## 9. Catalogue

In `docs/architecture/catalogue/coverage-containers-r1.tsv`, if it's on main:
- **F-0401 AC-5 → `unit`** (§7.4's `when`; the palette's rendering is core's);
- **F-0401 AC-23 → `unit`** (§7.3's 7.E5 rows; the AC leaves the concrete UI untested).

The other F-0401 and F-0501 ACs of this flow (AC-1, AC-3, AC-15 and F-0501 AC-1 among them) need the connected
window. They're tagged by the gate-rows card (gate row 1). If the file isn't on main, list both in the PR.

## 10. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-coverage, check-licences, check-consumed (once tooling-31, #741, is on main) and
  coverage, with the changed files at 100 %.
- **PR title:** `remote-containers: Reopen in Container and the dev-container payload (card containers-07, #766)`.
- **Review:** themis or triton reviews; athena gives the design check, including §8's three rows.
