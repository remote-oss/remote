# Task card containers-41: F-0503's server install rows and tags (containers release 1)

Issue: #1050. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude` (iris). Then
F-0502 comes in a card of its own, in the same form.

**What this card is:** every F-0503 line of `docs/architecture/catalogue/coverage-containers-r1.tsv` that is `todo`
(43 today) ends with a final tag, and every criterion this release builds gets the row that proves it. Each tag is a
judgement against the criterion's text, made by the rules below. Product code changes only where a row shows that
the product misses the spec **and** the fix is inside one component's existing contract; anything else is an open
row (§6).

Sources: F-0503 (remote-oss/remote-containers#34), all of it; F-1402 (the server source; its decision wins over
F-0503 where they differ, brief ruling 3); the brief `brief-release-1.md` §2 (the cut) and §3 rulings 1–4 and 11;
`contracts.md` (this folder) and the transport contracts §5.0 (the remote-containers policy row) and §5 V4 and V9;
card containers-08 §3.3–§3.5 (C10's install path), containers-21 (the requirements check), containers-25 (the
volume's shared folders), containers-27 (the umask).

## 1. The method

For each F-0503 `todo` line, in file order, read the criterion in the spec issue and give it exactly one tag, by the
first rule that applies:

| Tag | When | Reason column |
|---|---|---|
| `deferred` | it needs a feature the brief's §2 cut leaves out (attach, Compose, volumes, remote engines, Windows/WSL/macOS, Features) | the cut's form, e.g. `containers release 1: later (attach)`, as the file's existing lines write it |
| `core` | what it checks is the editor's own behaviour that this release only triggers (the Settings UI's inline URL error of a setting core validates, a quick pick core draws) | `core: <the part, in a few words>` |
| `acceptance` | a row in `tests/acceptance/containers*/` cites it, and the row asserts what the criterion says, as our decisions read it (§2) | empty |
| `unit` | a unit row cites it, and what it checks is decided by our code alone, without the editor, the engine or the CLI | empty |
| `todo` | none of the above yet: write the row (§3), then tag it | — |

A criterion that an existing row proves but doesn't cite gets the cite: add its `F-0503 AC-n` to the start of the
row's name (keep the rest of the name; `check-coverage` reads the cites before the first colon). Don't duplicate a row
to give a criterion its own.

## 2. How our decisions read F-0503 (no judgement left here)

The criteria were written against the reference. Read them through these, and cite the ruling in the row's name
when it changes what is asserted:

1. **The server's names come from the running editor's product.json** (ADR-0006, F-1401, F-1402). Where a criterion
   names `vscode-server`, `.vscode-server`, `.vscode-server-insiders` or `code`, the row asserts the name lib-product
   derives: `volumeServerFolder(applicationName)` for the volume folder (`codium-server` for VSCodium; the shared
   `vscode-server` only for `code` and `code-insiders`), and `serverDataFolderNameOrDefault(profile)` for the home
   folder. The run's editor is VSCodium, so the rows assert the VSCodium names.
2. **The source is F-1402's** (brief ruling 3): the override `remote.serverDownloadBaseUrl`, then the product's
   template, then the built-in table on `applicationName`. A criterion that expects
   `https://update.code.visualstudio.com` as the default (AC-27) is tested against F-1402's order instead, as a unit
   row: with no override, `resolveServerArchive` gives the built-in table's address for `codium`. Add the cite to the
   existing row of `packages/lib-product/test/unit/resolve.test.ts` that proves it, as `F-0503 AC-27 (F-1402 rule 4)`,
   and tag it `unit`. No acceptance row clears the override: the containers launch sets it to the run's download host
   (`${HARNESS_DOWNLOADS_LOCAL}/ok`), and the built-in table's host is on the internet.
3. **The policy row** (transport contracts §5.0): `clientOnly`, `cache: kept`, `verification: none`,
   `requirementsCheck: serverBundled`, `installMode: singleScript`, `cleanup: onlyCurrentKeepLeftovers`. A criterion
   that assumes another cell is an open row (§6), not a test change.
4. **Telemetry is off** for every server start (R-28, brief ruling 11).
5. **Redirects and credentials** follow server-22 and server-23 (#1036, #1037) once they merge; until then, no row
   asserts a cross-host redirect or a 401.
6. **AC-45 is an `acceptance` row of this card** (athena on #1052): with `remoteEnv` setting `HOME`, the server
   folder stays under the remote user's passwd home, and the `HOME` path isn't made. It holds today, and it must
   keep holding after the server-environment card (#1059) merges; the row is what proves it.
7. **Interrupted installs** (AC-23, AC-25): lib-server's install script writes `<commit>_<epoch-ms>` and renames it;
   assert the names it writes (`packages/lib-server/src/scripts/`), not the reference's.

## 3. Writing the rows

- **Acceptance rows** go in `tests/acceptance/containers/server-install.test.ts` (new),
  `describe('F-0503 server install (card containers-41)')`, `this.timeout(900_000)`. Use the helpers of
  `tests/acceptance/windows/` that `gate.test.ts`, `workspace-mount.test.ts` and `recovery.test.ts` use; write no
  helper that duplicates one, and add a shared helper to `windows/` only when two files need it.
- **Folder names** start `c41-`. Each row removes its containers in `finally` (`removeContainers`), and the volume
  folders or archive files it made.
- **A row that needs an empty `vscode` volume tree** for its `{platform, commit}` empties only that commit's folder
  inside the volume (`docker run --rm -v vscode:/vscode <HARNESS_DEVCONTAINER_IMAGE> rm -rf <tree>`), never the volume,
  which other rows share.
- **A row that needs a download** uses the launch's own source: the containers launch sets
  `remote.serverDownloadBaseUrl` to `${HARNESS_DOWNLOADS_LOCAL}/ok`, the run's download host. A row that needs a
  failing source points the override at another first segment of the same host (`tools/acceptance-downloads.ts`:
  `missing` 404, `busy` 503, `junk`, `hang`, `cut`, `slow`), and restores the launch's value in `finally`
  (`setUserSetting`). The host logs every request (`<run>/downloads/requests.log`), which is how a row proves that
  nothing was downloaded. No row reaches the internet.
- **Unit rows** go next to the code they prove (`packages/lib-server/test/unit/`, `packages/remote-containers/test/
  unit/`), in the existing file of that code.
- **Measure before you assert.** Run the row against main first and read what the product does. If it matches the
  criterion as §2 reads it, assert it. If not, it's an open row (§6).

## 4. PRs

Split by subject so each PR stays reviewable: (a) the cache, the volume tree and the symlink (AC-1 to AC-7, AC-12,
AC-13, AC-33, AC-34); (b) the download, its settings and failure (AC-19 to AC-21, AC-26 to AC-28, AC-43); (c) the
requirements check, the platforms, progress, interrupts and the rest. Each PR moves only its own lines of the
coverage file, to keep the PRs apart. PR titles: `tests: F-0503's <subject> rows (card containers-41, #1050)`.
Request athena only; hermes assigns the peer.

## 5. Gates

All gates; the changed files at 100 %; `node tools/check-coverage.ts` green; the `containers` launch locally
(`docker ps` first, and remove your leftovers after).

## 6. Open rows (stop that criterion, report it on the issue, carry on with the others)

1. The product's behaviour differs from the criterion as §2 reads it. Post the row, its output and the criterion.
   daedalus decides between a product fix (a card), a spec question (athena), or a `deferred`.
2. A criterion needs a harness capability that `tests/acceptance/windows/` lacks (for example a workspace-file window,
   or two commands in flight at once in one window). Report it; daedalus adds the capability.
3. A criterion is ambiguous under §1's rules. Post your reading and the alternative; don't pick one silently.
