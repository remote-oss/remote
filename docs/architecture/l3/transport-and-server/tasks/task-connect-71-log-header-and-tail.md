# Task card connect-71: the settings listing, ssh started, the no-hints tail and BR-5's order

Issue: #850. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2003 BR-6 items 2, 5 and 12,
BR-5, AC-11, AC-23's no-hints half and AC-25. Size: S–M. Builder: `task:claude`. **After** connect-65 (#844).

## 1. The changes

1. **Builders in `log-content.ts`:**
   - `settingLines(entries)`: `remote.SSH.<name> = <JSON value>`, one per entry;
   - `sshStartedLine()`: `Started ssh`;
   - `noHintsTail()`: the 40-dash rule, four empty lines, and `No hints found in the recent session.`
2. **Item 2:** right after connect-65's resolver line, one line per entry of remote-ssh's generated `settings` table,
   sorted by name, with the effective value through `valueOf`, as `JSON.stringify`.
   - `path` is left out, because the client search already writes `remote.SSH.path = <value>` in the same form, right
     after (connect-28). connect-28's lines don't change.
3. **Item 5:** `Started ssh` when this connect starts an ssh.
   - **Shared mode:** when its acquire claimed and spawned a helper. A join writes connect-68's reuse line instead.
   - **Terminal mode:** when the login terminal is created.
4. **Item 12:** `noHintsTail()` after connect-65's item 10, or after connect-64's failure line, on every resolve. In 0.2
   nothing records hints (D-86), so the tail is always "No hints found".
5. **BR-5's order:**
   - `log-channel.ts` writes only `Log level: <level>` at creation. A new `writeWindowStart()` writes the editor version,
     the extension and the platform, once per window.
   - The first resolve calls it right after the settings listing.
   - `extension.ts`'s `activate` calls it at the end when `vscode.env.remoteName !== 'ssh-remote'`.

## 2. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `log-content.test.ts` | the three builders | | the texts above |
| `connect.test.ts` | `F-2003 BR-6 item 2: the settings follow the resolver line` | the fixture | after the resolver line, every setting line in name order, with no `remote.SSH.path` among them |
| `connect.test.ts` | `F-2003 BR-6 item 5: a claimed helper writes Started ssh, a joined one doesn't` | claim, then join | the line, then none |
| `connect.test.ts` | `F-2003 BR-6 item 12: every resolve ends with the no-hints tail` | a success; a failure | the tail last, in both |
| `log-channel.test.ts` | `F-2003 BR-5: the versions follow the settings in a resolving window` | creation, then `writeWindowStart()` twice | `Log level` first; the three lines once |
| activation row | `F-2003 AC-25: a local window starts with the four lines` | `remoteName` undefined | level, editor version, extension, platform |

**Acceptance:** `F-2003 AC-11: a first connect's log is in BR-6's order` (windows suite, a fresh window). It reads, in
order:
- `Log level:`;
- the resolver line;
- a `remote.SSH.` setting line;
- `VS Code version:`;
- `Checking ssh client:`;
- `Started ssh`;
- `[remote] `;
- the listening line;
- the resolved line;
- the tail.

## 3. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: the settings listing, ssh started and the no-hints tail in
the log (card connect-71, #850)`. Request athena only.
