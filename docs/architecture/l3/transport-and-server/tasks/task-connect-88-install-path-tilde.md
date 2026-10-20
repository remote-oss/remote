# Task card connect-88: `remote.SSH.serverInstallPath` accepts `~` and `~/…` (D-99, #1277)

Release 0.2. Size: S. Priority: high (a user hit it). Builder: `task:claude`. Design: athena's design check on #1277
(D-99), option (b) of daedalus's ruling there. Everything is decided here. If what you find differs, comment on #1277
and stop.

## 1. The rule (D-99)

A per-host value of `remote.SSH.serverInstallPath` is accepted when it is one of:
- `/` followed by BR-3's characters (as today);
- `~` alone;
- `~/` followed by BR-3's characters.

BR-3's characters are ASCII letters and digits, `/`, `-`, `_`, `.` and the space. A `~` anywhere else stays invalid
(`~x`, `~user/x`, `/a/~/b`, `~~`), as does everything else F-2407 AC-7 and AC-8 refuse, with the same dialog. `~`
means the remote user's home: the data folder for `~/inst` is `$HOME/inst/<data folder name>`.

## 2. What's on main

- `packages/remote-ssh/src/pipeline/host-settings.ts:44`: `INSTALL_FOLDER = /^\/[A-Za-z0-9/_. -]*$/`.
  `installFolderFor` keeps the value as written. `checkInstallFolder` (`server-steps.ts`) raises the dialog for
  `invalid`.
- **The plan already expands it:** `packages/lib-server/src/install/plan.ts` `expandHome` turns `~` and `~/x` into
  the probe's home, and its unit rows cover both (`bootstrap-script-probe-install.test.ts`, "installPathSetting
  '~/srv'").
- **The host script doesn't:** `parameters.ts` passes the value as written as `installRoot`. `bootstrap.ts` quotes it
  into `INSTALL_ROOT='~/inst'`, and `posix-script.ts` sets `DATA_ROOT=${INSTALL_ROOT:-$HOME}`. A quoted `~` doesn't
  expand, so today's script would install into a folder literally named `~` under its working folder. That's why the
  script changes too.

## 3. The change

1. **`host-settings.ts`:** `INSTALL_FOLDER` becomes `/^(?:\/[A-Za-z0-9/_. -]*|~|~\/[A-Za-z0-9/_. -]*)$/`. Update the
   comments of the constant and of `installFolderFor` to say a value may also be `~` or start with `~/`, which means
   the remote user's home. `installFolderFor` still keeps the value as written.
2. **`posix-script.ts`:** after the parameter block and before `DATA_ROOT=…`, expand a leading `~` against `$HOME`.
   Insert these lines exactly where `DATA_ROOT=${INSTALL_ROOT:-$HOME}` is now:
   ```sh
   case $INSTALL_ROOT in
     '~') INSTALL_ROOT=$HOME ;;
     '~/'*) INSTALL_ROOT=$HOME/${INSTALL_ROOT#'~/'} ;;
   esac
   DATA_ROOT=${INSTALL_ROOT:-$HOME}
   ```
   Every other value is used as written, as now. Check that it runs under `dash` and busybox `ash` (the unit runner's
   `sh`, and the alpine host).
3. **Nothing else changes.** The dialog for an invalid value, `plan()`, and the log lines stay as they are. Windows
   hosts don't take this path (F-2407 is POSIX for remote-ssh).

## 4. Rows

**Unit:**
- `packages/remote-ssh/test/unit/host-settings.test.ts`, in "the install folder setting":
  - `F-2407 AC-7 (ruling-1277-tilde): "~" and "~/My_Servers-1.0" are used as written`, which gives
    `{kind: 'folder', folder: …}` for both;
  - extend the refused loop with `'~x'`, `'~user/x'`, `'/a/~/b'`, `'~~'` and `'~/a(b)'`. Those rows keep their
    `F-2407:` names.
- `packages/lib-server/test/unit/bootstrap-script-probe-install.test.ts`: with `installRoot: '~/srv'` and with
  `installRoot: '~'`, the probe reports the install folder under the fake host's home (`<home>/srv/<data folder
  name>/bin/<commit>` and `<home>/<data folder name>/bin/<commit>`, read from the same fact the existing custom-root
  rows read). A third row, `installRoot: '/a/~/b'` as written, stays literal. Name them
  `F-2407 AC-7 (ruling-1277-tilde): …`.

**Acceptance:** add one case to `tests/acceptance/suite-install/cases.json`, beside `install-path`:
```json
{
  "label": "install-tilde-path",
  "cite": "F-2407 AC-7 (ruling-1277-tilde)",
  "settings": {
    "remote.SSH.serverDownloadUrlTemplate": "${HARNESS_DOWNLOADS_HTTP}/ok/${os}-${arch}/${commit}",
    "remote.SSH.serverInstallPath": {"harness": "~/inst"}
  },
  "outcome": "connected",
  "installedIn": "/home/harness/inst/.vscodium-server-insiders"
}
```
Copy `install-path`'s other fields if it has any you don't see here. The launch is `install-install-tilde-path`.
Update any test or list that enumerates the install launches (`tools/acceptance-launches.test.ts` and the README's
list, if present).

**Release notes:** add to `docs/architecture/l3/transport-and-server/release-0.2-notes.md`, under "Deviations", in
the form of the entries there:
- **`remote.SSH.serverInstallPath` accepts `~` and a path that starts with `~/`**, meaning the remote user's home.
  - F-2407 AC-7 describes the reference refusing such a value with "Provided: …". Ours installs under the home
    folder, and every other value that doesn't start with `/` is still refused (athena on #1277, D-99; spec question
    on remote-oss/remote-ssh#52).

**Coverage:** F-2407 has no coverage file line yet. `node tools/check-coverage.ts` must still pass with the new
cites. If it refuses `F-2407 AC-7 (ruling-1277-tilde)`, comment here with its message and stop.

## 5. Done when

- The unit rows pass, with `host-settings.ts` and `posix-script.ts` at their gates.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches install-install-tilde-path,install-install-path`
  passes. Paste the summary line.
- The whole diff is linted, and `pnpm dupes`, `pnpm dead`, `node tools/check-coverage.ts` and typecheck are clean.
- PR title: `remote-ssh, lib-server: serverInstallPath accepts ~ and ~/… (card connect-88, #1284)`. Request athena
  only. The queue rule applies: open the PR once fewer than 10 are open, and tell hermes if it's waiting.
