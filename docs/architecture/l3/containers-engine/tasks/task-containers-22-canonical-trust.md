# Task card containers-22: a folder dev container's trust is the local folder's

Issue: #921. Milestone 0.4, gating containers release 1 (athena's ruling, windows contracts §3.2 amended at
0b09a9e and again at ea31011). Size: M. Builder: `task:claude` (daedalus).

**Amended 2026-10-14 (athena on #921, comment after 6177675346).** Core asks for canonical URIs once, at workbench
start, in parallel with the resolve ([oss] `workspaceTrust.ts` `initializeWorkspaceTrust`), so a mapping that waits for
a held connection answers too late. The mapping is now async. For a window with no connection held, it answers from a
`readConfiguration` of the payload, memoized per payload and shared with the connect (§2.2 item 2).

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
     pathOf(uri: {authority: string; path: string}, decodedTarget: DecodedTarget): Promise<string | undefined>;
     warn(message: string): void;
   };
   ```

2. **`EditorResolver`** gains `canonicalPath?: (authority: string, path: string) => Promise<string | undefined>` (a
   property, so lint's `unbound-method` lets the editor adapter take it out of the object). In
   `registerResolver`, when `options.canonical` is set, the resolver handed to `editor.registerRemoteAuthorityResolver`
   gets:

   ```ts
   canonicalPath: async (authority, path) => {
     const decoded = decodeAuthority(authority);
     if (!('target' in decoded) || decoded.family !== options.family) {
       return undefined;
     }
     try {
       return await options.canonical.pathOf({authority, path}, decoded);
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
   getCanonicalURI: async uri => {
     if (uri.scheme !== 'vscode-remote') {
       return undefined;
     }
     const local = await resolver.canonicalPath?.(uri.authority, uri.path);
     return local === undefined ? undefined : editor.Uri.file(local);
   },
   ```

   When it's undefined, no `getCanonicalURI` property is set, so ssh-remote, WSL and tunnel windows don't change
   (contracts: "only for a family that gives one").

### 2.2 C10 (`packages/remote-containers/src/connect/connector.ts`, `register-connector.ts`)

1. **`Held`** gains three fields, set where `held` is built:
   - `payload: string`: the authority's payload, `input.rawHostString`;
   - `hostPath: string`: `folder.hostPath`;
   - `remoteWorkspaceFolder: string`: C7's `ready.remoteWorkspaceFolder`, the CLI's result line (ADR-0009). It's
     not re-derived from the git-root mount or `workspaceMount` (athena's ruling).
2. **The configuration read, memoized per payload** (athena's ruling, ea31011):
   - `connector.ts` gains a private `Map<string, Promise<ConfigurationRead>>` keyed by the payload. Its entry is the
     promise of one `bridge.readConfiguration(cliTargetOf(folder, configFile, dockerPath), undefined, …)` for the
     payload's folder, `configFile`, settings and Docker context. `ConfigurationRead` is the read's result, or
     `undefined` after a failure.
   - **Whichever comes first starts it**, the canonical request or the connect, and the other one awaits the same
     promise. The connect's own `readConfiguration` (connector.ts, after `prepare`, for the `name`) is replaced by this
     read, so there's no second CLI run. It no longer passes the container id. Only `name` and `workspaceFolder` are
     used, and both come from `devcontainer.json`.
   - **The bridge and the target** come from one function shared by `connectFresh` and the memo (the same `cliFor`
     environment with `DOCKER_CONTEXT`, the same `dockerPath`), so both reads would be identical.
   - **A failed read** (any `CliFailure`) gives `undefined` and one warn: `the configuration of <hostPath> could not be
     read: <kind>`. It's the read's one warn, shared by the canonical request and the connect, and it replaces the
     connect's old `the configuration's name could not be read` line. **The cap:** the canonical request waits at most 30 s
     (`CANONICAL_READ_MILLISECONDS = 30_000`, through `dependencies.setTimer`) and then answers `undefined`. The read
     itself goes on for the connect.
   - A failed read is dropped from the memo once settled, so a reconnect reads again. A successful one is kept for
     the window's life (a window has one payload).
   - **Nothing in the read runs repository code** (read-configuration doesn't run `initializeCommand` or build), so
     it's safe before trust.
3. **`ContainerConnector`** gains:

   ```ts
   /** The local path a URI of this window's container folder stands for (F-0106 6.11); nothing otherwise. */
   canonicalPathOf(authority: string, path: string): Promise<string | undefined>;
   ```

   - The payload is `authority` without `dev-container+`. A payload that doesn't decode to a folder target gives
     `undefined`.
   - **Held for this payload:** the root and `hostPath` come from `held`, as below.
   - **Nothing held:** the root is the memoized read's `workspaceFolder`, and `hostPath` is the payload's. A read that
     failed or passed the cap gives `undefined`.
   - `path === <root>` gives `<hostPath>`.
   - `path.startsWith(<root> + '/')` gives `<hostPath> + path.slice(<root>.length)`.
     The rest keeps its `/` separators. Release 1 is Linux and macOS, so a host path is POSIX.
   - Anything else gives `undefined`, including a sibling such as `<folder>-other`.
   - **Each mapped answer logs one line at debug:** `the canonical path of <path> is <local> (from the configuration
     read)`, or `(from the connection)` when held. The authority isn't in the line, because lib-log redacts payloads.
     T1 reads it.
4. **`register-connector.ts`:** `registerResolver`'s options gain `canonical: {pathOf: uri =>
   connector.canonicalPathOf(uri.authority, uri.path), warn: message => served.logger.warn(message)}`. `ConnectorServed`
   gains `logger: Logger`, which `extension.ts` passes.
5. **Nothing else changes.** `Connected.trusted` stays `false` (F-0106 6.11: "NOT forced"), and core reads the local
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
| `contracts §3.2: a mapping that rejects answers nothing and warns` | `pathOf` rejects with `boom` | `undefined`; one `warn` naming the authority, the path and `boom` |
| `contracts §3.2: the mapping may answer later` | `pathOf` settles after a tick | `canonicalPath` resolves to its answer |

### 4.2 `lib-authority/test/unit/vscode-resolver.test.ts`

| Name | Expected |
|---|---|
| `contracts §3.2: getCanonicalURI gives the local file URI of the mapped path` | a `vscode-remote` URI mapped to `/home/u/p`: `Uri.file('/home/u/p')` |
| `contracts §3.2: a URI the mapping doesn't know gives undefined` | `undefined` |
| `contracts §3.2: a file URI isn't asked` | scheme `file`: `undefined`; `canonicalPath` not called |
| `contracts §3.2: getCanonicalURI waits for an async mapping` | `canonicalPath` settles after a tick with `/home/u/p`: `Uri.file('/home/u/p')` |
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
| `contracts §3.2: register-connector passes the mapping and the log` | the recording editor's `canonicalPath` reaches `canonicalPathOf`, and a rejection from it is warned |
| `contracts §3.2 (T0): with no connection held, the answer comes from the read alone` | no connect yet; the fake CLI's read gives `workspaceFolder` `/workspaces/proj` | `('dev-container+abc', '/workspaces/proj/a')` gives `/home/u/proj/a`; one `readConfiguration`; no `prepare` |
| `contracts §3.2: the canonical request and the connect share one read` | the canonical request first, then `connect` | one `readConfiguration` in all; the connect's `name` comes from it |
| `contracts §3.2: the connect first, then the canonical request` | `connect` starts, and the canonical request comes while `prepare` is pending | one `readConfiguration`; the answer comes before `prepare` settles |
| `contracts §3.2: a failed read answers nothing and warns, and the next request reads again` | the read fails `cliFailed` once, then succeeds | first `undefined` with the warn line; the second request reads again and maps |
| `contracts §3.2: the canonical request gives up after 30 s` | the read never settles; fire the timer | `undefined`; `setTimer` got 30000 |
| `contracts §3.2: a held connection wins over the read` | held `remoteWorkspaceFolder` `/srv/app`, read `workspaceFolder` `/workspaces/proj` | `/srv/app/x` maps; `/workspaces/proj/x` doesn't |

### 4.4 Acceptance (`tests/acceptance/containers-trust/`, containers-12's launch, after its rows)

| # | Steps | Assertions |
|---|---|---|
| T1 | As containers-12's row 11 accepts trust: open untrusted window `gate-trust-held`, run Reopen, answer `Trust Folder & Continue`, and wait until connected | the window's log has the debug line `the canonical path of <path> is <local> (from the configuration read)` before C10's `container … was` line (T0: the answer came with no connection held); `isTrusted('gate-trust-held')` is `true` in the connected window, and the status bar has no `status.workspaceTrust` item (F-0106 6.11: "once trusted, the connected window shows no `status.workspaceTrust` item") |
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

1. **T1 still reports `false` with the mapping in place.** First check T0's log line: an answer that came after the
   connect means the memo isn't shared as §2.2 item 2 says. That would mean core doesn't consult `getCanonicalURI` for
   this window's trust. Report what `workbench.trust.manage` shows for the window. Don't add `Connected.trusted`
   instead: that's "forced" trust, which F-0106 6.11 rules out for folder dev containers.
2. **`decodeAuthority`'s result** doesn't distinguish a malformed payload the way §2.1 item 2 assumes: use its own
   discriminant, and say so in the PR.
