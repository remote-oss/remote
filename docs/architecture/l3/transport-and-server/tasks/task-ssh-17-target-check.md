# Task card ssh-17: the connect checks the host and user names, and `--` comes before them

Why: themis's note on #317 found that a typed host starting with `-` reaches `ssh -G` as an option. The cause is
wider: nothing in remote-ssh calls lib-ssh's `validateTarget`, so F-2205's checks (BR-1 to BR-3, and R-93's control
characters) never run in the connect. A `-oProxyCommand=x` host reaches `ssh`, and the dialog never shows S119 to
S122. athena ruled on #253 Q9 (contracts.md, main f046b89 and cee5a9c). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/arguments/invocation.ts` | `--` before the host in `targetArguments`, and before `scp`'s two operands in `copyInvocation` |
| `packages/lib-ssh/test/unit/invocation.test.ts` | eight rows change their expected lists; rows added (section 3.1) |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `validate` runs `validateTarget` first (section 2.2) |
| `packages/remote-ssh/test/unit/server-steps.test.ts` | rows added (section 3.2) |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | S119 to S122 in `FailureStringId` and `FAILURE_TEMPLATES` |
| `packages/remote-ssh/test/unit/failure-strings.test.ts` | the key-list row gains the four ids; rows added (section 3.3) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the four templates as keys, English values |
| `packages/remote-ssh/test/unit/strings.test.ts` | `FAILURE_TEXTS` gains the four templates |

Nothing else.

## 2. Contract

### 2.1 `--` in every invocation (lib-ssh)

- `targetArguments` ends with `'--', target.host` instead of `target.host`. So every `ssh` run, and the `ssh -G`
  query, reads `… [-l user] [-p port] -- host [command]`.
- `copyInvocation` puts `'--'` right after the common arguments: `[...common, '--', localFile, 'host:path']`.
- Checked on OpenSSH 10.2p1 (daedalus and athena, #253 Q9): `ssh -G -- h1` and `ssh -G -l alice -p 2222 -- h1` give the
  same options as without `--`; `ssh -l u -p 1 -- 127.0.0.1 true` connects normally; after `--` a host
  `-oProxyCommand=x` is refused as a host name, and an `scp` destination `-oProxyCommand=…:x` is taken as a file name.
- The JSDoc of `targetArguments` names the `--`: "then `--` and the host, so a host is never read as an option".

### 2.2 The check in the connect (remote-ssh)

In `createServerSteps`, `validate` becomes:

```ts
validate: input => {
  const problem = validateTarget(sshTargetOf(input.target));
  if (problem !== undefined) {
    return {
      kind: 'failed',
      failure: {
        kind: 'invalidSetting',
        reason: {id: problem.reason, values: [problem.character]},
      },
    };
  }
  return settings.installFolder.kind === 'invalid'
    ? /* today's failure, unchanged */
    : {kind: 'done', value: undefined};
},
```

with `import {validateTarget} from 'lib-ssh';` and `sshTargetOf` imported from `./host-settings.ts` beside
`HostServerSettings`.

- The target check comes **before** the install-folder check: a bad name is reported even when the folder is also
  invalid.
- `invalidSetting` is permanent (`KIND_MAY_RECOVER` already says `false`), as F-2205 PRE-2 needs: nothing can change
  between attempts. No new kind.
- The pipeline runs `validate` first, before the pre-connection script and the platform question, so F-2205 POST-1
  holds (no `ssh` process, no script, no picker). Nothing in `connect.ts` changes.

### 2.3 The dialog's texts (remote-ssh)

`FAILURE_TEMPLATES` gains, after `S117`, in this order:

```ts
S119: 'SSH host name cannot begin with {0}',
S120: 'SSH host name cannot include the character {0}',
S121: 'SSH user name cannot begin with {0}',
S122: 'SSH user name cannot include the character {0}',
```

(F-2205's string table, remote-ssh#32.) The same four texts are keys in `bundle.l10n.json` and in each of the 14
locale bundles, with the English text as the value. The presenter needs no change: a reason with values already
resolves through the table, and the dialog ends with a full stop.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 lib-ssh `invocation.test.ts`

The eight rows that change: each expected list gains `'--'` right before the host (or, for the copy rows, before the
local file). Their names stay. They are, by name:

| Row | New expectation |
|---|---|
| F-2104.BR-1: both forwards stand in the given order | the slice ends at `indexOf('--')` instead of `indexOf('alias')` (same four elements) |
| F-2405.BR-6: a copy run copies the file to the alias | `'--'` before `'/tmp/boot.sh'` |
| F-2405.BR-6: a copy run keeps the configuration file | `'--'` after the `-F` pair |
| F-2405.BR-6: a copy run ignores the user and the port of the target | `'--'` before the local file |
| S4 contract: the query is the ssh program with -G and the host | `['-G', '--', 'alias']` |
| S4 contract: a ~ configuration file expands before -G | `['-F', '/home/dev/c', '-G', '--', 'alias']` |
| connect-14: the query names the target as the connection does, with its user and port | `slice(-7)` is `['-G', '-l', 'alice', '-p', '2222', '--', 'h1']` |
| connect-14: a target with no user or port is the host alone after -G | `slice(-3)` is `['-G', '--', 'h1']` |

Rows added:

| Cite | Given | Expected |
|---|---|---|
| #253 Q9 | a connection to host `-oProxyCommand=x` (built directly, as a caller that skipped the check would) | the argument before `-oProxyCommand=x` is `--` |
| #253 Q9 | a `oneShot` run with remote program `uname -s` | `slice(-3)` is `['--', 'alias', 'uname -s']` (the existing `slice(-2)` row stays as it is) |
| #253 Q9 | a copy run | `--` appears exactly once, right before the local file |

### 3.2 remote-ssh `server-steps.test.ts`

Each row calls `createServerSteps(dependencies()).validate({...INPUT, target})`:

| Cite | Target | Expected |
|---|---|---|
| F-2205 7.E1 | `{kind: 'plain', text: '-oProxyCommand=x'}` | `{kind: 'failed', failure: {kind: 'invalidSetting', reason: {id: 'S119', values: ['-']}}}` |
| F-2205 BR-1 | `{kind: 'plain', text: 'a%b'}` | reason `{id: 'S120', values: ['%']}` |
| F-2205 BR-1 | `{kind: 'plain', text: '-u@h.invalid'}` | reason `{id: 'S121', values: ['-']}` |
| F-2205 BR-1 | `{kind: 'plain', text: 'u\\x@h.invalid'}` (a backslash in the user) | reason `{id: 'S122', values: ['\\']}` |
| F-2205 BR-2 | `{kind: 'plain', text: '-u@-h'}` | reason `{id: 'S119', values: ['-']}` (the host is reported first) |
| F-2205 BR-3 | `{kind: 'plain', text: "a%b'c"}` | reason `{id: 'S120', values: ["'"]}` |
| F-2205 BR-1, R-93 | `{kind: 'plain', text: 'a\nb'}` | reason `{id: 'S120', values: ['U+000A']}` |
| F-2205 BR-1 | `{kind: 'host', hostName: '-h', user: 'u'}` (a structured target) | reason `{id: 'S119', values: ['-']}` |
| F-2205 POST-1 | `{kind: 'plain', text: 'alex@dev:2222'}` | `{kind: 'done', value: undefined}` |
| F-2205 BR-2 | a bad host **and** an invalid install folder (`serverInstallPath` as in today's row) | the S119 failure, not the folder's |

No row is needed in `connect.test.ts`: the order (validate first) is already pinned there.

### 3.3 remote-ssh `failure-strings.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2205 | the key-list row | the four ids follow `'S117'` |
| F-2205 7.E1 | `reasonText({id: 'S119', values: ['-']}, same)` | `'SSH host name cannot begin with -'` |
| F-2205 7.E5, R-93 | `reasonText({id: 'S120', values: ['U+000A']}, same)` | `'SSH host name cannot include the character U+000A'` |

`same` is the translation that returns its template. The four texts in `strings.test.ts`'s `FAILURE_TEXTS` and the
bundles keep its two existing rows passing.

All rows were checked on a prototype over main (2026-10-12): the lib-ssh suite changes exactly the eight rows above;
remote-ssh's only changed row is the key list; every F-2205 example the spec lists (7.E1 to 7.E6, BR-2, BR-3) gives
the reason in the table above through `validateTarget(sshTargetOf(…))` and `reasonText`.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's and remote-ssh's 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: the connect checks the host and user names, and -- comes before them (card ssh-17,
F-2205)`.

## 6. Open rows

None.
