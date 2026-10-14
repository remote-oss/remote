# Task card coverage-32: a remote-internal command in a fresh window, and the Alpine host's prerequisites

Issue: #715. Why: the 0.2 gate's acceptance rows, for two ACs that fit no other card:
- **F-2202 AC-24** (`remote-oss/remote-ssh#29`): a keybinding runs `remote-internal.getConfiguredHostnames` in a window
  where Remote - SSH isn't active yet. The extension activates and changes nothing;
- **F-2401 AC-2** (`#46`): an Alpine host with libstdc++ and libgcc connects with no prerequisite message. The harness
  host is that host (`tests/acceptance/host/Dockerfile`: alpine:3.22 with `libstdc++`, which pulls in `libgcc`).

F-2202 AC-23 needs harness work first (§5). Builder: selene. Size: S, about half an agent-day.

## 1. F-2202 AC-24 (`tests/acceptance/windows/fresh-window.test.ts`, window `fr1`)

**The agent's state** gains `remoteSshActive`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.isActive ??
false`. coverage-19 (#590) adds the same field. If it has merged, use it; if not, add it here with that definition,
and tell hestia on #590.

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

1. **F-2202 AC-23** stays `todo`, and goes on #142's harness list. It needs three things the run doesn't have:
   - a launch with a fresh profile: its own user-data folder, where no earlier launch has written settings or global
     state;
   - a reader of the extension's global state: the `ItemTable` row of `remote-oss.remote-ssh` in the profile's
     `globalStorage/state.vscdb`, read after the editor has flushed it;
   - the Remotes view, which is remote-explorer's in 0.2. Whether that half is `deferred` (as F-2202 AC-20 and AC-33
     are) is a tag question for athena, in the next design batch.
2. `remoteSshActive` is already true in `fr1` before step 3: something else activated the extension. Report the
   window's extension-host log.

## 6. Review

PR title `tests: a remote-internal command in a fresh window, and the Alpine host's prerequisites (card coverage-32,
#715)`. themis or triton reviews; athena gives the tag check.
