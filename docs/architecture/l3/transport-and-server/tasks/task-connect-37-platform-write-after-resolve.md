# Task card connect-37: the connect doesn't wait for the platform setting's write

Issue: #664. Release 0.2, gating (athena): it comes first in the queue. Builder: iris or hestia. Size: S.

**Rows that wait on it:**
- coverage-12's terminal-mode platform-pick rows;
- every first connect in terminal mode to a host with no stored platform.

## 1. The defect and where the connect stops

**What proteus saw** (main 33e1ae6, #639 comment 6152803550): with `remote.SSH.useLocalServer: false`, no stored
`remote.SSH.remotePlatform`, and the pick answered with Linux, the window stays at "Setting up SSH tunnel" for minutes,
with no error and no timeout. With the platform preset, the same window connects.

**Measured by daedalus** (VSCodium x64, a scratch plain launch where the script answers `platformPick` with `linux`):
1. The pick is answered. The install terminal runs, and the server is installed and started on the host.
2. The tunnel opens through the install ssh's SOCKS port (`-D`). `openTunnel` returns, and the shared record is
   stored (`pipeline/connect.ts`, after `steps.openTunnel`).
3. The connect then runs `await quietly('the platform setting', () => steps.rememberPlatform(...))`.
4. `rememberPlatform` (`pipeline/terms-steps.ts`) sees a new entry to write. It calls `announcePlatform`, and the
   record shows the "You selected "linux"…" notice. It then **awaits `writePlatform`** (`editor-surfaces.ts`), which is
   `workspace.getConfiguration().update('remote.SSH.remotePlatform', …, ConfigurationTarget.Global)` through
   `editor-operations.ts`'s `writeUserSetting`.
5. **That await never settles.** A log line placed after it never appeared, so the resolve never returns its result and
   the window never connects.

With the platform preset, `platformWrite` asks for no write, and the connect returns at once. The CLI path (`connect.ts`,
`connectOverCli`) awaits the same `rememberPlatform` before returning, and is exposed in the same way.

**Why the editor's write waits** is core's: a settings write in a window whose remote authority is being resolved. This
card doesn't depend on it. The resolve must not wait for a settings write, whatever the cause.

## 2. The fix

`pipeline/connect.ts`: in both places, the CLI path's and the direct path's, the connect **starts** the platform write
and doesn't wait for it:
- `await quietly('the platform setting', ...)` becomes `void quietly('the platform setting', ...)`;
- `quietly` keeps logging a rejection at `warn`: `the platform setting did not work: <message>`.

**Order (F-2206 5.2 step 6):** the write still starts only once the connect has succeeded, which is after the tunnel
and the shared record. Inside `rememberPlatform`, the notice still comes before the write. The connect returns its
result right after starting the write, so the write settles after the resolve. A write that never settles holds
nothing.

Nothing else changes: `terms-steps.ts`, `editor-surfaces.ts` and `editor-operations.ts` stay as they are.

## 3. Rows

**Unit rows** (`packages/remote-ssh/test/unit/connect.test.ts` and `cli-connect.test.ts`):

| Cite | Given | Expected |
|---|---|---|
| #664 | the direct path, with `rememberPlatform` returning a promise that never settles | the connect resolves `connected`; `rememberPlatform` was called once, with `linux` |
| #664 | the CLI path, the same | the connect resolves `connected` |
| #664 | `rememberPlatform` rejecting with `new Error('locked')` | the connect resolves `connected`, and the log has `the platform setting did not work: locked` at warn, once the rejection has settled (await a `setImmediate` turn) |
| F-2206 5.2 | the existing row "remembers the platform the host reported after the connect worked" | unchanged |

**Acceptance row** (a new plain launch, because the run's `terminal` launch presets the platform):
- **The launch:** in `tools/acceptance-launches.ts`, after `terminal`:
  `{label: 'terminal-pick', kind: 'plain', suite: 'terminal-pick', settings: {'remote.SSH.useLocalServer': false}}`.
  It has no `remote.SSH.remotePlatform`. Add the suite folder to `tests/acceptance/tsconfig.json`'s references (as
  `no-proposals`), `knip.jsonc`, `eslint.config.ts`'s project list, the README's labels, and the launch-table rows in
  `tools/acceptance-launches.test.ts` and `tools/acceptance.test.ts`.
- **The row:** `tests/acceptance/terminal-pick/platform-pick.test.ts`, named
  `#664, F-2206 5.2: in terminal mode, a connect whose platform is picked connects and stores the platform`.
  1. Write the launch's script (`REMOTE_OSS_ACCEPTANCE_SCRIPT`) as
     `{entries: [{surface: 'platformPick', match: 'harness', answer: 'linux'}]}`.
  2. `openWindow('harness', 'tp1')`.
  3. Then:
     - within 60 s the window `tp1` activates (`openWindow` resolves), and `windowState('tp1').remoteName` is
       `ssh-remote`;
     - the record has one `platformPick` line answered `linux`;
     - within 10 s, `<HARNESS_RUN_FOLDER>/user-data/User/settings.json` holds `"remote.SSH.remotePlatform": {"harness":
       "linux"}`.
- **It must fail on main and pass with the fix.** Run it on main first: it fails at `openWindow`, as daedalus measured
  ("timed out waiting for window tp to activate its agent"). Paste both runs in the PR.

**Full VSCodium run:** every launch green. Paste the summary.

## 4. Gates and review

All gates, with `connect.ts` at 100 %. PR title
`remote-ssh: the connect doesn't wait for the platform setting's write (card connect-37, #664)`. themis or triton
reviews; athena gives the design check. proteus repeats the manual check of #639 on the built VSIX.

## 5. Open rows (stop and report on #664)

1. If the acceptance row still hangs with the fix, report the log and the record. Don't add a bound to the tunnel.
2. If `settings.json` never gains the entry within 10 s after the window connects, report it. The write's settling
   after the resolve is the card's premise.
