# Task card coverage-09: lib-ssh's coverage drift

Issue: #526. Why: selene on #517. main measures lib-ssh at 99.8/98.92/99.66 against its ratchet of 99.94/98.97/100,
inside the gate's half point. daedalus measured where the gap is (main, 2026-10-13):
- `src/config/platform.ts` counts as 0 %. It declares one type and nothing in it runs, like `src/process/ports.ts`,
  which `coverage.json` already excludes;
- two uncovered branches a row can reach: `config/hosts.ts` lines 62–64 (a root file that isn't absolute, which
  happens when the home folder is empty) and `config/add-host.ts` line 342 (a backslash that starts a word);
- the rest are `?? …` fallbacks on an indexed or regex-capture access that the code just checked
  (`add-host.ts` 108 and 306, `hosts.ts` 148–154, 203 and 229, `connection-server/client.ts` 264, 420 and 429,
  `shell-runs.ts` 168, `terminal/prompt-reader.ts` 28). No row can reach them. They stay as they are.

Builder: selene.

## 1. Changes

**`packages/lib-ssh/coverage.json`:** add to `exclude`, beside `src/process/ports.ts`:

```json
"src/config/platform.ts": "declares a type only; nothing in it runs"
```

**`packages/lib-ssh/test/unit/hosts.test.ts`:** one row at the end of
`describe('listHosts (the host entries of the files in effect)', …)`:

```ts
  it('F-2201.BR-1: an empty home folder reads no user file, only the system file', () => {
    deepStrictEqual(
      listHosts(
        '',
        {homeFolder: '', platform: 'linux'},
        memoryReader(
          new Map([
            ['.ssh/config', 'Host rel'],
            ['/etc/ssh/ssh_config', 'Host sys'],
          ]),
        ),
      ),
      {hosts: [{name: 'sys', file: '/etc/ssh/ssh_config'}]},
    );
  });
```

**`packages/lib-ssh/test/unit/add-host.test.ts`:** one row at the end of its first `describe`:

```ts
  it('F-2204: a backslash that starts a word escapes its first character', () => {
    deepStrictEqual(parseAddHostCommand('ssh \\dev'), {
      block: {alias: 'dev', lines: [{keyword: 'HostName', value: 'dev'}]},
    });
  });
```

Both expected values were run on main: they're what the code gives, and with the two rows c8 no longer lists
`hosts.ts` 63–64 or `add-host.ts` 342. Import what a file lacks (`listHosts`, `memoryReader`, `parseAddHostCommand`,
`deepStrictEqual`); check first, since each file imports most of them already.

## 2. Done when

- `pnpm coverage` passes, and lib-ssh's functions are at 100 % (with `platform.ts` excluded);
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test:unit` pass;
- the ratchet is not raised by hand (`pnpm coverage:update` is not run in this card).

## 3. Review

PR title `lib-ssh: exclude the type-only platform file, and rows for two reachable branches (card coverage-09)`.
themis or triton reviews.
