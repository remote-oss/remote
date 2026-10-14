# Task card coverage-32: a remote-internal command in a fresh window, and the Alpine host's prerequisites

Issue: #715. Why: the 0.2 gate's acceptance rows, for two ACs that fit no other card:
- **F-2202 AC-24** (`remote-oss/remote-ssh#29`): a keybinding runs `remote-internal.getConfiguredHostnames` in a window
  where Remote - SSH isn't active yet. The extension activates and changes nothing;
- **F-2401 AC-2** (`#46`): an Alpine host with libstdc++ and libgcc connects with no prerequisite message. The harness
  host is that host (`tests/acceptance/host/Dockerfile`: alpine:3.22 with `libstdc++`, which pulls in `libgcc`).

F-2202 AC-23 is `deferred` (§5). Builder: selene. Size: S, about half an agent-day.

## 1. F-2202 AC-24 (`tests/acceptance/windows/fresh-window.test.ts`, window `fr1`)

**The agent's state** gains `remoteSshActive`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.isActive ??
false`. coverage-19 (#590) adds the same field. If it has merged, use it; if not, add it here with that definition,
and tell hestia on #590. The harness carries it too: `AgentEvent` (`windows/harness.ts`) gains
`remoteSshActive?: boolean`, and `windowState()`'s answer includes it. coverage-23 (#602) is a third user.

**Before the row**, keep:
- the bytes of `<run>/ssh_config` (`variable('HARNESS_SSH_CONFIG')`) and of `<run>/user-data/User/settings.json`;
- the entries of `<run>/user-data/User/globalStorage/remote-oss.remote-ssh`, recursively with sizes, or "missing";
- the name, size and mtime of the account's `~/.ssh/config` (`os.userInfo().homedir`), or "missing". Never read its
  contents.

**The steps:**
1. Make the folder `<run>/fr1`. In `local`, run `acceptance.agent.openWindow` on its `file://` URI, and wait for the
   window `fr1` to activate its agent.
2. Read `windowState('fr1')`.
3. Run `inWindow('fr1', 'remote-internal.getConfiguredHostnames')`. A keybinding calls `executeCommand` the same way.
4. Read `windowState('fr1')` again.
5. Run `inWindow('fr1', 'acceptance.agent.writeFile', 'usable.txt', 'usable')`.

**Assertions:**
- after step 2, `remoteName` is null and `remoteSshActive` is false;
- step 3 resolves;
- after step 4, `remoteSshActive` is true;
- the four things kept before the row are unchanged: the two files byte for byte, the folder's entries, and the
  account file's name, size and mtime;
- step 5 resolves, and `<run>/fr1/usable.txt` holds `usable`.

Then close `fr1`.

The row's name is `F-2202 AC-24: a keybinding's remote-internal.getConfiguredHostnames activates the extension in a
fresh window and changes nothing`.

## 2. F-2401 AC-2 (`tests/acceptance/suite-remote/remote-window.test.ts`)

A row in the run's first remote launch, beside the install rows. Its name is `F-2401 AC-2: the Alpine host with
libstdc++ and libgcc connected with no prerequisite message`. Assert:
- `onHost('cat', '/etc/alpine-release')` is a version (`/^\d+\.\d+/`);
- `onHost('apk', 'info', '-e', 'libstdc++', 'libgcc')` lists both names;
- `vscode.env.remoteName` is `ssh-remote`;
- no record line's `question` contains `prerequisites` (S144 and S145 both do);
- no line of `connectionLog()` contains `prerequisites`.

## 3. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2202 AC-24 and F-2401 AC-2 go from `todo` to `acceptance`.

**Halves that rest on unit rows** (name them in the PR): AC-24's "no engine object is created", which is F-2006's R-46
safety rows on the `remote-internal.*` handlers.

## 4. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with the new rows. Paste the `remote` and
`windows` summaries.

## 5. Open rows (stop and report on #715)

1. **F-2202 AC-23** isn't in this card. athena ruled it `deferred`, "the Remotes view is remote-explorer's" (the
   F-2202 AC-20 precedent; the catalogue sweep #706 tags it), so no fresh-profile launch is built for it.
2. `remoteSshActive` is already true in `fr1` before step 3: something else activated the extension. Report the
   window's extension-host log.

## 6. Review

PR title `tests: a remote-internal command in a fresh window, and the Alpine host's prerequisites (card coverage-32,
#715)`. themis or triton reviews; athena gives the tag check.
