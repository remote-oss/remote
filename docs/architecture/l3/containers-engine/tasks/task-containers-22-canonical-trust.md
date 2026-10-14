# Task card containers-22: a folder dev container's trust is the local folder's

Issue: #921. Milestone 0.4, gating containers release 1 (athena's ruling, windows contracts §3.2 amended at
0b09a9e). Size: S–M. Builder: `task:claude`.

Sources:
- F-0106 (remote-oss/remote-containers#46): 6.11's folder dev-container row, 6.12, AC-39, AC-41 and AC-42;
- windows contracts §3.2, the row "on each core canonical-URI request";
- [oss] `src/vs/workbench/services/workspaces/common/workspaceTrust.ts` (`getCanonicalUri`) and
  `src/vscode-dts/vscode.proposed.resolvers.d.ts` (`RemoteAuthorityResolver.getCanonicalURI`);
- containers-08 (C10, `packages/remote-containers/src/connect/connector.ts`);
- containers-12 (#882, C5 and its `containers-trust` launch).

**Unit parts:** build now. **Acceptance rows (§4.4):** build after containers-12 is on main, since they run in its
`containers-trust` launch.

## 1. The defect

F-0106 6.11: for a folder dev container (Reopen, Open Folder, the rebuild-and-reopen commands, the recent entry), "the
window's trust is the local folder's entry in core's trusted-folder list". Core decides a remote window's trust by
asking the resolver for the canonical URI of each workspace folder and file. lib-authority's resolver gives none
(`vscode-resolver.ts`, `editorResolverOf`). So the container window's workspace,
`vscode-remote://dev-container+<hex>/workspaces/<name>`, has no trusted entry. The result:
- **Reopen:** after a trusted Reopen, the container window opens in Restricted Mode.
- **Open Folder:** the post-reload request (F-0106 6.3) would trust the remote URI, not the local folder.

## 2. The design (windows contracts §3.2, as amended)

### 2.1 lib-authority

1. **`ResolverOptions`** (`resolver/host.ts`) gains:

   ```ts
   /**
    * The family's canonical mapping, registered as the resolver's `getCanonicalURI` (windows contracts §3.2): the local
    * path a `vscode-remote` URI of this window stands for, or nothing. `warn` logs a mapping that threw.
    */
   canonical?: {
     pathOf(uri: {authority: string; path: string}, decodedTarget: DecodedTarget): string | undefined;
     warn(message: string): void;
   };
   ```

2. **`EditorResolver`** gains `canonicalPath?(authority: string, path: string): string | undefined`. In
   `registerResolver`, when `options.canonical` is set, the resolver handed to `editor.registerRemoteAuthorityResolver`
   gets:

   ```ts
   canonicalPath: (authority, path) => {
     const decoded = decodeAuthority(authority);
     if (!('target' in decoded) || decoded.family !== options.family) {
       return undefined;
     }
     try {
       return options.canonical.pathOf({authority, path}, decoded);
     } catch (caught) {
       options.canonical.warn(`the canonical URI of ${authority}${path} could not be mapped: ${String(caught)}`);
       return undefined;
     }
   },
   ```

   Use `decodeAuthority`'s result shape as `registry.ts` gives it; the check above is "decoded, and of this family".
   When `options.canonical` is unset, the resolver has no `canonicalPath`.
3. **`vscode-resolver.ts`, `editorResolverOf`:** when `resolver.canonicalPath` is defined, the editor resolver gets:

   ```ts
   getCanonicalURI: uri =>
     uri.scheme !== 'vscode-remote' ? undefined : (() => {
       const local = resolver.canonicalPath?.(uri.authority, uri.path);
       return local === undefined ? undefined : editor.Uri.file(local);
     })(),
   ```

   When it's undefined, no `getCanonicalURI` property is set, so ssh-remote, WSL and tunnel windows don't change
   (contracts: "only for a family that gives one").

### 2.2 C10 (`packages/remote-containers/src/connect/connector.ts`, `register-connector.ts`)

1. **`Held`** gains three fields, set where `held` is built:
   - `payload: string`: the authority's payload, `input.rawHostString`;
   - `hostPath: string`: `folder.hostPath`;
   - `remoteWorkspaceFolder: string`: C7's `ready.remoteWorkspaceFolder`, the CLI's result line (ADR-0009). It's
     not re-derived from the git-root mount or `workspaceMount` (athena's ruling).
2. **`ContainerConnector`** gains:

   ```ts
   /** The local path a URI of this window's container folder stands for (F-0106 6.11); nothing otherwise. */
   canonicalPathOf(authority: string, path: string): string | undefined;
   ```

   - It returns `undefined` when nothing is held, or when `authority !== 'dev-container+' + held.payload`.
   - `path === held.remoteWorkspaceFolder` gives `held.hostPath`.
   - `path.startsWith(held.remoteWorkspaceFolder + '/')` gives `held.hostPath + path.slice(held.remoteWorkspaceFolder.length)`.
     The rest keeps its `/` separators. Release 1 is Linux and macOS, so a host path is POSIX.
   - Anything else gives `undefined`, including a sibling such as `<folder>-other`.
3. **`register-connector.ts`:** `registerResolver`'s options gain `canonical: {pathOf: uri =>
   connector.canonicalPathOf(uri.authority, uri.path), warn: message => logger.warn(message)}`.
4. **Nothing else changes.** `Connected.trusted` stays `false` (F-0106 6.11: "NOT forced"), and core reads the local
   folder's entry through the mapping.

## 3. Files

| File | What |
|---|---|
| `packages/lib-authority/src/resolver/host.ts` | §2.1 items 1 and 2 |
| `packages/lib-authority/src/resolver/vscode-resolver.ts` | §2.1 item 3 |
| `packages/lib-authority/src/testing/recording-resolver-editor.ts` | records the `canonicalPath` it was registered with, so rows can call it |
| `packages/remote-containers/src/connect/connector.ts`, `register-connector.ts` | §2.2 |
| the tests of §4 | |

## 4. Rows

### 4.1 `lib-authority/test/unit/resolver-host.test.ts`

| Name | Given | Expected |
|---|---|---|
| `contracts §3.2: a family with a mapping registers canonicalPath` | `canonical` set | the registered resolver has `canonicalPath` |
| `contracts §3.2: a family without one registers none` | no `canonical` (the ssh-remote options) | no `canonicalPath` |
| `contracts §3.2: the mapping gets the decoded target of this family` | `canonicalPath('dev-container+7b7d', '/workspaces/x')` | `pathOf` got `{authority, path}` and the decoded `dev-container` target; its answer is returned |
| `contracts §3.2: another family's authority maps to nothing` | `canonicalPath('ssh-remote+h', '/x')` | `undefined`; `pathOf` not called |
| `contracts §3.2: a malformed authority maps to nothing` | an authority whose payload doesn't decode | `undefined`; `pathOf` not called |
| `contracts §3.2: a mapping that throws answers nothing and warns` | `pathOf` throws `boom` | `undefined`; one `warn` naming the authority, the path and `boom` |

### 4.2 `lib-authority/test/unit/vscode-resolver.test.ts`

| Name | Expected |
|---|---|
| `contracts §3.2: getCanonicalURI gives the local file URI of the mapped path` | a `vscode-remote` URI mapped to `/home/u/p`: `Uri.file('/home/u/p')` |
| `contracts §3.2: a URI the mapping doesn't know gives undefined` | `undefined` |
| `contracts §3.2: a file URI isn't asked` | scheme `file`: `undefined`; `canonicalPath` not called |
| `contracts §3.2: no mapping, no getCanonicalURI` | the editor resolver has no `getCanonicalURI` property |

### 4.3 `remote-containers/test/unit/connector.test.ts`

| Name | Given (a held connection: payload `abc`, hostPath `/home/u/proj`, remoteWorkspaceFolder `/workspaces/proj`) | Expected |
|---|---|---|
| `F-0106 6.11: the workspace folder maps to the local folder` | `('dev-container+abc', '/workspaces/proj')` | `/home/u/proj` |
| `F-0106 6.11: a file under it maps under the local folder` | `('dev-container+abc', '/workspaces/proj/src/a.ts')` | `/home/u/proj/src/a.ts` |
| `F-0106 6.11: a sibling path doesn't map` | `('dev-container+abc', '/workspaces/proj-other')` | `undefined` |
| `F-0106 6.11: a path outside doesn't map` | `('dev-container+abc', '/etc/hosts')` | `undefined` |
| `contracts §3.2: another window's authority doesn't map` | `('dev-container+def', '/workspaces/proj')` | `undefined` |
| `contracts §3.2: nothing held maps nothing` | before the first connect | `undefined` |
| `contracts §3.2: a configured workspaceFolder is the CLI's` | the CLI's result gives `/srv/app` | `/srv/app/x` maps to `/home/u/proj/x` |
| `contracts §3.2: register-connector passes the mapping and the log` | the recording editor's `canonicalPath` reaches `canonicalPathOf`, and a throw from it is warned |

### 4.4 Acceptance (`tests/acceptance/containers-trust/`, containers-12's launch, after its rows)

| # | Steps | Assertions |
|---|---|---|
| T1 | As containers-12's row 11 accepts trust: open untrusted window `gate-trust-held`, run Reopen, answer `Trust Folder & Continue`, and wait until connected | `isTrusted('gate-trust-held')` is `true` in the connected window, and the status bar has no `status.workspaceTrust` item (F-0106 6.11: "once trusted, the connected window shows no `status.workspaceTrust` item") |
| T2 | In T1's connected window, run `workbench.trust.manage`. The editor's text (the renderer's `document.body.innerText`) holds `You trust this folder` and a `Don't Trust` button (F-0106 AC-39: trust not forced). Click `Don't Trust` through the renderer (`answerDialog` won't do, since it's an editor: add `clickButton(name, label)` to `renderer.ts`, finding a `.monaco-button` by its exact text in the active editor). Then `reloadWindow` and wait until connected | after the reload, `isTrusted` is `false` (athena's ruling: untrusting the local folder makes the container window restricted on its next reload). F-0106 AC-41 and AC-42 (the reconnect asking for trust, and S360/S377 on Cancel) are the resolver-side request of containers-17, so they aren't this row's |

**On main without this card,** T1 fails: the connected window reports `isTrusted` `false`.

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`acceptance`, after T1 and T2:** F-0106 AC-39. Until containers-12 lands, it stays `todo`.
- **`todo`, for containers-17:** F-0106 AC-41 and AC-42, the resolver-side trust request after "Don't Trust" and its
  S360/S377 decline.
- **`unit`:** none of their own; §4.1 to §4.3 cite the contract.

## 6. Gates and review

Run all gates and the VSCodium run. The PR title is `lib-authority, remote-containers: a folder dev container's trust is
the local folder's, through getCanonicalURI (card containers-22, #921)`. Request athena only; hermes assigns the peer.

## 7. Open rows (stop and report on #921)

1. **T1 still reports `false` with the mapping in place.** That would mean core doesn't consult `getCanonicalURI` for
   this window's trust. Report what `workbench.trust.manage` shows for the window. Don't add `Connected.trusted`
   instead: that's "forced" trust, which F-0106 6.11 rules out for folder dev containers.
2. **`decodeAuthority`'s result** doesn't distinguish a malformed payload the way §2.1 item 2 assumes: use its own
   discriminant, and say so in the PR.
