# Task card connect-22: F-2205's resolver rows through the real connect (#325)

Why: #325 (a 0.2 release blocker). Its code is merged: card ssh-17 (#327) runs `validateTarget` first in the validate
step and puts `--` before the host. #325 is done when "F-2205's resolver rows (7.E1 to 7.E6) pass in the SSH suite".
Today those rows are unit rows of `validateTarget` and of the validate step, each over its own fakes. This card proves
them through the **assembled** connect: `connectAssemblyOf` over the real machine (`nodeMachineOf`), the real `ssh`
client, and the connector the resolver calls. No host is needed: a rejected name never reaches `ssh` (7.E1 to 7.E4),
and the names `ssh` refuses are refused by the client itself, at the configuration lookup, before any network
(7.E5, 7.E6). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/test/unit/target-check.test.ts` | new: the rows of section 3 |

Nothing else. No source changes.

## 2. Contract

The test builds the connect as the extension does, apart from the editor:

```ts
const machine = nodeMachineOf(
  {
    extensionFolder: '/nonexistent/extension',
    storageFolder: <a temporary folder of the test>,
    runtime: process.execPath,
    profile: PROFILE,            // server-steps.fixture.ts
    httpGet: () => Promise.reject(new Error('no download in this test')),
  },
  {...nodeFacts(), environment: {...process.env}},
);
```

- **The spawner** is `machine.spawner` wrapped to record every program it starts:
  `{...machine, spawner: specification => { started.push(specification.program); return machine.spawner(specification); }}`.
- **The surfaces** are `surfacesOf({inspectSetting: settingId => ({defaultValue: DEFAULTS[settingId]})}, template =>
  template, () => undefined)` (`server-steps.fixture.ts`), where `DEFAULTS` gives `remote.SSH.useLocalServer` `true`,
  `remote.SSH.path` `''`, `remote.SSH.configFile` `''`, `remote.SSH.connectTimeout` `15` and
  `remote.SSH.remotePlatform` `{}`, and `undefined` otherwise.
- **The connect** is `connectAssemblyOf(surfaces, recordingMachine, logger).connector.connect(input)`, where `input` is the
  host's `ConnectInput` for an `ssh-remote` target: `{target, rawHostString, attempt: 1, isReconnection: false, windowId:
  'window-1', windowWorkspace: undefined}`. `target` and `rawHostString` come from `lib-authority`'s
  `decodeAuthority('ssh-remote+' + <host text>)` (its `target` and `rawHostString`), exactly as the resolver host gets
  them; never hand-built. A malformed result is a defect of the row and throws.
- **The result** is a `Failed`. A row reads its `kind` and `reason`, and `started`.

The rows of 7.E5 and 7.E6 need the real `ssh` on `PATH`. If `ssh -V` cannot run, they `this.skip()` with the reason "no
OpenSSH client"; the other rows never start a process.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Host text (the authority's payload) | Expected |
|---|---|---|
| F-2205 AC-2, 7.E1 | `-oProxyCommand=x` | `kind` `invalidSetting`, `reason` `{id: 'S119', values: ['-']}` |
| F-2205 AC-3 | `-oProxyCommand=x` | `started` is `[]` (no `ssh`, no `scp`, no helper) |
| F-2205 AC-4, 7.E2 | `a%b` | `reason` `{id: 'S120', values: ['%']}` |
| F-2205 AC-5 | `a%b'c`, `` a!b`c ``, `` a`%b `` (one `it` each) | the character BR-3 reports, as `validateTarget`'s own rows give it |
| F-2205 AC-6, 7.E3 | `-u@h.invalid` | `reason` `{id: 'S121', values: ['-']}` |
| F-2205 AC-7, 7.E4 | `u!x@h.invalid` | `reason` `{id: 'S122', values: ['!']}` |
| F-2205 AC-3 | `u!x@h.invalid` | `started` is `[]` |
| F-2205 AC-8 | `-u@-h` | `S119` (the host is checked first) |
| F-2205 AC-10, 7.E5 | `a;b` | `kind` `unreachable`, `reason` `{id: 'S079'}`, and `started` includes `ssh` (the client found on `PATH`; the lookup ran and `ssh` refused) |
| F-2205 AC-12, 7.E6 | `u;x@h.invalid` | no `reason` (the reasonless dialog), and `started` includes `ssh` |
| F-2205 AC-11, 7.E10 | `_host`, `h-`, `a*b` (one `it` each) | `kind` is not `invalidSetting` (the check passes; what follows is `ssh`'s) |

Each row of 7.E5, 7.E6 and 7.E10 runs the real `ssh -V` and `ssh -G`, which take well under a second. Give the
describe a `this.timeout(20000)`.

## 4. Rule for the worker

As card log-01. Coverage is unaffected (no source changes). If a row's expectation differs from what the code does,
stop and report on #325 with the output: that would be a defect in the merged code, not the card's to fix.

## 5. Gates and review

PR title `remote-ssh: F-2205's resolver rows through the real connect (card connect-22, #325)`.

## 6. Open rows

None. Checked on OpenSSH 10.2p1 (2026-10-12): `ssh -G -- 'a;b'` exits 255 with `hostname contains invalid characters`,
and `ssh -G -l 'u;x' -- h.invalid` exits 255 with `remote username contains invalid characters`, both with no
network.
