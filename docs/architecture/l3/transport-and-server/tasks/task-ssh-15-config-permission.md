# Task card ssh-15: a configuration file ssh can't read gives "Permission denied."

Why: athena's follow-up in connect-14's design check. F-2201 7.E8's table (AC-35): a configuration file of mode 000
shows the dialog "Could not establish connection to "{0}": Permission denied." `classify` matches only ssh's
authentication refusal, `Permission denied (`, so the config-file line gets no reason and the dialog shows only the
host. This affects the connection's own run and the configuration lookup (connect-14) alike. Reviewing coder:
`remote-coding-worker-1`.

The line, checked on OpenSSH 10.2p1 with a mode-000 file given with `-F`, from both `ssh -G` and a connection:
`Can't open user config file /path/to/file: Permission denied`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/diagnostics/rules.ts` | one text in `FAILURE_TEXTS` (section 2) |
| `packages/lib-ssh/src/diagnostics/classify.ts` | one rule, before the authentication rule (section 2) |
| `packages/lib-ssh/test/unit/diagnostics-classify.test.ts` | rows added (section 3) |

Nothing else.

## 2. Contract

- `FAILURE_TEXTS.configFileUnreadable = "Can't open user config file "`.
- In `classify`, **before** the `Permission denied (` rule: when an error line contains `configFileUnreadable` and
  ends with `: Permission denied`, the result is `plain('unknown', {text: 'Permission denied'})`. The kind isn't
  `authentication`, since no login was tried and nothing is to be retried. The reason is ssh's own words, passed as
  text, like the authentication rule's. The dialog's `endWithFullStop` adds the full stop.
- A `Can't open user config file …` line with another cause (no such file) is not this rule. It keeps today's result
  (7.E8's "missing file" row: no reason).

## 3. Test table

One assertion per `it`; the cite starts the name. Each row calls the file's own helper, `classifyRun(lines, 255,
'connection', 'shared')` (the error lines, ssh's exit status 255, the purpose, and the mode), as the existing rows do.

| Cite | Given (error lines) | Expected |
|---|---|---|
| F-2201 AC-35 | `["Can't open user config file /home/a/cfg: Permission denied"]` | `{kind: 'unknown', reason: {text: 'Permission denied'}, hints: [], logLines: []}` |
| F-2201 AC-35 | the same line followed by `Permission denied (publickey).` | the config-file rule wins: kind `unknown`, reason `Permission denied` |
| F-2201 7.E8 | `["Can't open user config file /home/a/cfg: No such file or directory"]` | today's result for that input, unchanged |
| F-2603 BR-10 | `["a@h: Permission denied (password)."]` | unchanged: kind `authentication` |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: an unreadable configuration file is "Permission denied." (card ssh-15, F-2201 AC-35)`.

## 6. Open rows

None. The rows were checked on a prototype (2026-10-12): the new rule gives them, the missing-file line keeps
`{kind: 'unknown', hints: [], logLines: []}`, and the authentication row is unchanged.
