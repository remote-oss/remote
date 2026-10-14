# Task card connect-73: the log level's criteria

Issue: #852. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2003 AC-13, AC-14, AC-15
and AC-26 (BR-10, BR-11, 7.E1–7.E3). Size: S. Builder: `task:claude`. **After** connect-66 (#845), whose trace lines
make the level observable.

## 1. What's checked, and what changes only if a row fails

The level is read through `readLevel` at each log call (`log-channel.ts`, `minimumLevel: readLevel`), and through the
level read in connect-66's filter. These rows prove the four criteria. **Write the rows first.** Any that fails on main
is a defect: fix it in this card, in `log-channel.ts`'s `readLevel` and the setting reader, and say which rows failed.

## 2. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `log-channel.test.ts` | `F-2003 AC-14: only the application value counts` | `inspect` giving `workspaceFolderValue: 'trace'`, then only a lowercase key `remote.SSH.loglevel: 'trace'` | `debug` both times |
| `log-channel.test.ts` | `F-2003 AC-15: an out-of-enum value is no error` | `'info'` | `readLevel` gives `debug`; no notice or error port called |

**Acceptance** (windows suite):
- `F-2003 AC-13 and AC-26: the level is read live`. A window started at `debug` connects to `harness`. Change
  `remote.SSH.logLevel` to `trace` through `updateSetting`, without a reload, then reload the window to reconnect. The
  second record's lines hold `[ssh] debug1:` lines (connect-66). No error notice appears.
- `F-2003 AC-15: an out-of-enum level connects`. `remote.SSH.logLevel` `info` gives a connected window, with no
  `notice` or `failureDialog` line.

## 3. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: the log level's criteria (card connect-73, #852)`. Request
athena only.
